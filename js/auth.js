/**
 * auth.js — autenticação, sessão e guarda de rota.
 *
 * Funciona nos dois modos:
 *  - 'local'   : sessão em localStorage, senha com SHA-256 (apenas demo).
 *  - 'firebase': Firebase Authentication (e-mail/senha + Google); o papel do
 *                usuário vem do documento `usuarios/{uid}` no Firestore e é
 *                reforçado pelas regras de segurança — nunca confie no cliente.
 */

import { CONFIG } from './config.js';
import { inicializarStore, listar, criar, obter, atualizar, driverAtual } from './store.js';

const CHAVE_SESSAO = 'bf_sessao';
const DURACAO_SESSAO_MS = 1000 * 60 * 60 * 12; // 12 horas

let usuarioCache = null;
const ouvintesUsuario = new Set();

/* --------------------------------------------------------------------------
   Erros de autenticação
   -------------------------------------------------------------------------- */

export class ErroAuth extends Error {
  constructor(codigo, mensagem) {
    super(mensagem);
    this.name = 'ErroAuth';
    this.codigo = codigo;
  }
}

const MENSAGENS_FIREBASE = {
  'auth/invalid-credential': 'E-mail ou senha incorretos.',
  'auth/invalid-email': 'E-mail inválido.',
  'auth/user-not-found': 'Não encontramos uma conta com esse e-mail.',
  'auth/wrong-password': 'E-mail ou senha incorretos.',
  'auth/email-already-in-use': 'Já existe uma conta com esse e-mail.',
  'auth/weak-password': 'A senha precisa ter pelo menos 6 caracteres.',
  'auth/popup-closed-by-user': 'A janela do Google foi fechada antes de concluir.',
  'auth/popup-blocked': 'O navegador bloqueou a janela do Google. Libere os pop-ups e tente de novo.',
  'auth/network-request-failed': 'Falha de conexão. Verifique sua internet.',
  'auth/too-many-requests': 'Muitas tentativas. Aguarde alguns minutos.',
};

/* --------------------------------------------------------------------------
   Sessão (modo local)
   -------------------------------------------------------------------------- */

function lerSessao() {
  try {
    const bruto = localStorage.getItem(CHAVE_SESSAO);
    if (!bruto) return null;
    const sessao = JSON.parse(bruto);
    if (!sessao?.usuarioId || !sessao.expiraEm || Date.now() > sessao.expiraEm) {
      localStorage.removeItem(CHAVE_SESSAO);
      return null;
    }
    return sessao;
  } catch {
    localStorage.removeItem(CHAVE_SESSAO);
    return null;
  }
}

function gravarSessao(usuario) {
  localStorage.setItem(CHAVE_SESSAO, JSON.stringify({
    usuarioId: usuario.id,
    papel: usuario.papel,
    expiraEm: Date.now() + DURACAO_SESSAO_MS,
  }));
}

/** Remove o hash da senha antes de qualquer coisa chegar às telas. */
function semSegredos(usuario) {
  if (!usuario) return null;
  const { senhaHash, ...limpo } = usuario;
  return limpo;
}

function emitirMudanca() {
  ouvintesUsuario.forEach((cb) => {
    try { cb(usuarioCache); } catch (err) { console.error('[auth] ouvinte falhou:', err); }
  });
}

/* --------------------------------------------------------------------------
   API pública
   -------------------------------------------------------------------------- */

