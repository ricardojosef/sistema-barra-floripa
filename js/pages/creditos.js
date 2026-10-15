/**
 * creditos.js (página) — extrato de créditos e histórico de compras.
 */

import { exigirAuth, sair } from '../auth.js';
import { saldoCreditos, extratoCreditos, creditosPorOrigem } from '../creditos.js';
import { listar } from '../store.js';
import { nomeMetodo } from '../pagamentos.js';
import {
  qs, el, formatarBRL, formatarData, tempoRelativo,
  montarShellPainel, toast, vazio,
} from '../ui.js';

let usuario = null;

const ICONES_MOTIVO = {
  compra: '💳',
  agendamento: '📅',
  cancelamento: '↩️',
  ajuste: '⚙️',
};

async function montarExtrato() {
  const alvo = qs('#extrato');
  const lancamentos = await extratoCreditos(usuario.id);

  alvo.innerHTML = '';
  if (!lancamentos.length) {
    alvo.append(vazio('Nenhuma movimentação ainda.', '📋', { href: 'checkout.html', texto: 'Comprar pacote' }));
    return;
  }

  for (const lancamento of lancamentos) {
    const positivo = lancamento.delta > 0;
    alvo.append(el('div', { class: 'item-aula' }, [
      el('div', {
        class: 'data-bloco',
        style: positivo ? 'background:var(--verde)' : 'background:var(--cinza-500)',
      }, [
        el('span', { class: 'dia', style: 'font-size:1rem', text: `${positivo ? '+' : ''}${lancamento.delta}` }),
      ]),
      el('div', { class: 'info' }, [
        el('div', { class: 'titulo', text: lancamento.rotulo }),
        el('div', {
          class: 'meta',
          text: `${formatarData(String(lancamento.criadoEm).slice(0, 10))} · ${tempoRelativo(lancamento.criadoEm)}`,
        }),
      ]),
      el('span', { class: 'texto-peq', text: ICONES_MOTIVO[lancamento.motivo] || '•' }),
    ]));
  }
}

async function montarPorOrigem(saldo) {
  const alvo = qs('#por-origem');
  alvo.innerHTML = '';

  if (saldo <= 0) {
    alvo.append(vazio('Sem créditos disponíveis.', '🎟️', { href: 'checkout.html', texto: 'Comprar pacote' }));
    return;
  }

  const origens = await creditosPorOrigem(usuario.id);
  for (const origem of origens) {
    alvo.append(el('div', { class: 'cartao-credito' }, [
      el('div', { class: 'qtd', text: String(origem.quantidade) }),
      el('div', {
        class: 'rotulo',
        text: `${origem.quantidade === 1 ? 'Crédito' : 'Créditos'} ${origem.tipo === 'individual' ? 'Individual' : 'Grupo'}`,
      }),
      el('div', { class: 'origem', text: origem.nomePacote }),
      el('a', { class: 'btn btn-primario btn-peq', href: 'agendar.html', text: 'Agendar aula' }),
    ]));
  }
}

async function montarCompras() {
  const alvo = qs('#lista-compras');
  const compras = await listar('compras', { alunoId: usuario.id }, {
    ordenarPor: 'criadoEm',
    direcao: 'desc',
  });

  alvo.innerHTML = '';
  const pagas = compras.filter((c) => c.status !== 'cancelado');

  if (!pagas.length) {
    alvo.append(vazio('Nenhuma compra registrada.', '🧾'));
    return;
  }

  for (const compra of pagas) {
    const badge = compra.status === 'pago'
      ? el('span', { class: 'badge badge-sucesso', text: 'Pago' })
      : el('span', { class: 'badge badge-aviso', text: 'Pendente' });

    alvo.append(el('div', { class: 'mini-pacote' }, [
      el('div', {}, [
        el('div', { class: 'negrito texto-peq', text: compra.nomePacote }),
        el('div', {
          class: 'texto-min texto-cinza',
          text: `${formatarData(String(compra.criadoEm).slice(0, 10))} · ${nomeMetodo(compra.metodo)} · ${compra.creditos} ${compra.creditos === 1 ? 'crédito' : 'créditos'}`,
        }),
      ]),
      el('div', { class: 'texto-direita' }, [
        el('div', { class: 'preco', text: formatarBRL(compra.valor) }),
        badge,
      ]),
    ]));
  }
}

async function iniciar() {
  usuario = await exigirAuth(['aluno']);

  montarShellPainel({
    usuario,
    paginaAtual: 'creditos',
    chipCreditos: true,
    aoSair: () => sair(),
  });

  try {
    const [saldo, lancamentos] = await Promise.all([
      saldoCreditos(usuario.id),
      listar('creditos', { alunoId: usuario.id }),
    ]);

    const comprados = lancamentos
      .filter((l) => l.delta > 0 && l.motivo === 'compra')
      .reduce((t, l) => t + l.delta, 0);
    const usados = lancamentos
      .filter((l) => l.delta < 0)
      .reduce((t, l) => t + Math.abs(l.delta), 0);

    qs('#stat-saldo').textContent = String(saldo);
    qs('#stat-usados').textContent = String(usados);
    qs('#stat-comprados').textContent = String(comprados);

    const chip = qs('#chip-creditos-valor');
    if (chip) chip.textContent = String(saldo);

    await Promise.all([montarExtrato(), montarPorOrigem(saldo), montarCompras()]);
  } catch (err) {
    console.error('[creditos] falha ao carregar:', err);
    toast('Não foi possível carregar seus créditos.', 'erro');
  }
}

iniciar();
