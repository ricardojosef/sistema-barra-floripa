/**
 * reserva.js — o carrinho do fluxo "agendar antes de ter conta".
 *
 * Como num site de passagens: o visitante escolhe o plano e a aula, depois
 * se identifica (a conta nasce aqui), responde o questionário de saúde e
 * paga. Até a conta existir, as escolhas ficam neste rascunho, no navegador.
 *
 * Depois do pagamento a aula escolhida precisa virar agendamento. A compra
 * leva a reserva junto (`compras.reserva`, `reservaStatus: 'pendente'`):
 *   - no modo demonstração, o checkout agenda logo após confirmar;
 *   - em produção o crédito é lançado pelo servidor (webhook) e quem agenda
 *     é o navegador do aluno, ao voltar do Mercado Pago — ou, se ele fechou
 *     a aba, na próxima vez que abrir o painel (concluirReservasPendentes).
 * Se a vaga tiver acabado nesse meio-tempo, o crédito continua com o aluno
 * e o painel avisa para escolher outro horário.
 */

import { listar, atualizar } from './store.js';
import { agendar, ErroAgenda } from './agenda.js';

const CHAVE = 'bf_reserva';
const VALIDADE_MS = 1000 * 60 * 60 * 6; // rascunho vale 6 horas

/* --------------------------------------------------------------------------
   Rascunho no navegador
   -------------------------------------------------------------------------- */

export function lerRascunho() {
  try {
    const bruto = JSON.parse(localStorage.getItem(CHAVE) || 'null');
    if (!bruto || Date.now() - Number(bruto.atualizadoEm || 0) > VALIDADE_MS) return {};
    // Rascunho da versão anterior (uma aula só, em data/horario/localId).
    if (!Array.isArray(bruto.aulas)) {
      bruto.aulas = bruto.data && bruto.horario
        ? [{ data: bruto.data, horario: bruto.horario, localId: bruto.localId || null }]
        : [];
    }
    return bruto;
  } catch {
    return {};
  }
}

export function salvarRascunho(campos) {
  const novo = { ...lerRascunho(), ...campos, atualizadoEm: Date.now() };
  try { localStorage.setItem(CHAVE, JSON.stringify(novo)); } catch { /* navegação privada */ }
  return novo;
}

export function limparRascunho() {
  try { localStorage.removeItem(CHAVE); } catch { /* nada a fazer */ }
}

/** Aulas escolhidas no rascunho, em ordem, no formato gravado na compra. */
export function reservasDoRascunho(rascunho = lerRascunho()) {
  const tipo = rascunho.tipo === 'individual' ? 'individual' : 'grupo';
  return ordenarAulas(rascunho.aulas || [])
    .filter((a) => a.data && a.horario)
    .map((a) => ({ data: a.data, horario: a.horario, localId: a.localId || null, tipo }));
}

export const ordenarAulas = (aulas) => [...aulas]
  .sort((a, b) => `${a.data} ${a.horario}`.localeCompare(`${b.data} ${b.horario}`));

/**
 * Aulas reservadas numa compra. Compras novas guardam a lista em
 * `reservas`; as da versão anterior, uma aula só em `reserva`.
 */
export function aulasDaCompra(compra) {
  if (Array.isArray(compra?.reservas) && compra.reservas.length) return compra.reservas;
  return compra?.reserva ? [compra.reserva] : [];
}

/* --------------------------------------------------------------------------
   Conclusão depois do pagamento
   -------------------------------------------------------------------------- */

/**
 * Agenda as aulas reservadas numa compra já paga. Idempotente: compras com
 * a reserva resolvida são ignoradas, e uma aula que já foi agendada (outra
 * aba, tentativa anterior) conta como agendada.
 *
 * Devolve { status: 'agendada' | 'parcial' | 'falhou' | ..., agendadas, falhas, erro }.
 */
export async function concluirReserva(compra, usuario) {
  const aulas = aulasDaCompra(compra);
  if (!aulas.length || compra.status !== 'pago') return { status: 'sem-reserva', agendadas: [], falhas: [] };
  if (compra.reservaStatus && compra.reservaStatus !== 'pendente') {
    return { status: compra.reservaStatus, agendadas: [], falhas: compra.reservaFalhas || [] };
  }

  const agendadas = [];
  const falhas = [];
  for (const aula of aulas) {
    try {
      const agendamento = await agendar({
        alunoId: usuario.id,
        alunoNome: usuario.nome,
        data: aula.data,
        horario: aula.horario,
        localId: aula.localId,
        tipo: aula.tipo,
      });
      agendadas.push({ ...aula, agendamentoId: agendamento.id });
    } catch (err) {
      // Aula duplicada = já foi agendada em outra aba: não é falha.
      if (err instanceof ErroAgenda && err.codigo === 'SLOT_DUPLICADO') {
        agendadas.push({ ...aula, agendamentoId: null });
        continue;
      }
      const mensagem = err instanceof ErroAgenda ? err.message : 'Não foi possível agendar a aula escolhida.';
      falhas.push({ data: aula.data, horario: aula.horario, localId: aula.localId || null, erro: mensagem });
    }
  }

  const status = !falhas.length ? 'agendada' : agendadas.length ? 'parcial' : 'falhou';
  try {
    await atualizar('compras', compra.id, {
      reservaStatus: status,
      reservaAgendamentoIds: agendadas.map((a) => a.agendamentoId).filter(Boolean),
      reservaFalhas: falhas,
      reservaErro: falhas[0]?.erro || null,
    });
  } catch (e) {
    console.warn('[reserva] não foi possível atualizar a compra:', e);
  }
  return { status, agendadas, falhas, erro: falhas[0]?.erro || null };
}

/** Resolve todas as reservas pagas e ainda pendentes do aluno (painel). */
export async function concluirReservasPendentes(usuario) {
  const compras = await listar('compras', { alunoId: usuario.id, status: 'pago' });
  const pendentes = compras.filter((c) => aulasDaCompra(c).length && (!c.reservaStatus || c.reservaStatus === 'pendente'));
  const resultados = [];
  for (const compra of pendentes) {
    resultados.push({ compra, ...(await concluirReserva(compra, usuario)) });
  }
  return resultados;
}

/**
 * Reservas com aula que não entrou (a vaga acabou) e que o aluno ainda não
 * dispensou. Cada item traz `falhas`: [{ data, horario }].
 */
export async function reservasQueFalharam(alunoId) {
  const compras = await listar('compras', { alunoId, status: 'pago' });
  return compras
    .filter((c) => c.reservaStatus === 'falhou' || c.reservaStatus === 'parcial')
    .map((c) => ({
      ...c,
      falhas: c.reservaFalhas?.length ? c.reservaFalhas : (c.reserva ? [c.reserva] : []),
    }))
    .filter((c) => c.falhas.length);
}
