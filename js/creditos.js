/**
 * creditos.js — saldo e extrato de créditos do aluno.
 *
 * Regra central: o saldo NUNCA é um campo armazenado. Ele é sempre a soma
 * dos lançamentos da coleção `creditos`. Cada lançamento tem um `delta`:
 *
 *   +N  motivo 'compra'        -> pacote pago
 *   -1  motivo 'agendamento'   -> aula marcada
 *   +1  motivo 'cancelamento'  -> aula cancelada, crédito devolvido
 *   ±N  motivo 'ajuste'        -> correção manual do administrador
 *
 * Assim o saldo e o histórico nunca divergem: se um deles estiver errado,
 * os dois estão, e dá para auditar lançamento por lançamento.
 */

import { listar, criar } from './store.js';

/* --------------------------------------------------------------------------
   Saldo
   -------------------------------------------------------------------------- */

/** Soma todos os lançamentos do aluno. */
export async function saldoCreditos(alunoId) {
  const lancamentos = await listar('creditos', { alunoId });
  return lancamentos.reduce((total, l) => total + (Number(l.delta) || 0), 0);
}

/**
 * Versão para uso DENTRO de uma transação — recebe o contexto de operações
 * para ler o estado corrente sem escapar do bloco atômico.
 */
export async function saldoCreditosEm(ops, alunoId) {
  const lancamentos = await ops.listar('creditos', { alunoId });
  return lancamentos.reduce((total, l) => total + (Number(l.delta) || 0), 0);
}

/* --------------------------------------------------------------------------
   Lançamentos
   -------------------------------------------------------------------------- */

/**
 * Registra um lançamento. Use `ops` quando estiver dentro de uma transação
 * (agendamento, cancelamento, confirmação de pagamento).
 */
export function lancarCredito(ops, { alunoId, delta, motivo, compraId = null, agendamentoId = null, observacao = null }) {
  return ops.criar('creditos', {
    alunoId,
    delta: Number(delta),
    motivo,
    compraId,
    agendamentoId,
    observacao,
    criadoEm: new Date().toISOString(),
  });
}

/** Mesma coisa, fora de transação (ajuste manual do admin). */
export function lancarCreditoAvulso(dados) {
  return criar('creditos', {
    ...dados,
    delta: Number(dados.delta),
    criadoEm: new Date().toISOString(),
  });
}

/* --------------------------------------------------------------------------
   Extrato
   -------------------------------------------------------------------------- */

const ROTULOS_MOTIVO = {
  compra: 'Compra de pacote',
  agendamento: 'Aula agendada',
  cancelamento: 'Aula cancelada — crédito devolvido',
  ajuste: 'Ajuste da escola',
};

export const rotuloMotivo = (motivo) => ROTULOS_MOTIVO[motivo] || 'Lançamento';

/** Extrato do aluno, do mais recente para o mais antigo. */
export async function extratoCreditos(alunoId, limite = null) {
  const lancamentos = await listar('creditos', { alunoId }, {
    ordenarPor: 'criadoEm',
    direcao: 'desc',
    ...(limite ? { limite } : {}),
  });
  return lancamentos.map((l) => ({ ...l, rotulo: rotuloMotivo(l.motivo) }));
}

/* --------------------------------------------------------------------------
   Créditos por origem (exibição no dashboard)
   -------------------------------------------------------------------------- */

/**
 * Agrupa os créditos ainda não usados por compra de origem, para mostrar
 * cartões como "2 Créditos Grupo — Pacote 4 aulas".
 *
 * Consome as compras em ordem cronológica (FIFO): os créditos mais antigos
 * são considerados usados primeiro, que é o que o aluno espera ver.
 */
export async function creditosPorOrigem(alunoId) {
  const [lancamentos, compras] = await Promise.all([
    listar('creditos', { alunoId }, { ordenarPor: 'criadoEm', direcao: 'asc' }),
    listar('compras', { alunoId, status: 'pago' }),
  ]);

  const mapaCompras = new Map(compras.map((c) => [c.id, c]));

  // Lotes de crédito em ordem de chegada.
  const lotes = lancamentos
    .filter((l) => l.delta > 0)
    .map((l) => {
      const compra = l.compraId ? mapaCompras.get(l.compraId) : null;
      return {
        compraId: l.compraId,
        nomePacote: compra?.nomePacote || (l.motivo === 'cancelamento' ? 'Crédito devolvido' : 'Crédito avulso'),
        tipo: compra?.pacoteId === 'pac-individual' ? 'individual' : 'grupo',
        restante: Number(l.delta) || 0,
        criadoEm: l.criadoEm,
      };
    });

  // Débitos consomem os lotes mais antigos primeiro.
  let aConsumir = lancamentos
    .filter((l) => l.delta < 0)
    .reduce((total, l) => total + Math.abs(Number(l.delta) || 0), 0);

  for (const lote of lotes) {
    if (aConsumir <= 0) break;
    const usado = Math.min(lote.restante, aConsumir);
    lote.restante -= usado;
    aConsumir -= usado;
  }

  // Agrupa o que sobrou por pacote de origem.
  const agrupado = new Map();
  for (const lote of lotes) {
    if (lote.restante <= 0) continue;
    const chave = `${lote.tipo}::${lote.nomePacote}`;
    const atual = agrupado.get(chave);
    if (atual) atual.quantidade += lote.restante;
    else agrupado.set(chave, { tipo: lote.tipo, nomePacote: lote.nomePacote, quantidade: lote.restante });
  }

  return Array.from(agrupado.values()).sort((a, b) => b.quantidade - a.quantidade);
}

/* --------------------------------------------------------------------------
   Resumo para o dashboard
   -------------------------------------------------------------------------- */

/** Saldo, total de aulas realizadas e agendadas — em uma passada só. */
export async function resumoAluno(alunoId) {
  const [lancamentos, agendamentos] = await Promise.all([
    listar('creditos', { alunoId }),
    listar('agendamentos', { alunoId }),
  ]);

  const saldo = lancamentos.reduce((t, l) => t + (Number(l.delta) || 0), 0);
  const confirmados = agendamentos.filter((a) => a.status === 'confirmado');
  const realizados = agendamentos.filter((a) => a.status === 'realizado');

  // Aulas deste mês (confirmadas ou já realizadas).
  const inicioMes = new Date();
  inicioMes.setDate(1);
  inicioMes.setHours(0, 0, 0, 0);
  const inicioMesISO = inicioMes.toISOString().slice(0, 10);

  const noMes = [...confirmados, ...realizados].filter((a) => a.data >= inicioMesISO).length;

  return {
    saldo,
    totalAgendadas: confirmados.length,
    totalRealizadas: realizados.length,
    aulasNoMes: noMes,
  };
}
