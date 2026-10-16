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
 *
 * VALIDADE E RESTRIÇÕES
 * Os pacotes têm prazo para uso (4 aulas = 30 dias, 9 = 40, 12 = 60) e os
 * planos mensais só valem para sábado e domingo. Por isso os créditos são
 * organizados em LOTES: cada compra gera um lote com a própria data de
 * expiração e as próprias regras. Os débitos consomem os lotes que vencem
 * primeiro (FEFO), para o aluno não perder crédito à toa.
 */

import { listar, criar } from './store.js';
import { dataDeISO } from './ui.js';

/* --------------------------------------------------------------------------
   Lotes de crédito
   -------------------------------------------------------------------------- */

/** Um lote está vencido se passou da data de expiração. */
export function loteVencido(lote, agora = new Date()) {
  return !!lote.expiraEm && new Date(lote.expiraEm) < agora;
}

/**
 * Monta os lotes de crédito do aluno, já descontando o que foi usado.
 *
 * Cada lançamento positivo vira um lote; os negativos consomem os lotes em
 * ordem de vencimento (os que expiram antes saem primeiro). Lotes já
 * vencidos não recebem consumo nem entram no saldo.
 */
function montarLotes(lancamentos, agora = new Date()) {
  const entradas = lancamentos
    .filter((l) => Number(l.delta) > 0)
    .map((l) => ({
      compraId: l.compraId || null,
      nomePacote: l.nomePacote || null,
      pacoteId: l.pacoteId || null,
      tipo: l.tipoPacote || 'grupo',
      apenasFimDeSemana: l.apenasFimDeSemana === true,
      expiraEm: l.expiraEm || null,
      criadoEm: l.criadoEm,
      restante: Number(l.delta),
      total: Number(l.delta),
    }));

  // Vence primeiro sai primeiro; sem prazo vai para o fim da fila.
  entradas.sort((a, b) => {
    if (a.expiraEm && b.expiraEm) return String(a.expiraEm).localeCompare(String(b.expiraEm));
    if (a.expiraEm) return -1;
    if (b.expiraEm) return 1;
    return String(a.criadoEm).localeCompare(String(b.criadoEm));
  });

  let aConsumir = lancamentos
    .filter((l) => Number(l.delta) < 0)
    .reduce((t, l) => t + Math.abs(Number(l.delta)), 0);

  for (const lote of entradas) {
    if (aConsumir <= 0) break;
    // Um lote vencido não pode mais absorver débitos.
    if (loteVencido(lote, agora)) continue;
    const usado = Math.min(lote.restante, aConsumir);
    lote.restante -= usado;
    aConsumir -= usado;
  }

  return entradas;
}

/** Lotes ainda utilizáveis: têm saldo e não venceram. */
export function lotesVigentes(lancamentos, agora = new Date()) {
  return montarLotes(lancamentos, agora).filter((l) => l.restante > 0 && !loteVencido(l, agora));
}

/* --------------------------------------------------------------------------
   Saldo
   -------------------------------------------------------------------------- */

/** Soma apenas os créditos vigentes (não vencidos). */
export async function saldoCreditos(alunoId) {
  const lancamentos = await listar('creditos', { alunoId });
  return lotesVigentes(lancamentos).reduce((t, l) => t + l.restante, 0);
}

/**
 * Versão para uso DENTRO de uma transação — recebe o contexto de operações
 * para ler o estado corrente sem escapar do bloco atômico.
 */
export async function saldoCreditosEm(ops, alunoId) {
  const lancamentos = await ops.listar('creditos', { alunoId });
  return lotesVigentes(lancamentos).reduce((t, l) => t + l.restante, 0);
}

/** Quantos créditos o aluno perdeu por vencimento. */
export async function creditosVencidos(alunoId) {
  const lancamentos = await listar('creditos', { alunoId });
  const agora = new Date();
  return montarLotes(lancamentos, agora)
    .filter((l) => l.restante > 0 && loteVencido(l, agora))
    .reduce((t, l) => t + l.restante, 0);
}

/* --------------------------------------------------------------------------
   Uso dos créditos em uma data
   -------------------------------------------------------------------------- */

const ehFimDeSemana = (dataISO) => [0, 6].includes(dataDeISO(dataISO).getDay());

/**
 * Verifica se o aluno pode agendar na data indicada e devolve o lote que
 * seria usado. Créditos de plano mensal só valem para sábado e domingo.
 *
 * Retorna { pode, lote, motivo }.
 */
