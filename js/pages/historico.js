/**
 * historico.js — lista completa das aulas do aluno, com filtro por status.
 */

import { exigirAuth, sair } from '../auth.js';
import { historicoDoAluno, cancelar, ErroAgenda } from '../agenda.js';
import { saldoCreditos } from '../creditos.js';
import { carregarContexto, nomeProfessor, nomeLocal } from '../precos.js';
import {
  qs, qsa, el, dataDeISO, hojeISO, faixaHorario, formatarDataExtenso, MESES_CURTO,
  montarShellPainel, toast, confirmar, vazio,
} from '../ui.js';

let usuario = null;
let contexto = null;
let todasAulas = [];
let filtroAtual = 'todas';

function cartaoAula(aula) {
  const data = dataDeISO(aula.data);
  const professor = nomeProfessor(contexto.mapaProfessores, aula.professorId, aula.professorNome);
  const local = nomeLocal(contexto.mapaLocais, aula.localId);
  const cancelada = aula.status === 'cancelado';
  const futura = aula.data >= hojeISO();

  const item = el('div', { class: `item-aula ${cancelada ? 'cancelada' : ''}` }, [
    el('div', { class: 'data-bloco' }, [
      el('span', { class: 'dia', text: String(data.getDate()).padStart(2, '0') }),
      el('span', { class: 'mes', text: MESES_CURTO[data.getMonth()] }),
    ]),
    el('div', { class: 'info' }, [
      el('div', {
        class: 'titulo',
        text: aula.tipo === 'individual' ? 'Aula Individual' : `Aula em Grupo — ${professor}`,
      }),
      el('div', {
        class: 'meta',
        text: `${faixaHorario(aula.horario, aula.duracaoMin)} · ${professor} · ${local}`,
      }),
      cancelada && aula.motivoCancelamento
        ? el('div', { class: 'texto-min', style: 'color:var(--vermelho)', text: `Motivo: ${aula.motivoCancelamento}` })
        : null,
    ]),
  ]);

  const acoes = el('div', { class: 'flex-col gap-4 itens-centro' });

  const badges = {
    confirmado: ['badge-sucesso', 'Confirmada'],
    realizado: ['badge-info', 'Realizada'],
    cancelado: ['badge-perigo', 'Cancelada'],
  };
  const [classe, texto] = badges[aula.status] || ['badge-neutro', aula.status];
  acoes.append(el('span', { class: `badge ${classe}`, text: texto }));

  if (aula.status === 'confirmado' && futura) {
    acoes.append(el('button', {
      class: 'btn btn-fantasma btn-peq',
      type: 'button',
      text: 'Cancelar',
      onclick: () => cancelarAula(aula),
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
    alvo.append(vazio(mensagens[filtroAtual], '🏄', { href: 'agendar.html', texto: 'Agendar aula' }));
    return;
  }

  filtradas.forEach((aula) => alvo.append(cartaoAula(aula)));
}

async function carregar() {
  contexto = await carregarContexto();
  todasAulas = await historicoDoAluno(usuario.id);

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
