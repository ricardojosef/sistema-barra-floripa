/**
 * equipe.js — cadastro e retirada de professores.
 *
 * Exclusivo do administrador. A checagem aqui protege a interface; no modo
 * Firebase, quem garante de fato são as regras do firestore.rules, que só
 * deixam o papel 'admin' criar perfis de equipe e alterar professores.
 *
 * RETIRAR NÃO É APAGAR
 * Professores retirados são desativados, não excluídos:
 *  - o histórico de aulas continua mostrando o nome de quem deu a aula;
 *  - no Firebase, apagar a conta do Authentication exige o Admin SDK, que
 *    só roda em servidor — pelo navegador o máximo seguro é bloquear o login.
 * Se a mesma pessoa voltar, cadastrá-la com o mesmo e-mail reativa a conta.
 */

import { CONFIG } from './config.js';
import { listar, obter, criar, atualizar, driverAtual } from './store.js';
import { usuarioAtual } from './auth.js';
import { cancelar } from './agenda.js';
import { hojeISO } from './ui.js';

export class ErroEquipe extends Error {
  constructor(codigo, mensagem) {
    super(mensagem);
    this.name = 'ErroEquipe';
    this.codigo = codigo;
  }
}

const MENSAGENS_FIREBASE = {
  'auth/email-already-in-use': 'Já existe uma conta com esse e-mail.',
  'auth/invalid-email': 'E-mail inválido.',
  'auth/weak-password': 'A senha precisa ter pelo menos 6 caracteres.',
  'auth/network-request-failed': 'Falha de conexão. Verifique sua internet.',
};

const emailValido = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

function exigirAdmin() {
  const usuario = usuarioAtual();
  if (!usuario || usuario.papel !== 'admin') {
    throw new ErroEquipe('SEM_PERMISSAO', 'Apenas o administrador pode gerenciar a equipe.');
  }
  return usuario;
}

/** 'Gabrieli Souza' -> 'prof-gabrieli-souza-x7k2' (o sufixo evita colisão). */
function gerarIdProfessor(nome) {
  const base = String(nome)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    .slice(0, 30) || 'professor';
  const sufixo = crypto.getRandomValues(new Uint32Array(1))[0].toString(36).slice(0, 4);
  return `prof-${base}-${sufixo}`;
}

/* --------------------------------------------------------------------------
   Consultas
   -------------------------------------------------------------------------- */

/** Aulas confirmadas do professor de hoje em diante. */
export async function aulasFuturasDoProfessor(professorId) {
  const aulas = await listar('agendamentos', { professorId, status: 'confirmado' });
  const hoje = hojeISO();
  return aulas.filter((a) => a.data >= hoje);
}

/** Professores no quadro (exclui os retirados), em ordem de grade. */
export async function listarEquipe() {
  const professores = await listar('professores');
  const ativos = professores.filter((p) => !p.removido);

  const usuarios = await Promise.all(
    ativos.map((p) => (p.usuarioId ? obter('usuarios', p.usuarioId) : null)),
  );

  return ativos
    .map((p, i) => ({
      ...p,
      email: usuarios[i]?.email || '',
      ehAdmin: usuarios[i]?.papel === 'admin',
    }))
    .sort((a, b) => (a.ordem ?? 99) - (b.ordem ?? 99));
}

/* --------------------------------------------------------------------------
   Adicionar
   -------------------------------------------------------------------------- */

/**
 * Cadastra um professor: cria a conta de acesso e o registro na grade.
 * Se o e-mail pertencer a um professor retirado, reativa esse cadastro.
 */
export async function adicionarProfessor({ nome, email, senha }) {
  exigirAdmin();

  const nomeNorm = String(nome || '').trim();
  const emailNorm = String(email || '').trim().toLowerCase();

  if (nomeNorm.length < 2) throw new ErroEquipe('NOME', 'Informe o nome do professor.');
  if (!emailValido(emailNorm)) throw new ErroEquipe('EMAIL', 'Informe um e-mail válido.');

  const existentes = await listar('usuarios', { email: emailNorm });
  const existente = existentes[0];

  // Mesmo e-mail de alguém que já está ativo: não há o que criar.
  if (existente && existente.ativo !== false) {
    const quem = existente.papel === 'aluno' ? 'um aluno' : 'alguém da equipe';
    throw new ErroEquipe('EMAIL_EM_USO', `Esse e-mail já pertence a ${quem}.`);
  }

  if (existente && existente.ativo === false) {
    return reativarProfessor(existente, nomeNorm, senha);
  }

  if (String(senha || '').length < 6) {
    throw new ErroEquipe('SENHA', 'A senha inicial precisa ter pelo menos 6 caracteres.');
  }

  const usuarioId = await criarContaDeAcesso({ nome: nomeNorm, email: emailNorm, senha });

  // Novo professor entra no fim da grade.
  const professores = await listar('professores');
  const ordem = professores.reduce((maior, p) => Math.max(maior, Number(p.ordem) || 0), 0) + 1;

  return criar('professores', {
    id: gerarIdProfessor(nomeNorm),
    usuarioId,
    nome: nomeNorm,
    ativo: true,
    removido: false,
    ordem,
  });
}

