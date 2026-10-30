/**
 * mensagens.js (página) — recados que a equipe mandou para o aluno.
 *
 * Abrir a mensagem (clicar nela) marca como lida; há também o botão de
 * marcar todas de uma vez. O contador do menu é atualizado em seguida.
 */

import { exigirAuth, sair } from '../auth.js';
import { mensagensRecebidas, marcarComoLida } from '../mensagens.js';
import { carregarContexto } from '../precos.js';
import { saldoCreditos } from '../creditos.js';
import {
  qs, qsa, el, iniciais, formatarData, tempoRelativo, montarShellPainel, toast, vazio,
  botaoCarregando, atualizarBadgeMensagens,
} from '../ui.js';

let usuario = null;
let contexto = null;
let mensagens = [];
let filtroAtual = 'todas';

function cartaoMensagem(m) {
  const naoLida = !m.lidaEm;
  const turma = m.turma?.data
    ? `Sobre a aula de ${formatarData(m.turma.data)} às ${m.turma.horario}`
      + `${m.turma.professorId ? ` · Prof. ${contexto.mapaProfessores.get(m.turma.professorId)?.nome || ''}` : ''}`
    : '';

  return el('article', {
    class: `mensagem-recebida ${naoLida ? 'nao-lida' : ''}`,
    dataset: { id: m.id },
    onclick: naoLida ? () => lerMensagem(m) : null,
    style: naoLida ? 'cursor:pointer' : null,
    title: naoLida ? 'Clique para marcar como lida' : null,
  }, [
    el('span', { class: 'avatar', text: iniciais(m.remetenteNome || 'Barra Floripa') }),
    el('div', { class: 'cresce' }, [
      el('div', { class: 'flex entre itens-centro gap-8 quebra' }, [
        el('strong', { text: m.remetenteNome || 'Equipe Barra Floripa' }),
        el('span', { class: 'flex itens-centro gap-8' }, [
          naoLida ? el('span', { class: 'badge badge-laranja', text: 'Nova' }) : null,
          el('span', { class: 'texto-min texto-cinza', text: tempoRelativo(m.criadoEm) }),
        ]),
      ]),
      turma ? el('div', { class: 'texto-min texto-cinza', text: turma }) : null,
      el('p', { class: 'mensagem-texto', text: m.texto }),
    ]),
  ]);
}

function renderizar() {
  const alvo = qs('#lista-mensagens');
  const naoLidas = mensagens.filter((m) => !m.lidaEm);
  const visiveis = filtroAtual === 'nao-lidas' ? naoLidas : mensagens;

  qs('#resumo-mensagens').textContent = mensagens.length
    ? `${mensagens.length} ${mensagens.length === 1 ? 'mensagem' : 'mensagens'}`
      + (naoLidas.length ? ` · ${naoLidas.length} não ${naoLidas.length === 1 ? 'lida' : 'lidas'}` : '')
    : '';
  qs('#btn-marcar-todas').classList.toggle('oculto', !naoLidas.length);

  alvo.innerHTML = '';
  if (!visiveis.length) {
    alvo.append(vazio(
      filtroAtual === 'nao-lidas'
        ? 'Nenhuma mensagem nova.'
        : 'Você ainda não recebeu mensagens. Quando um professor escrever para a sua turma, o recado aparece aqui.',
      '💬',
    ));
    return;
  }
  visiveis.forEach((m) => alvo.append(cartaoMensagem(m)));
}

async function lerMensagem(m) {
  try {
    await marcarComoLida(m.id);
    m.lidaEm = new Date().toISOString();
    renderizar();
    atualizarBadgeMensagens(usuario.id);
  } catch (err) {
    console.error('[mensagens] falha ao marcar como lida:', err);
    toast('Não foi possível marcar a mensagem como lida.', 'erro');
  }
}

async function marcarTodas(btn) {
  const restaurar = botaoCarregando(btn, 'Marcando...');
  try {
    for (const m of mensagens.filter((x) => !x.lidaEm)) {
      await marcarComoLida(m.id);
      m.lidaEm = new Date().toISOString();
    }
    toast('Todas as mensagens foram marcadas como lidas.', 'sucesso');
  } catch (err) {
    console.error('[mensagens] falha ao marcar todas:', err);
    toast('Algumas mensagens não foram marcadas. Tente de novo.', 'erro');
  } finally {
    restaurar();
    renderizar();
    atualizarBadgeMensagens(usuario.id);
  }
}

async function iniciar() {
  usuario = await exigirAuth(['aluno']);
  montarShellPainel({ usuario, paginaAtual: 'mensagens', aoSair: () => sair(), chipCreditos: true });

  qsa('#abas-mensagens .aba').forEach((b) => b.addEventListener('click', () => {
    filtroAtual = b.dataset.filtro;
    qsa('#abas-mensagens .aba').forEach((x) => x.classList.toggle('ativa', x === b));
    renderizar();
  }));
  qs('#btn-marcar-todas').addEventListener('click', (ev) => marcarTodas(ev.currentTarget));

  try {
    let saldo;
    [contexto, mensagens, saldo] = await Promise.all([
      carregarContexto(), mensagensRecebidas(usuario.id), saldoCreditos(usuario.id),
    ]);
    qs('#chip-creditos-valor').textContent = String(saldo);
    renderizar();
  } catch (err) {
    console.error('[mensagens] falha ao carregar:', err);
    qs('#lista-mensagens').innerHTML = '';
    qs('#lista-mensagens').append(vazio('Não foi possível carregar as mensagens. Recarregue a página.', '⚠️'));
  }
}

iniciar();