/** Garante store inicializado e devolve o usuário logado (ou null). */
export async function carregarUsuario() {
  await inicializarStore();

  if (CONFIG.MODO_DADOS === 'firebase') {
    const usuarioFirebase = await driverAtual().usuarioFirebaseAtual();
    if (!usuarioFirebase) {
      usuarioCache = null;
      return null;
    }
    const perfil = await obter('usuarios', usuarioFirebase.uid);
    // Conta desativada (ex.: professor retirado do quadro) perde o acesso
    // mesmo com uma sessão do Firebase ainda válida no navegador.
    if (!perfil || perfil.ativo === false) {
      try { await driverAtual().sair(); } catch { /* sessão já encerrada */ }
      usuarioCache = null;
      return null;
    }
    usuarioCache = semSegredos(perfil);
    return usuarioCache;
  }

  const sessao = lerSessao();
  if (!sessao) {
    usuarioCache = null;
    return null;
  }
  const usuario = await obter('usuarios', sessao.usuarioId);
  if (!usuario || usuario.ativo === false) {
    localStorage.removeItem(CHAVE_SESSAO);
    usuarioCache = null;
    return null;
  }
  usuarioCache = semSegredos(usuario);
  return usuarioCache;
}

/** Último usuário carregado, sem ir ao armazenamento de novo. */
export const usuarioAtual = () => usuarioCache;

/** Registra um callback para mudanças de sessão. Devolve a função de cancelamento. */
export function aoMudarUsuario(cb) {
  ouvintesUsuario.add(cb);
  return () => ouvintesUsuario.delete(cb);
}

/** Login com e-mail e senha. */
export async function entrar(email, senha) {
  await inicializarStore();
  const emailNorm = String(email || '').trim().toLowerCase();
  if (!emailNorm || !senha) {
    throw new ErroAuth('campos-vazios', 'Preencha e-mail e senha.');
  }

  if (CONFIG.MODO_DADOS === 'firebase') {
    try {
      const cred = await driverAtual().entrarComSenha(emailNorm, senha);
      const perfil = await obter('usuarios', cred.user.uid);
      if (!perfil) {
        throw new ErroAuth('sem-perfil', 'Sua conta existe, mas não tem perfil cadastrado. Fale com a escola.');
      }
      if (perfil.ativo === false) {
        await driverAtual().sair();
        throw new ErroAuth('inativo', 'Esta conta está desativada. Fale com a escola.');
      }
      usuarioCache = semSegredos(perfil);
      emitirMudanca();
      return usuarioCache;
    } catch (err) {
      if (err instanceof ErroAuth) throw err;
      throw new ErroAuth(err.code || 'falha', MENSAGENS_FIREBASE[err.code] || 'Não foi possível entrar. Tente novamente.');
    }
  }

  const { hashSenha } = await import('./store.local.js');
  const encontrados = await listar('usuarios', { email: emailNorm });
  const usuario = encontrados[0];
  const hash = await hashSenha(senha);

  // Mensagem única para e-mail inexistente e senha errada: não revela
  // quais e-mails estão cadastrados.
  if (!usuario || usuario.senhaHash !== hash) {
    throw new ErroAuth('credenciais', 'E-mail ou senha incorretos.');
  }
  if (usuario.ativo === false) {
    throw new ErroAuth('inativo', 'Esta conta está desativada. Fale com a escola.');
  }

  gravarSessao(usuario);
  usuarioCache = semSegredos(usuario);
  emitirMudanca();
  return usuarioCache;
}

/**
 * Cadastro de aluno.
 * Professores e administradores não se cadastram sozinhos — são criados
 * pelo seed (modo local) ou pelo Console do Firebase.
 */
