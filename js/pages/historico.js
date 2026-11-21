/**
 * historico.js — lista completa das aulas do aluno, com filtro por status.
 *
 * Mostra presença/falta registrada na praia e, para aulas que não podem mais
 * ser canceladas pelo site (prazo encerrado ou falta), o botão de enviar
 * justificativa — com o andamento da análise da escola.
 */

import { exigirAuth, sair } from '../auth.js';
import { historicoDoAluno, cancelar, alunoPodeCancelar, ErroAgenda } from '../agenda.js';
import { saldoCreditos } from '../creditos.js';
import { carregarContexto, nomeLocal } from '../precos.js';
import { justificativasDoAluno } from '../justificativas.js';
import { abrirJustificativa } from '../justificativa-ui.js';
import { t } from '../i18n.js';
import {
  qs, qsa, el, dataDeISO, faixaHorario, formatarDataExtenso, MESES_CURTO,
  montarShellPainel, toast, confirmar, vazio,
} from '../ui.js';

let usuario = null;
let contexto = null;
let todasAulas = [];
let justificativasPorAula = new Map();
let filtroAtual = 'todas';

/** Pode justificar: confirmada fora do prazo de cancelamento, ou falta registrada. */
function podeJustificar(aula) {
  if (aula.status === 'cancelado') return false;
  if (aula.status === 'confirmado' && alunoPodeCancelar(aula, contexto.config)) return false;
  const j = justificativasPorAula.get(aula.id);
  return !j || j.status === 'recusada';
}

function cartaoAula(aula) {
  const data = dataDeISO(aula.data);
  const local = nomeLocal(contexto.mapaLocais, aula.localId);
  const cancelada = aula.status === 'cancelado';
  const justificativa = justificativasPorAula.get(aula.id);

  const item = el('div', { class: `item-aula ${cancelada ? 'cancelada' : ''}` }, [
    el('div', { class: 'data-bloco' }, [
      el('span', { class: 'dia', text: String(data.getDate()).padStart(2, '0') }),
      el('span', { class: 'mes', text: MESES_CURTO[data.getMonth()] }),
    ]),
    el('div', { class: 'info' }, [
      el('div', { class: 'titulo', text: aula.tipo === 'individual' ? t('aula.particular') : t('aula.grupo') }),
      el('div', { class: 'meta', text: `${faixaHorario(aula.horario, aula.duracaoMin)} · ${local}` }),
      cancelada && aula.motivoCancelamento
        ? el('div', { class: 'texto-min', style: 'color:var(--vermelho)', text: `Motivo: ${aula.motivoCancelamento}` })
        : null,
      justificativa
        ? el('div', {
          class: `texto-min ${justificativa.status === 'recusada' ? 'texto-perigo' : justificativa.status === 'aprovada' ? 'texto-sucesso' : 'texto-cinza'}`,
          text: `${t(`just.status.${justificativa.status}`)}${justificativa.resposta ? ` — ${justificativa.resposta}` : ''}`,
        })
        : null,
    ]),
  ]);

  const acoes = el('div', { class: 'flex-col gap-4 itens-centro' });

  const badges = {
    confirmado: ['badge-sucesso', t('aula.confirmada')],
    realizado: ['badge-info', t('aula.realizada')],
    cancelado: ['badge-perigo', t('aula.cancelada')],
  };
  const [classe, texto] = badges[aula.status] || ['badge-neutro', aula.status];
  acoes.append(el('span', { class: `badge ${classe}`, text: texto }));
  if (aula.presenca === 'presente') acoes.append(el('span', { class: 'badge badge-sucesso', text: t('aula.presente') }));
  if (aula.presenca === 'ausente' && !cancelada) acoes.append(el('span', { class: 'badge badge-perigo', text: t('aula.falta') }));

  if (aula.status === 'confirmado' && alunoPodeCancelar(aula, contexto.config)) {
    acoes.append(el('button', {
      class: 'btn btn-fantasma btn-peq', type: 'button', text: t('comum.cancelar'),
      onclick: () => cancelarAula(aula),
    }));
  } else if (podeJustificar(aula)) {
    acoes.append(el('button', {
      class: 'btn btn-fantasma btn-peq', type: 'button', text: t('just.justificar'),
      onclick: () => abrirJustificativa(usuario, aula, { aoEnviar: carregar }),
    }));
  }

  item.append(acoes);
  return item;
}

async function cancelarAula(aula) {
  const confirmou = await confirmar({
    titulo: 'Cancelar aula',
    mensagem: `Cancelar a aula de ${formatarDataExtenso(aula.data)} às ${aula.horario}? O crédito volta para a sua conta.`,
    textoOk: 'Sim, cancelar',
    perigo: true,
  });
  if (!confirmou) return;

  try {
    await cancelar(aula.id, { id: usuario.id, nome: usuario.nome, papel: usuario.papel });
    toast('Aula cancelada. Crédito devolvido.', 'sucesso');
    await carregar();
  } catch (err) {
    toast(err instanceof ErroAgenda ? err.message : 'Não foi possível cancelar.', 'erro', 6000);
    console.error('[historico] erro ao cancelar:', err);
  }
}

function renderizar() {
  const alvo = qs('#lista-historico');
  const filtradas = filtroAtual === 'todas'
    ? todasAulas
    : todasAulas.filter((a) => a.status === filtroAtual);

  alvo.innerHTML = '';

  if (!filtradas.length) {
    const mensagens = {
      todas: 'Você ainda não tem aulas registradas.',
      confirmado: 'Nenhuma aula agendada no momento.',
      realizado: 'Nenhuma aula realizada ainda.',
      cancelado: 'Nenhuma aula cancelada.',
    };
    alvo.append(vazio(mensagens[filtroAtual], 'prancha', { href: 'agendar.html', texto: t('menu.agendar') }));
    return;
  }

  filtradas.forEach((aula) => alvo.append(cartaoAula(aula)));
}

async function carregar() {
  contexto = await carregarContexto();
  const [aulas, justificativas] = await Promise.all([
    historicoDoAluno(usuario.id),
    justificativasDoAluno(usuario.id).catch(() => []),
  ]);
  todasAulas = aulas;
  // A mais recente de cada aula vale (pode ter reenviado após recusa).
  justificativasPorAula = new Map();
  [...justificativas].reverse().forEach((j) => justificativasPorAula.set(j.agendamentoId, j));

  const chip = qs('#chip-creditos-valor');
  if (chip) chip.textContent = String(await saldoCreditos(usuario.id));

  renderizar();
}

async function iniciar() {
  usuario = await exigirAuth(['aluno']);

  montarShellPainel({
    usuario,
    paginaAtual: 'historico',
    chipCreditos: true,
    aoSair: () => sair(),
  });

  qsa('#abas-historico .aba').forEach((btn) => {
    btn.addEventListener('click', () => {
      filtroAtual = btn.dataset.filtro;
      qsa('#abas-historico .aba').forEach((b) => b.classList.toggle('ativa', b === btn));
      renderizar();
    });
  });

  try {
    await carregar();
  } catch (err) {
    console.error('[historico] falha ao carregar:', err);
    toast('Não foi possível carregar o histórico.', 'erro');
  }
}

iniciar();
