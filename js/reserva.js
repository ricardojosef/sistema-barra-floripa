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

/** A aula escolhida no rascunho, no formato gravado na compra (ou null). */
export function reservaDoRascunho(rascunho = lerRascunho()) {
  if (!rascunho.data || !rascunho.horario) return null;
  return {
    data: rascunho.data,
    horario: rascunho.horario,
    localId: rascunho.localId || null,
    tipo: rascunho.tipo === 'individual' ? 'individual' : 'grupo',
  };
}

/* --------------------------------------------------------------------------
   Conclusão depois do pagamento
   -------------------------------------------------------------------------- */

/**
 * Agenda a aula reservada numa compra já paga. Idempotente: compras com a
 * reserva resolvida são ignoradas. Devolve { status, agendamento?, erro? }.
 */
export async function concluirReserva(compra, usuario) {
  if (!compra?.reserva || compra.status !== 'pago') return { status: 'sem-reserva' };
  if (compra.reservaStatus && compra.reservaStatus !== 'pendente') {
    return { status: compra.reservaStatus };
  }

  try {
    const agendamento = await agendar({
      alunoId: usuario.id,
      alunoNome: usuario.nome,
      data: compra.reserva.data,
      horario: compra.reserva.horario,
      localId: compra.reserva.localId,
      tipo: compra.reserva.tipo,
    });
    await atualizar('compras', compra.id, {
      reservaStatus: 'agendada',
      reservaAgendamentoId: agendamento.id,
      reservaErro: null,
    });
    return { status: 'agendada', agendamento };
  } catch (err) {
    const mensagem = err instanceof ErroAgenda ? err.message : 'Não foi possível agendar a aula escolhida.';
    // Aula duplicada = já foi agendada em outra aba: não é falha.
    const status = err instanceof ErroAgenda && err.codigo === 'SLOT_DUPLICADO' ? 'agendada' : 'falhou';
    try {
      await atualizar('compras', compra.id, { reservaStatus: status, reservaErro: status === 'falhou' ? mensagem : null });
    } catch (e) {
      console.warn('[reserva] não foi possível atualizar a compra:', e);
    }
    return { status, erro: status === 'falhou' ? mensagem : null };
  }
}

/** Resolve todas as reservas pagas e ainda pendentes do aluno (painel). */
export async function concluirReservasPendentes(usuario) {
  const compras = await listar('compras', { alunoId: usuario.id, status: 'pago' });
  const pendentes = compras.filter((c) => c.reserva && (!c.reservaStatus || c.reservaStatus === 'pendente'));
  const resultados = [];
  for (const compra of pendentes) {
    resultados.push({ compra, ...(await concluirReserva(compra, usuario)) });
  }
  return resultados;
}

/** Reservas que falharam (vaga acabou) e o aluno ainda não reagendou. */
export async function reservasQueFalharam(alunoId) {
  const compras = await listar('compras', { alunoId, status: 'pago' });
  return compras.filter((c) => c.reserva && c.reservaStatus === 'falhou');
}