export async function cadastrar({ nome, email, telefone, senha }) {
  await inicializarStore();
  const emailNorm = String(email || '').trim().toLowerCase();
  const nomeNorm = String(nome || '').trim();

  if (nomeNorm.length < 3) throw new ErroAuth('nome', 'Informe seu nome completo.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) throw new ErroAuth('email', 'Informe um e-mail válido.');
  if (String(senha || '').length < 6) throw new ErroAuth('senha', 'A senha precisa ter pelo menos 6 caracteres.');

  if (CONFIG.MODO_DADOS === 'firebase') {
    try {
      const cred = await driverAtual().cadastrarComSenha(emailNorm, senha);
      const perfil = {
        id: cred.user.uid,
        nome: nomeNorm,
        email: emailNorm,
        telefone: telefone || '',
        papel: 'aluno',
        ativo: true,
        googleId: null,
        criadoEm: new Date().toISOString(),
      };
      await criar('usuarios', perfil);
      usuarioCache = perfil;
      emitirMudanca();
      return usuarioCache;
    } catch (err) {
      if (err instanceof ErroAuth) throw err;
      throw new ErroAuth(err.code || 'falha', MENSAGENS_FIREBASE[err.code] || 'Não foi possível criar a conta.');
    }
  }

  const existentes = await listar('usuarios', { email: emailNorm });
  if (existentes.length) {
    throw new ErroAuth('email-em-uso', 'Já existe uma conta com esse e-mail. Tente entrar.');
  }

  const { hashSenha } = await import('./store.local.js');
  const usuario = await criar('usuarios', {
    nome: nomeNorm,
    email: emailNorm,
    telefone: telefone || '',
    papel: 'aluno',
    ativo: true,
    googleId: null,
    senhaHash: await hashSenha(senha),
  });

  gravarSessao(usuario);
  usuarioCache = semSegredos(usuario);
  emitirMudanca();
  return usuarioCache;
}

/**
 * Login com Google.
 * No modo local não há OAuth de verdade: `dadosSimulados` traz o nome e o
 * e-mail que a tela coletou no modal "Simular conta Google".
 */
export async function entrarComGoogle(dadosSimulados = null) {
  await inicializarStore();

  if (CONFIG.MODO_DADOS === 'firebase') {
    try {
      const cred = await driverAtual().entrarComGoogle();
      const { uid, displayName, email, photoURL } = cred.user;
      let perfil = await obter('usuarios', uid);
      if (!perfil) {
        // Primeiro acesso via Google: cria o perfil de aluno.
        perfil = await criar('usuarios', {
          id: uid,
          nome: displayName || (email || '').split('@')[0],
          email: (email || '').toLowerCase(),
          telefone: '',
          papel: 'aluno',
          ativo: true,
          googleId: uid,
          fotoUrl: photoURL || null,
          criadoEm: new Date().toISOString(),
        });
      }
      usuarioCache = semSegredos(perfil);
      emitirMudanca();
      return usuarioCache;
    } catch (err) {
      if (err instanceof ErroAuth) throw err;
      throw new ErroAuth(err.code || 'falha', MENSAGENS_FIREBASE[err.code] || 'Não foi possível entrar com o Google.');
    }
  }

  const emailNorm = String(dadosSimulados?.email || '').trim().toLowerCase();
  const nomeNorm = String(dadosSimulados?.nome || '').trim();
  if (!emailNorm) throw new ErroAuth('email', 'Informe o e-mail da conta Google.');

  const existentes = await listar('usuarios', { email: emailNorm });
  let usuario = existentes[0];

  if (!usuario) {
    usuario = await criar('usuarios', {
      nome: nomeNorm || emailNorm.split('@')[0],
      email: emailNorm,
      telefone: '',
      papel: 'aluno',
      ativo: true,
      googleId: `google-simulado-${emailNorm}`,
      senhaHash: null, // conta só de Google: não entra por senha
    });
  }

  if (usuario.ativo === false) {
    throw new ErroAuth('inativo', 'Esta conta está desativada. Fale com a escola.');
  }

  gravarSessao(usuario);
  usuarioCache = semSegredos(usuario);
  emitirMudanca();
  return usuarioCache;
}

/**
 * Atualiza o próprio perfil. Só telefone e foto: nome e e-mail identificam a
 * conta (login, recibos, lista de turmas) e só a escola altera. As regras do
 * Firestore repetem essa restrição no servidor.
 *
 * `fotoUrl`: imagem já reduzida em data URL JPEG (ver js/pages/perfil.js),
 * ou null para remover. `undefined` mantém a atual.
 */
export async function atualizarMeuPerfil({ telefone, fotoUrl } = {}) {
  const usuario = usuarioCache;
  if (!usuario) throw new ErroAuth('sem-sessao', 'Entre novamente para continuar.');

  const campos = {};

  if (telefone !== undefined) {
    const digitos = String(telefone || '').replace(/\D/g, '');
    if (digitos && (digitos.length < 10 || digitos.length > 11)) {
      throw new ErroAuth('telefone', 'Informe o telefone com DDD, por exemplo (48) 99999-9999.');
    }
    campos.telefone = String(telefone || '').trim().slice(0, 20);
  }

  if (fotoUrl !== undefined) {
    if (fotoUrl !== null && !/^data:image\/(jpeg|png|webp);base64,/.test(String(fotoUrl))) {
      throw new ErroAuth('foto', 'Formato de foto não suportado.');
    }
    if (fotoUrl && fotoUrl.length > 290000) {
      throw new ErroAuth('foto', 'A foto ficou grande demais. Tente outra imagem.');
    }
    campos.fotoUrl = fotoUrl;
  }

  if (!Object.keys(campos).length) return usuario;

  await atualizar('usuarios', usuario.id, campos);
  usuarioCache = { ...usuario, ...campos };
  emitirMudanca();
  return usuarioCache;
}

/** Encerra a sessão e leva para a página indicada. */
export async function sair(redirecionarPara = 'index.html') {
  if (CONFIG.MODO_DADOS === 'firebase') {
    try { await driverAtual().sair(); } catch (err) { console.error('[auth] falha ao sair:', err); }
  }
  localStorage.removeItem(CHAVE_SESSAO);
  usuarioCache = null;
  emitirMudanca();
  if (redirecionarPara) location.href = redirecionarPara;
}

/* --------------------------------------------------------------------------
   Guarda de rota
   -------------------------------------------------------------------------- */

/** Página inicial de cada papel. */
export function painelDoPapel(papel) {
  if (papel === 'admin') return 'admin.html';
  if (papel === 'professor') return 'professor.html';
  return 'dashboard.html';
}

/** Mostra o overlay que cobre a página enquanto a guarda decide. */
function mostrarOverlay() {
  if (document.getElementById('guard-loading')) return;
  const overlay = document.createElement('div');
  overlay.id = 'guard-loading';
  overlay.innerHTML = '<div class="spinner escuro g"></div><p>Carregando sua área...</p>';
  document.body.append(overlay);
}

function esconderOverlay() {
  document.getElementById('guard-loading')?.remove();
}

/**
 * Protege a página. Coloque no topo do controlador:
 *   const usuario = await exigirAuth(['aluno']);
 *
 * Sem sessão -> login.html?redirect=<pagina>
 * Papel errado -> painel correspondente ao papel do usuário.
 * A promessa fica pendente durante o redirecionamento, então o código
 * seguinte não chega a rodar.
 */
export async function exigirAuth(papeisPermitidos = ['aluno', 'professor', 'admin']) {
  mostrarOverlay();
  const usuario = await carregarUsuario();
  const paginaAtual = location.pathname.split('/').pop() || 'index.html';

  if (!usuario) {
    location.replace(`login.html?redirect=${encodeURIComponent(paginaAtual + location.search)}`);
    return new Promise(() => {});
  }

  if (!papeisPermitidos.includes(usuario.papel)) {
    location.replace(painelDoPapel(usuario.papel));
    return new Promise(() => {});
  }

  esconderOverlay();
  return usuario;
}

/**
 * Para páginas públicas que só querem saber se há alguém logado
 * (a landing usa isso para trocar "Entrar" por "Minha Área").
 */
export async function usuarioOpcional() {
  try {
    return await carregarUsuario();
  } catch (err) {
    console.error('[auth] falha ao carregar usuário:', err);
    return null;
  }
}

/** Atalhos de papel. */
export const ehAdmin = (usuario) => usuario?.papel === 'admin';
export const ehProfessor = (usuario) => usuario?.papel === 'professor' || usuario?.papel === 'admin';