/** Cria a conta de login com papel 'professor' e devolve o id do usuário. */
async function criarContaDeAcesso({ nome, email, senha }) {
  const perfil = {
    nome,
    email,
    telefone: '',
    papel: 'professor',
    ativo: true,
    googleId: null,
    criadoEm: new Date().toISOString(),
  };

  if (CONFIG.MODO_DADOS === 'firebase') {
    let uid;
    try {
      uid = await driverAtual().criarContaSemTrocarSessao(email, senha);
    } catch (err) {
      throw new ErroEquipe(err.code || 'FALHA', MENSAGENS_FIREBASE[err.code] || 'Não foi possível criar a conta.');
    }

    try {
      await criar('usuarios', { id: uid, ...perfil });
    } catch (err) {
      // A conta já existe no Authentication; sem o perfil ela não entra.
      console.error('[equipe] conta criada, mas o perfil não foi gravado:', err);
      throw new ErroEquipe(
        'PERFIL',
        'A conta de acesso foi criada, mas o perfil não pôde ser gravado. '
        + 'Confira se as regras do firestore.rules estão atualizadas no Console e '
        + 'cadastre o mesmo e-mail de novo para concluir.',
      );
    }
    return uid;
  }

  const { hashSenha } = await import('./store.local.js');
  const usuario = await criar('usuarios', { ...perfil, senhaHash: await hashSenha(senha) });
  return usuario.id;
}

/** Devolve ao quadro um professor retirado anteriormente. */
async function reativarProfessor(usuario, nome, senha) {
  if (usuario.papel === 'aluno') {
    throw new ErroEquipe('EMAIL_EM_USO', 'Esse e-mail pertence a uma conta de aluno desativada.');
  }

  const campos = { ativo: true, nome };

  // No modo local a senha nova substitui a antiga. No Firebase, a senha de
  // outra pessoa só pode ser trocada pelo servidor: vale a que ela já tinha.
  if (CONFIG.MODO_DADOS !== 'firebase' && String(senha || '').length >= 6) {
    const { hashSenha } = await import('./store.local.js');
    campos.senhaHash = await hashSenha(senha);
  }

  await atualizar('usuarios', usuario.id, campos);

  const registros = await listar('professores', { usuarioId: usuario.id });
  if (registros[0]) {
    return atualizar('professores', registros[0].id, {
      nome, ativo: true, removido: false, removidoEm: null,
    });
  }

  // Conta sem registro na grade (dado inconsistente): recria o registro.
  const professores = await listar('professores');
  const ordem = professores.reduce((maior, p) => Math.max(maior, Number(p.ordem) || 0), 0) + 1;
  return criar('professores', {
    id: gerarIdProfessor(nome), usuarioId: usuario.id, nome, ativo: true, removido: false, ordem,
  });
}

/* --------------------------------------------------------------------------
   Retirar
   -------------------------------------------------------------------------- */

/**
 * Retira o professor do quadro.
 *
 * As aulas futuras dele são canceladas e o crédito volta para cada aluno —
 * deixá-las de pé faria alunos aparecerem na praia sem professor. Depois a
 * conta é desativada (perde o login) e o professor some da grade.
 */
export async function removerProfessor(professorId, motivo = 'Professor retirado do quadro da escola') {
  const admin = exigirAdmin();

  const professor = await obter('professores', professorId);
  if (!professor || professor.removido) {
    throw new ErroEquipe('NAO_ENCONTRADO', 'Professor não encontrado.');
  }

  const usuario = professor.usuarioId ? await obter('usuarios', professor.usuarioId) : null;
  if (usuario?.papel === 'admin' || professor.usuarioId === admin.id) {
    throw new ErroEquipe('ADMIN', 'O administrador não pode ser retirado do quadro.');
  }

  const futuras = await aulasFuturasDoProfessor(professorId);
  const quem = { id: admin.id, nome: admin.nome, papel: admin.papel };
  const falhas = [];

  for (const aula of futuras) {
    try {
      await cancelar(aula.id, quem, motivo);
    } catch (err) {
      falhas.push(aula.id);
      console.error(`[equipe] não foi possível cancelar a aula ${aula.id}:`, err);
    }
  }

  // Se alguma aula não cancelou, o professor fica no quadro: retirá-lo
  // assim deixaria alunos com aula marcada para alguém que não existe mais.
  if (falhas.length) {
    throw new ErroEquipe(
      'AULAS_PENDENTES',
      `${falhas.length} aula(s) não puderam ser canceladas. O professor foi mantido; tente novamente.`,
    );
  }

  await atualizar('professores', professorId, {
    ativo: false,
    removido: true,
    removidoEm: new Date().toISOString(),
  });

  if (usuario) await atualizar('usuarios', usuario.id, { ativo: false });

  return { aulasCanceladas: futuras.length };
}