export function avaliarUsoNaData(lancamentos, dataISO, agora = new Date()) {
  const vigentes = lotesVigentes(lancamentos, agora);
  if (!vigentes.length) {
    return { pode: false, lote: null, motivo: 'SEM_CREDITOS' };
  }

  const fds = ehFimDeSemana(dataISO);
  // Prioriza o crédito mais restrito que serve para a data: assim o aluno
  // gasta primeiro o que tem menos flexibilidade.
  const utilizaveis = vigentes.filter((l) => !l.apenasFimDeSemana || fds);

  if (!utilizaveis.length) {
    return { pode: false, lote: null, motivo: 'APENAS_FIM_DE_SEMANA' };
  }

  const escolhido = [...utilizaveis].sort((a, b) => {
    if (a.apenasFimDeSemana !== b.apenasFimDeSemana) return a.apenasFimDeSemana ? -1 : 1;
    return 0;
  })[0];

  return { pode: true, lote: escolhido, motivo: null };
}

/** Mesma avaliação, buscando os lançamentos do aluno. */
export async function avaliarUsoNaDataDoAluno(alunoId, dataISO) {
  const lancamentos = await listar('creditos', { alunoId });
  return avaliarUsoNaData(lancamentos, dataISO);
}

/* --------------------------------------------------------------------------
   Lançamentos
   -------------------------------------------------------------------------- */

/**
 * Registra um lançamento. Use `ops` quando estiver dentro de uma transação
 * (agendamento, cancelamento, confirmação de pagamento).
 */
export function lancarCredito(ops, {
  alunoId, delta, motivo, compraId = null, agendamentoId = null, observacao = null,
  // Metadados do lote: prazo de uso e restrições do pacote de origem.
  nomePacote = null, pacoteId = null, tipoPacote = null,
  apenasFimDeSemana = false, expiraEm = null,
}) {
  return ops.criar('creditos', {
    alunoId,
    delta: Number(delta),
    motivo,
    nomePacote,
    pacoteId,
    tipoPacote,
    apenasFimDeSemana,
    expiraEm,
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
    listar('creditos', { alunoId }),
    listar('compras', { alunoId, status: 'pago' }),
  ]);

  const mapaCompras = new Map(compras.map((c) => [c.id, c]));

  // Usa a mesma montagem de lotes do saldo, para não haver duas verdades.
  const vigentes = lotesVigentes(lancamentos);

  const agrupado = new Map();
  for (const lote of vigentes) {
    const compra = lote.compraId ? mapaCompras.get(lote.compraId) : null;
    const nomePacote = lote.nomePacote
      || compra?.nomePacote
      || 'Crédito avulso';
    const tipo = lote.tipo
      || (compra?.pacoteId === 'pac-individual' ? 'individual' : 'grupo');

    const chave = `${tipo}::${nomePacote}::${lote.expiraEm || 'sem-prazo'}`;
    const atual = agrupado.get(chave);

    if (atual) {
      atual.quantidade += lote.restante;
    } else {
      agrupado.set(chave, {
        tipo,
        nomePacote,
        quantidade: lote.restante,
        expiraEm: lote.expiraEm || null,
        apenasFimDeSemana: lote.apenasFimDeSemana === true,
      });
    }
  }

  return Array.from(agrupado.values()).sort((a, b) => {
    // Mostra primeiro o que vence antes, para o aluno usar na ordem certa.
    if (a.expiraEm && b.expiraEm) return String(a.expiraEm).localeCompare(String(b.expiraEm));
    if (a.expiraEm) return -1;
    if (b.expiraEm) return 1;
    return b.quantidade - a.quantidade;
  });
}

/** Dias restantes até o vencimento (null quando não há prazo). */
export function diasAteVencer(expiraEm) {
  if (!expiraEm) return null;
  const ms = new Date(expiraEm).getTime() - Date.now();
  return Math.ceil(ms / 86400000);
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

  const agora = new Date();
  const lotes = lotesVigentes(lancamentos, agora);
  const saldo = lotes.reduce((t, l) => t + l.restante, 0);

  // Créditos prestes a vencer (7 dias) merecem destaque no painel.
  const vencendoEmBreve = lotes
    .filter((l) => {
      const dias = diasAteVencer(l.expiraEm);
      return dias !== null && dias <= 7;
    })
    .reduce((t, l) => t + l.restante, 0);

  const proximoVencimento = lotes
    .filter((l) => l.expiraEm)
    .sort((a, b) => String(a.expiraEm).localeCompare(String(b.expiraEm)))[0]?.expiraEm || null;

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
    vencendoEmBreve,
    proximoVencimento,
    totalAgendadas: confirmados.length,
    totalRealizadas: realizados.length,
    aulasNoMes: noMes,
  };
}
