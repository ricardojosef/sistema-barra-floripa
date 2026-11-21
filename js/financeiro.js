/**
 * financeiro.js — quanto cada professor tem a receber pelas aulas dadas.
 *
 * Regra (editável pelo administrador):
 *   aula em grupo  -> valor por aluno × alunos da turma
 *   particular     -> valor fixo por aula
 * Os valores vêm de `config/app.remuneracao` (padrão da escola) e podem ser
 * sobrescritos por professor (`professores/{id}.remuneracao`).
 *
 * Conta só aula que JÁ ACONTECEU e não foi cancelada. Aluno que faltou sem
 * justificativa conta (o professor estava na praia), a não ser que o
 * administrador desligue `contarAusentes`. Falta justificada vira
 * cancelamento, então sai da conta sozinha.
 *
 * Saldo = ganho total − repasses já pagos (coleção `repasses`, que só o
 * administrador grava).
 */

import { listar, criar, remover, obter } from './store.js';
import { obterConfig, obterProfessores } from './precos.js';
import { usuarioAtual } from './auth.js';
import { dataHoraDe } from './ui.js';

/** Valores efetivos de um professor. */
export function tabelaDoProfessor(professor, config) {
  return { ...config.remuneracao, ...(professor?.remuneracao || {}) };
}

/** Aulas já realizadas (horário de término passado) e não canceladas. */
function aulaAconteceu(aula, agora) {
  if (aula.status === 'cancelado') return false;
  const fim = dataHoraDe(aula.data, aula.horario);
  fim.setMinutes(fim.getMinutes() + (aula.duracaoMin || 90));
  return fim <= agora;
}

/**
 * Turmas dadas pelo professor, com valor. `de`/`ate` filtram por data
 * ('YYYY-MM-DD', inclusive).
 */
export async function turmasRemuneradas(professorId, { de = null, ate = null } = {}) {
  const [config, professores, aulas] = await Promise.all([
    obterConfig(),
    obterProfessores({ incluirInativos: true }),
    listar('agendamentos', { professorId }),
  ]);
  const professor = professores.find((p) => p.id === professorId);
  const tabela = tabelaDoProfessor(professor, config);
  const agora = new Date();

  const grupos = new Map();
  for (const aula of aulas) {
    if (!aulaAconteceu(aula, agora)) continue;
    if (de && aula.data < de) continue;
    if (ate && aula.data > ate) continue;
    if (aula.presenca === 'ausente' && !tabela.contarAusentes) continue;
    const chave = `${aula.data}_${aula.horario}`;
    const g = grupos.get(chave) || { data: aula.data, horario: aula.horario, alunos: [], particular: false };
    g.alunos.push(aula);
    if (aula.tipo === 'individual') g.particular = true;
    grupos.set(chave, g);
  }

  return [...grupos.values()]
    .map((g) => ({
      ...g,
      quantidade: g.alunos.length,
      presentes: g.alunos.filter((a) => a.presenca === 'presente').length,
      ausentes: g.alunos.filter((a) => a.presenca === 'ausente').length,
      valor: g.particular
        ? Number(tabela.porAulaParticular) * g.alunos.filter((a) => a.tipo === 'individual').length
          + Number(tabela.porAlunoGrupo) * g.alunos.filter((a) => a.tipo !== 'individual').length
        : Number(tabela.porAlunoGrupo) * g.alunos.length,
    }))
    .sort((a, b) => (b.data + b.horario).localeCompare(a.data + a.horario));
}

/**
 * Pagamentos já feitos ao professor. O professor só enxerga os próprios: a
 * consulta filtra pelo usuário dele, que é o que as regras do Firestore
 * conferem (um professor não vê quanto o colega recebe).
 */
export async function repassesDoProfessor(professorId) {
  const eu = usuarioAtual();
  const filtros = eu?.papel === 'admin' ? { professorId } : { professorId, professorUsuarioId: eu?.id || '-' };
  return listar('repasses', filtros, { ordenarPor: 'data', direcao: 'desc' });
}

/** Resumo para o painel: total ganho, pago, saldo e o mês corrente. */
export async function resumoFinanceiro(professorId) {
  const [turmas, repasses, config, professores] = await Promise.all([
    turmasRemuneradas(professorId),
    repassesDoProfessor(professorId),
    obterConfig(),
    obterProfessores({ incluirInativos: true }),
  ]);
  const mes = new Date().toISOString().slice(0, 7);
  const ganho = turmas.reduce((t, x) => t + x.valor, 0);
  const pago = repasses.reduce((t, r) => t + Number(r.valor || 0), 0);
  const doMes = turmas.filter((x) => x.data.startsWith(mes));
  return {
    tabela: tabelaDoProfessor(professores.find((p) => p.id === professorId), config),
    turmas,
    repasses,
    ganho,
    pago,
    saldo: Math.round((ganho - pago) * 100) / 100,
    ganhoMes: doMes.reduce((t, x) => t + x.valor, 0),
    aulasMes: doMes.length,
    alunosMes: doMes.reduce((t, x) => t + x.quantidade, 0),
  };
}

/** Administrador registra um pagamento feito ao professor. */
export async function registrarRepasse({ professorId, valor, data, observacao }, admin) {
  const numero = Number(String(valor).replace(',', '.'));
  if (!Number.isFinite(numero) || numero <= 0) throw new Error('Informe o valor pago.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(data))) throw new Error('Informe a data do pagamento.');
  const professor = await obter('professores', professorId);
  return criar('repasses', {
    professorId,
    professorUsuarioId: professor?.usuarioId || null,
    valor: Math.round(numero * 100) / 100,
    data,
    observacao: String(observacao || '').trim().slice(0, 160) || null,
    criadoPor: admin.id,
    criadoPorNome: admin.nome,
  });
}

export const removerRepasse = (id) => remover('repasses', id);
