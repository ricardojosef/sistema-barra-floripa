/**
 * reservar.js — fluxo público de reserva, no estilo e-commerce/passagens.
 *
 *   1. Aulas        calendário primeiro: o visitante vê a disponibilidade e
 *                   marca um ou vários dias/horários (sem login, sem professor)
 *   2. Plano        sugerido a partir das aulas marcadas (créditos, dias
 *                   permitidos e prazo de validade)
 *   3. Seus dados   cria a conta aqui (ou entra, se já tiver)
 *   4. Saúde        questionário PAR-Q + termo de responsabilidade
 *   5. Pagamento    checkout.html, que já conhece a reserva
 *
 * As escolhas ficam num rascunho no navegador (reserva.js) até a compra.
 * Depois de pago, a aula é agendada e a conta vira o acesso ao painel.
 */

import { CONFIG } from '../config.js';
import { inicializarStore } from '../store.js';
import {
  carregarUsuario, cadastrar, entrar, entrarComGoogle, atualizarMeuPerfil, sair, ErroAuth, painelDoPapel,
} from '../auth.js';
import {
  carregarContexto, obterPacotesAgrupados, precoUnitario, sufixoPeriodo, economiaDoPacote, textoValidade,
  pacoteComQuantidade, aceitaQuantidade, MAX_QUANTIDADE,
} from '../precos.js';
import { saldoCreditos } from '../creditos.js';
import { declaracaoValida, baixarPdfDeclaracao } from '../saude.js';
import { montarFormularioSaude, resumoDeclaracaoEl } from '../saude-form.js';
import { criarSeletorAula, dataPorExtenso } from '../seletor-aula.js';
import { lerRascunho, salvarRascunho, ordenarAulas } from '../reserva.js';
import { politicaHTML } from '../politica.js';
import { perfilCompleto } from '../documentos.js';
import { camposPessoaisHTML, ligarCamposPessoais, lerCamposPessoais } from '../campos-pessoais.js';
import {
  t, idiomaAtual, definirIdioma, aplicarTraducoes, aoTrocarIdioma,
} from '../i18n.js';
import {
  qs, qsa, el, escapar, formatarBRL, faixaHorario, toast, botaoCarregando,
  montarTopoPublico, montarRodape, mascaraTelefone, paramUrl, iconeEl, icone, montarOndaCabecalho,
  dataDeISO, formatarDataCurta,
} from '../ui.js';
import { nomeLocal } from '../precos.js';

const ETAPAS = ['aula', 'plano', 'dados', 'saude', 'pagamento'];

let usuario = null;
let contexto = null;
let catalogo = null;
let rascunho = lerRascunho();
let etapaAtual = 'aula';
let seletor = null;

/** O plano escolhido, já multiplicado pela quantidade (ex.: 2× aula avulsa). */
function pacoteEscolhido() {
  const base = catalogo?.todos.find((p) => p.id === rascunho.pacoteId);
  return base ? pacoteComQuantidade(base, rascunho.quantidade || 1) : null;
}
const tipoDaAula = () => (rascunho.tipo === 'individual' ? 'individual' : 'grupo');
const aulasEscolhidas = () => rascunho.aulas || [];
const ehAluno = () => usuario?.papel === 'aluno';

/* ==========================================================================
   Navegação entre etapas
   ========================================================================== */

/** A etapa pode ser aberta? Senão, devolve a primeira que falta. */
function etapaPermitida(etapa) {
  const i = ETAPAS.indexOf(etapa);
  if (i >= 1 && !aulasEscolhidas().length && !rascunho.pularAula) return 'aula';
  if (i >= 2) {
    const pacote = pacoteEscolhido();
    const tipoCerto = pacote && (pacote.tipo === 'individual') === (tipoDaAula() === 'individual');
    if (!pacote || !tipoCerto || motivoIncompativel(pacote, aulasEscolhidas())) return 'plano';
  }
  if (i >= 3 && (!ehAluno() || !perfilCompleto(usuario))) return 'dados';
  return etapa;
}

async function irPara(etapa, { rolar = true } = {}) {
  etapaAtual = etapaPermitida(etapa);
  history.replaceState(null, '', `reservar.html#${etapaAtual}`);
  montarPassos();
  montarResumo();
  const alvo = qs('#etapa');
  alvo.innerHTML = '<div class="vazio"><span class="spinner escuro"></span></div>';
  if (rolar) qs('#passos').scrollIntoView({ behavior: 'smooth', block: 'start' });

  const montadores = {
    plano: etapaPlano, aula: etapaAula, dados: etapaDados, saude: etapaSaude, pagamento: etapaPagamento,
  };
  try {
    await montadores[etapaAtual](alvo);
  } catch (err) {
    console.error(`[reservar] falha na etapa ${etapaAtual}:`, err);
    alvo.innerHTML = '';
    alvo.append(el('div', { class: 'alerta alerta-perigo' }, [iconeEl('alerta'), el('span', { text: t('comum.erroCarregar') })]));
  }
}

function montarPassos() {
  const alvo = qs('#passos');
  const atual = ETAPAS.indexOf(etapaAtual);
  alvo.innerHTML = '';
  ETAPAS.forEach((etapa, i) => {
    const estado = i < atual ? 'feito' : i === atual ? 'atual' : '';
    const conteudo = [
      el('span', { class: 'passo-num' }, [i < atual ? iconeEl('check') : String(i + 1)]),
      el('span', { class: 'passo-rotulo', text: t(`reserva.passo.${etapa}`) }),
    ];
    alvo.append(el('li', { class: `passo-fluxo ${estado}`, 'aria-current': i === atual ? 'step' : null }, [
      i < atual
        ? el('button', { type: 'button', onclick: () => irPara(etapa) }, conteudo)
        : el('span', {}, conteudo),
    ]));
  });
}

/** Barra de ações no pé de cada etapa. */
function acoes({ voltar = null, continuar = null, textoContinuar = null, extra = null }) {
  const barra = el('div', { class: 'fluxo-acoes' });
  barra.append(voltar
    ? el('button', { type: 'button', class: 'btn btn-claro', text: `← ${t('comum.voltar')}`, onclick: voltar })
    : el('span'));
  const direita = el('div', { class: 'flex gap-8 quebra itens-centro' });
  if (extra) direita.append(extra);
  if (continuar) {
    direita.append(el('button', {
      type: 'button', class: 'btn btn-primario', id: 'btn-continuar',
      text: `${textoContinuar || t('comum.continuar')} →`, onclick: continuar,
    }));
  }
  barra.append(direita);
  return barra;
}

/* ==========================================================================
   Resumo lateral
   ========================================================================== */

function linhaDaAula(a) {
  return `${faixaHorario(a.horario, contexto.config.duracaoMin)} · ${nomeLocal(contexto.mapaLocais, a.localId)}`;
}

function montarResumo() {
  const alvo = qs('#resumo-pedido');
  const pacote = pacoteEscolhido();
  const aulas = aulasEscolhidas();
  alvo.innerHTML = `<div class="card-titulo"><h3>${escapar(t('reserva.resumo.titulo'))}</h3></div>`;

  if (!pacote && !aulas.length && !rascunho.pularAula) {
    alvo.append(el('p', { class: 'texto-peq texto-cinza', text: t('reserva.resumo.vazio') }));
    return;
  }

  // Aulas primeiro: é o que o aluno escolheu primeiro.
  const caixaAulas = el('div', { class: 'resumo-aula' });
  if (aulas.length) {
    caixaAulas.append(el('div', {
      class: 'texto-min texto-cinza',
      text: aulas.length === 1 ? t('reserva.resumo.suaAula') : t('reserva.resumo.suasAulas', { n: aulas.length }),
    }));
    aulas.forEach((a) => caixaAulas.append(el('div', { class: 'resumo-aula-item' }, [
      el('div', { class: 'negrito', text: dataPorExtenso(a.data) }),
      el('div', { text: linhaDaAula(a) }),
    ])));
    caixaAulas.append(el('div', { class: 'texto-min texto-cinza mt-8', text: t('reserva.resumo.professor') }));
  } else if (rascunho.pularAula) {
    caixaAulas.append(el('div', { class: 'texto-peq texto-cinza', text: t('reserva.resumo.agendarDepois') }));
  }
  alvo.append(caixaAulas);

  if (!pacote) {
    alvo.append(el('p', { class: 'texto-peq texto-cinza mt-16', text: t('reserva.resumo.planoDepois') }));
    return;
  }

  const linhas = [
    [t('reserva.resumo.plano'), pacote.nome],
    [t('reserva.resumo.creditos'), String(pacote.creditos)],
  ];
  const sobram = Number(pacote.creditos) - aulas.length;
  if (aulas.length && sobram > 0) linhas.push([t('reserva.resumo.paraDepois'), String(sobram)]);
  const validade = textoValidade(pacote);
  if (validade) linhas.push([t('reserva.resumo.validade'), validade.replace('válido por ', '')]);
  if (pacote.apenasFimDeSemana) linhas.push([t('reserva.resumo.dias'), t('reserva.resumo.fimDeSemana')]);

  const bloco = el('div', { class: 'mt-16' });
  for (const [rotulo, valor] of linhas) {
    bloco.append(el('div', { class: 'linha-resumo' }, [el('span', { text: rotulo }), el('span', { class: 'negrito', text: valor })]));
  }
  alvo.append(bloco);

  alvo.append(el('div', { class: 'linha-resumo total mt-16' }, [
    el('span', { text: t('reserva.resumo.total') }),
    el('span', { class: 'valor', text: formatarBRL(pacote.preco) + sufixoPeriodo(pacote) }),
  ]));
  alvo.append(el('p', { class: 'texto-min texto-cinza mt-8', text: t('reserva.resumo.cupomDepois') }));
}

function montarPolitica() {
  qs('#politica-resumo').innerHTML = politicaHTML({ horas: contexto.config.horasMinimasCancelamento });
}

/* ==========================================================================
   1. Aulas — o calendário vem primeiro, para mostrar a disponibilidade
   ========================================================================== */

/** Planos do tipo de aula (grupo inclui os mensalistas). */
function planosDoTipo(tipo) {
  return tipo === 'individual' ? catalogo.individual : [...catalogo.grupo, ...catalogo.mensal];
}

/** Quantas aulas dá para marcar de uma vez: o maior pacote do tipo (ou o plano já escolhido pelo link). */
function limiteDeAulas() {
  const pacote = pacoteEscolhido();
  if (pacote && rascunho.pacoteFixo && !aceitaQuantidade(catalogo.todos.find((p) => p.id === pacote.id))) {
    return Number(pacote.creditos) || 1;
  }
  // Aula avulsa/particular pode ser comprada em quantidade.
  return Math.max(1, ...planosDoTipo(tipoDaAula()).map((p) => (aceitaQuantidade(p) ? MAX_QUANTIDADE : Number(p.creditos) || 1)));
}

const chaveDaAula = (a) => `${a.data}|${a.horario}|${a.localId || ''}`;

function alternarAula(slot) {
  const aulas = aulasEscolhidas();
  const chave = chaveDaAula(slot);
  const existente = aulas.find((a) => chaveDaAula(a) === chave);
  let novas;
  if (existente) {
    novas = aulas.filter((a) => a !== existente);
  } else {
    // Mesmo dia e horário em outra praia: troca (não dá para estar nas duas).
    const semConflito = aulas.filter((a) => !(a.data === slot.data && a.horario === slot.horario));
    const limite = limiteDeAulas();
    if (semConflito.length >= limite) {
      toast(limite === 1 ? t('reserva.aula.limiteUma') : t('reserva.aula.limite', { n: limite }), 'aviso', 5000);
      return;
    }
    novas = [...semConflito, { data: slot.data, horario: slot.horario, localId: slot.localId || null }];
  }
  rascunho = salvarRascunho({ aulas: ordenarAulas(novas), pularAula: false });
  montarAulasEscolhidas();
  montarResumo();
}

function montarAulasEscolhidas() {
  const alvo = qs('#aulas-escolhidas');
  if (!alvo) return;
  const aulas = aulasEscolhidas();
  alvo.innerHTML = '';
  const btn = qs('#btn-continuar');
  if (btn) {
    btn.disabled = !aulas.length;
    btn.textContent = aulas.length
      ? `${aulas.length === 1 ? t('reserva.aula.verPlanosUma') : t('reserva.aula.verPlanos', { n: aulas.length })} →`
      : `${t('comum.continuar')} →`;
  }

  if (!aulas.length) {
    alvo.append(el('p', { class: 'texto-peq texto-cinza', text: t('reserva.aula.nenhuma') }));
    return;
  }
  alvo.append(el('div', { class: 'negrito mb-8', text: aulas.length === 1 ? t('reserva.resumo.suaAula') : t('reserva.resumo.suasAulas', { n: aulas.length }) }));
  const lista = el('div', { class: 'chips-aulas' });
  aulas.forEach((a) => lista.append(el('span', { class: 'chip-aula' }, [
    el('span', {}, [el('strong', { text: formatarDataCurta(a.data) }), ` ${a.horario}`]),
    el('button', {
      type: 'button', class: 'chip-remover', 'aria-label': t('reserva.aula.remover'), title: t('reserva.aula.remover'),
      text: '×',
      onclick: () => { alternarAula(a); seletor?.atualizarMarcas(); },
    }),
  ])));
  alvo.append(lista);

  // Sugestão rápida: com quantas aulas o pacote fica mais em conta.
  const melhor = melhorPlano(aulas);
  if (melhor) {
    alvo.append(el('p', { class: 'texto-min texto-cinza mt-8', text: t('reserva.aula.sugestao', { plano: melhor.nome, valor: formatarBRL(precoUnitario(melhor)) }) }));
  }
}

function trocarTipo(tipo) {
  if (tipo === tipoDaAula()) return;
  const pacote = pacoteEscolhido();
  const pacoteServe = pacote && (pacote.tipo === 'individual') === (tipo === 'individual');
  rascunho = salvarRascunho({
    tipo, aulas: [], pularAula: false,
    ...(pacoteServe ? {} : { pacoteId: null, pacoteFixo: false }),
  });
  irPara('aula', { rolar: false });
}

async function etapaAula(alvo) {
  const pacote = pacoteEscolhido();
  const individual = tipoDaAula() === 'individual';
  const soFds = !!(pacote?.apenasFimDeSemana && rascunho.pacoteFixo);
  const temParticular = catalogo.individual.length > 0;

  alvo.innerHTML = `
    <h2 class="mb-8">${escapar(t('reserva.aula.titulo'))}</h2>
    <ol class="como-funciona mb-16">
      <li><span class="cf-num">1</span><span>${t('reserva.aula.como1')}</span></li>
      <li><span class="cf-num">2</span><span>${t('reserva.aula.como2')}</span></li>
      <li><span class="cf-num">3</span><span>${t('reserva.aula.como3')}</span></li>
    </ol>
    ${temParticular ? `
    <div class="abas abas-tipo mb-16" role="group" aria-label="${escapar(t('reserva.aula.tipo'))}">
      <button type="button" class="aba ${individual ? '' : 'ativa'}" data-tipo="grupo">${escapar(t('reserva.aula.tipoGrupo'))}</button>
      <button type="button" class="aba ${individual ? 'ativa' : ''}" data-tipo="individual">${escapar(t('reserva.aula.tipoParticular'))}</button>
    </div>` : ''}
    <p class="texto-cinza mb-16">${escapar(individual ? t('reserva.aula.textoParticular') : t('reserva.aula.textoGrupo', { n: contexto.config.capacidadeGrupo }))}</p>
    ${pacote && rascunho.pacoteFixo ? `<div class="alerta alerta-info mb-16">${icone('planos')}<span class="cresce">${escapar(t('reserva.aula.planoFixo', { plano: pacote.nome, n: pacote.creditos }))}</span>
      <button type="button" class="btn btn-fantasma btn-peq" id="btn-soltar-plano">${escapar(t('reserva.aula.verTodos'))}</button></div>` : ''}
    ${soFds ? `<div class="alerta alerta-info mb-16">${icone('agenda')}<span>${escapar(t('reserva.aula.mensalista'))}</span></div>` : ''}
    <div class="painel-colunas">
      <div>
        <div class="calendario-topo">
          <button class="btn-mes" id="mes-anterior" type="button" aria-label="${escapar(t('cal.mesAnterior'))}">‹</button>
          <span class="mes-atual" id="mes-atual">—</span>
          <button class="btn-mes" id="mes-proximo" type="button" aria-label="${escapar(t('cal.mesProximo'))}">›</button>
        </div>
        <div class="calendario-grade" id="calendario" role="grid"></div>
        <div class="legenda-cal">
          <span><i class="bolinha" style="background:var(--verde)"></i> ${escapar(t('cal.comVagas'))}</span>
          <span><i class="bolinha bolinha-escolhida"></i> ${escapar(t('cal.escolhido'))}</span>
          <span><i class="bolinha" style="background:var(--vermelho)"></i> ${escapar(t('cal.lotadoOuSemAula'))}</span>
          <span><i class="bolinha" style="background:var(--cinza-300)"></i> ${escapar(t('cal.indisponivel'))}</span>
        </div>
      </div>
      <div>
        <p class="negrito mb-8" id="dia-selecionado">${escapar(t('cal.escolhaDia'))}</p>
        <div id="resumo-dia" class="resumo-dia"></div>
        <div id="lista-slots"></div>
        <p class="texto-min texto-cinza mt-16 com-icone">${icone('info')}${escapar(t('reserva.aula.professorInterno'))}</p>
      </div>
    </div>
    <div id="aulas-escolhidas" class="aulas-escolhidas mt-16"></div>`;

  qsa('.abas-tipo .aba', alvo).forEach((b) => b.addEventListener('click', () => trocarTipo(b.dataset.tipo)));
  qs('#btn-soltar-plano', alvo)?.addEventListener('click', () => {
    rascunho = salvarRascunho({ pacoteFixo: false });
    irPara('aula', { rolar: false });
  });

  alvo.append(acoes({
    continuar: () => {
      if (!aulasEscolhidas().length) { toast(t('reserva.aula.escolhaHorario'), 'aviso'); return; }
      irPara('plano');
    },
    extra: el('button', {
      type: 'button', class: 'btn btn-fantasma', text: t('reserva.aula.semDatas'),
      onclick: () => { rascunho = salvarRascunho({ pularAula: true, aulas: [] }); irPara('plano'); },
    }),
  }));
  montarAulasEscolhidas();

  seletor = criarSeletorAula({
    grade: qs('#calendario', alvo),
    rotuloMes: qs('#mes-atual', alvo),
    btnAnterior: qs('#mes-anterior', alvo),
    btnProximo: qs('#mes-proximo', alvo),
    lista: qs('#lista-slots', alvo),
    rotuloDia: qs('#dia-selecionado', alvo),
    resumoDia: qs('#resumo-dia', alvo),
    contexto,
    tipo: tipoDaAula,
    soFimDeSemana: () => soFds,
    multiplo: true,
    aoAlternar: alternarAula,
    diasMarcados: () => aulasEscolhidas().map((a) => a.data),
    slotMarcado: (slot) => aulasEscolhidas().some((a) => chaveDaAula(a) === chaveDaAula(slot)),
  });

  await seletor.iniciar({ dia: aulasEscolhidas()[0]?.data || null });
}

/* ==========================================================================
   2. Plano — sugerido a partir das aulas escolhidas
   ========================================================================== */

/** Por que o plano não serve para as aulas escolhidas (ou null se serve). */
function motivoIncompativel(p, aulas) {
  if (!aulas.length) return null;
  if (Number(p.creditos) < aulas.length) {
    return t('reserva.plano.naoCabe', { n: p.creditos, aulas: aulas.length });
  }
  if (p.apenasFimDeSemana && aulas.some((a) => ![0, 6].includes(dataDeISO(a.data).getDay()))) {
    return t('reserva.plano.soFds');
  }
  if (p.validadeDias) {
    const limite = new Date();
    limite.setDate(limite.getDate() + Number(p.validadeDias));
    const ultima = aulas[aulas.length - 1].data;
    if (dataDeISO(ultima) > limite) return t('reserva.plano.prazo', { dias: p.validadeDias });
  }
  return null;
}

/** O plano mais barato que cobre as aulas (empate: o que dá mais créditos). */
/**
 * Opções de compra para as aulas marcadas: os planos do catálogo e, quando
 * há mais de uma aula, a aula avulsa (ou particular) multiplicada — para
 * quem não quer pacote nem mensalidade.
 */
function opcoesParaAulas(aulas) {
  return planosDoTipo(tipoDaAula()).map((p) => (
    aceitaQuantidade(p) && aulas.length > 1 ? pacoteComQuantidade(p, aulas.length) : p
  ));
}

/**
 * O plano recomendado: o pacote mais barato que cobre as aulas (empate: o que
 * dá mais créditos). As avulsas multiplicadas aparecem como alternativa e só
 * são recomendadas quando nenhum pacote serve.
 */
function melhorPlano(aulas, opcoes = opcoesParaAulas(aulas)) {
  if (!aulas.length) return null;
  const servem = opcoes.filter((p) => !motivoIncompativel(p, aulas));
  servem.sort((a, b) => ((a.quantidade > 1) - (b.quantidade > 1))
    || (Number(a.preco) - Number(b.preco)) || (Number(b.creditos) - Number(a.creditos)));
  return servem[0] || null;
}

function cardPlano(p, { recomendado = false, motivo = null, aulas = [] } = {}) {
  const escolhido = p.id === rascunho.pacoteId;
  const card = el('article', {
    class: ['card-plano', recomendado || (!aulas.length && p.destaque) ? 'destaque' : '', escolhido ? 'escolhido' : '', motivo ? 'incompativel' : ''].filter(Boolean).join(' '),
  });
  if (recomendado) card.append(el('span', { class: 'selo-popular', text: t('reserva.plano.recomendado') }));
  else if (!aulas.length && p.destaque) card.append(el('span', { class: 'selo-popular', text: t('reserva.plano.popular') }));
  card.append(el('div', { class: 'plano-nome', text: p.nome }), el('div', { class: 'plano-desc', text: p.quantidade > 1 ? t('reserva.plano.qtdDesc') : (p.descricao || '') }));
  const preco = el('div', { class: 'plano-preco' });
  preco.innerHTML = `${escapar(formatarBRL(p.preco))}${sufixoPeriodo(p) ? `<span class="periodo">${sufixoPeriodo(p)}</span>` : ''}`;
  card.append(preco);
  card.append(el('div', {
    class: 'plano-unitario',
    text: p.quantidade > 1 ? t('reserva.plano.qtdUnitario', { n: p.quantidade, valor: formatarBRL(p.precoUnitarioBase) })
      : p.creditos > 1 ? t('reserva.plano.porAula', { valor: formatarBRL(precoUnitario(p)) })
      : (p.tipo === 'individual' ? t('reserva.plano.particular') : t('reserva.plano.avulsa')),
  }));
  const economia = economiaDoPacote(p);
  if (economia && !motivo) {
    card.append(el('div', { class: 'selo-economia' }, [
      el('span', { text: t('reserva.plano.economize', { valor: formatarBRL(economia.valor) }) }),
      el('span', { class: 'percentual', text: `${economia.percentual}%` }),
    ]));
  }
  const condicoes = [];
  if (aulas.length && !motivo) {
    const sobram = Number(p.creditos) - aulas.length;
    const um = aulas.length === 1 ? 'Uma' : '';
    condicoes.push(['check', sobram > 0
      ? t(`reserva.plano.cobre${um}Sobram`, { n: aulas.length, sobram })
      : t(`reserva.plano.cobre${um}`, { n: aulas.length })]);
  }
  const validade = textoValidade(p);
  if (validade) condicoes.push(['ampulheta', validade.charAt(0).toUpperCase() + validade.slice(1)]);
  if (p.apenasFimDeSemana) condicoes.push(['agenda', t('reserva.resumo.fimDeSemana')]);
  if (condicoes.length) {
    card.append(el('ul', { class: 'plano-condicoes' },
      condicoes.map(([ic, texto]) => el('li', { class: 'com-icone' }, [iconeEl(ic), texto]))));
  }
  if (motivo) card.append(el('p', { class: 'plano-motivo com-icone' }, [iconeEl('info'), motivo]));
  card.append(el('button', {
    type: 'button',
    class: `btn ${recomendado || (!aulas.length && p.destaque) ? 'btn-primario' : 'btn-secundario'} btn-bloco`,
    text: motivo ? t('reserva.plano.naoServe') : t('reserva.plano.escolher'),
    disabled: !!motivo,
    onclick: () => escolherPlano(p),
  }));
  return card;
}

function escolherPlano(p) {
  rascunho = salvarRascunho({
    pacoteId: p.id, quantidade: p.quantidade || 1, pacoteFixo: false, tipo: p.tipo === 'individual' ? 'individual' : 'grupo',
  });
  irPara('dados');
}

async function etapaPlano(alvo) {
  const aulas = aulasEscolhidas();
  alvo.innerHTML = '';
  alvo.append(el('h2', { class: 'mb-8', text: t('reserva.plano.titulo') }));

  if (aulas.length) {
    alvo.append(el('p', {
      class: 'texto-cinza mb-16',
      text: aulas.length === 1 ? t('reserva.plano.textoUma') : t('reserva.plano.textoAulas', { n: aulas.length }),
    }));
  } else {
    alvo.append(el('p', { class: 'texto-cinza mb-16', text: t('reserva.plano.texto') }));
  }

  if (ehAluno()) {
    const saldo = await saldoCreditos(usuario.id);
    if (saldo > 0) {
      alvo.append(el('div', { class: 'alerta alerta-info mb-16' }, [
        iconeEl('creditos'),
        el('span', { class: 'cresce', text: t('reserva.plano.temCreditos', { n: saldo }) }),
        el('a', { href: 'agendar.html', class: 'negrito', text: `${t('reserva.plano.usarCreditos')} →` }),
      ]));
    }
  }

  // Sem aulas escolhidas ("ainda não sei as datas"): catálogo completo, como antes.
  if (!aulas.length) {
    const blocos = [
      [t('reserva.plano.grupo'), catalogo.grupo, 'grade-4'],
      [t('reserva.plano.outros'), [...catalogo.individual, ...catalogo.mensal], 'grade-3'],
    ];
    for (const [titulo, lista, classe] of blocos) {
      if (!lista.length) continue;
      alvo.append(el('h3', { class: 'mb-16 mt-16', text: titulo }));
      const grade = el('div', { class: `grade ${classe} mb-16` });
      lista.forEach((p) => grade.append(cardPlano(p)));
      alvo.append(grade);
    }
    alvo.append(acoes({ voltar: () => irPara('aula') }));
    return;
  }

  const planos = opcoesParaAulas(aulas);
  const melhor = melhorPlano(aulas, planos);
  const servem = planos.filter((p) => !motivoIncompativel(p, aulas));
  const naoServem = planos.filter((p) => motivoIncompativel(p, aulas));
  // O recomendado vem primeiro; os demais na ordem do catálogo.
  servem.sort((a, b) => (a === melhor ? -1 : b === melhor ? 1 : 0));

  if (servem.length) {
    alvo.append(el('h3', { class: 'mb-16 mt-16', text: t('reserva.plano.servem') }));
    const grade = el('div', { class: `grade ${servem.length >= 4 ? 'grade-4' : 'grade-3'} mb-16` });
    servem.forEach((p) => grade.append(cardPlano(p, { recomendado: p === melhor, aulas })));
    alvo.append(grade);
  } else {
    alvo.append(el('div', { class: 'alerta alerta-aviso mb-16' }, [iconeEl('alerta'), el('span', { text: t('reserva.plano.nenhumServe') })]));
  }

  if (naoServem.length) {
    const detalhes = el('details', { class: 'planos-outros mt-16' }, [
      el('summary', { text: t('reserva.plano.outrosPlanos', { n: naoServem.length }) }),
    ]);
    const grade = el('div', { class: 'grade grade-3 mt-16' });
    naoServem.forEach((p) => grade.append(cardPlano(p, { motivo: motivoIncompativel(p, aulas), aulas })));
    detalhes.append(grade);
    alvo.append(detalhes);
  }

  alvo.append(acoes({ voltar: () => irPara('aula') }));
}


/* ==========================================================================
   3. Seus dados (cadastro ou login)
   ========================================================================== */

/** Guarda o que foi digitado, para não perder ao trocar o idioma (a tela é redesenhada). */
function valoresDigitados(form) {
  const valores = {};
  qsa('input, select, textarea', form).forEach((c) => {
    if (!c.id) return;
    valores[c.id] = c.type === 'checkbox' ? c.checked : c.value;
  });
  return valores;
}

function restaurarValores(form, valores) {
  for (const [id, valor] of Object.entries(valores || {})) {
    const campo = qs(`#${CSS.escape(id)}`, form);
    if (!campo) continue;
    if (campo.type === 'checkbox') campo.checked = valor;
    else campo.value = valor;
    campo.dispatchEvent(new Event('change'));
  }
}

function marcarErroCampo(form, codigo) {
  const mapa = {
    nome: 'f-nome', email: 'f-email', senha: 'f-senha', nacionalidade: 'f-nacionalidade',
    cpf: 'f-cpf', documento: 'f-documento', nascimento: 'f-nascimento',
  };
  qsa('.campo.erro', form).forEach((c) => c.classList.remove('erro'));
  const id = mapa[codigo];
  if (id) qs(`#${id}`, form)?.closest('.campo')?.classList.add('erro');
}

let abaDados = 'novo';
let rascunhoForm = null;

async function etapaDados(alvo) {
  alvo.innerHTML = '';
  alvo.append(el('h2', { class: 'mb-8', text: t('dados.titulo') }));

  // Logado como equipe: o fluxo de compra é só para alunos.
  if (usuario && !ehAluno()) {
    alvo.append(
      el('div', { class: 'alerta alerta-aviso' }, [iconeEl('alerta'), el('span', { text: t('dados.equipe') })]),
      acoes({ voltar: () => irPara('plano'), extra: el('a', { class: 'btn btn-secundario', href: painelDoPapel(usuario.papel), text: t('nav.minhaArea') }) }),
    );
    return;
  }

  // Aluno logado com cadastro completo: só confirma.
  if (ehAluno() && perfilCompleto(usuario)) {
    alvo.append(
      el('div', { class: 'cartao-conectado' }, [
        iconeEl('perfil'),
        el('div', { class: 'cresce' }, [
          el('div', { class: 'texto-min texto-cinza', text: t('dados.conectadoComo') }),
          el('div', { class: 'negrito', text: usuario.nome }),
          el('div', { class: 'texto-peq texto-cinza', text: usuario.email }),
        ]),
        el('button', {
          type: 'button', class: 'btn btn-fantasma btn-peq', text: t('dados.naoSouEu'),
          onclick: async () => { await sair(null); usuario = null; irPara('dados'); },
        }),
      ]),
      acoes({ voltar: () => irPara('plano'), continuar: () => irPara('saude') }),
    );
    return;
  }

  // Aluno logado sem documento/nacionalidade (ex.: entrou com Google): completa.
  if (ehAluno()) {
    alvo.append(el('p', { class: 'texto-cinza mb-16', text: t('dados.completar', { nome: usuario.nome.split(' ')[0] }) }));
    const form = el('form', { novalidate: true });
    form.innerHTML = camposPessoaisHTML({ ...usuario, ...(rascunhoForm || {}) });
    alvo.append(form);
    ligarCamposPessoais(form, (idioma) => { rascunhoForm = lerCamposPessoais(form); definirIdioma(idioma); });
    alvo.append(acoes({
      voltar: () => irPara('plano'),
      continuar: async () => {
        const btn = qs('#btn-continuar');
        const restaurar = botaoCarregando(btn, t('comum.salvando'));
        try {
          usuario = await atualizarMeuPerfil({ pessoais: lerCamposPessoais(form) });
          rascunhoForm = null;
          irPara('saude');
        } catch (err) {
          restaurar();
          marcarErroCampo(form, err.codigo);
          toast(err instanceof ErroAuth ? err.message : t('comum.erroSalvar'), 'erro', 6000);
        }
      },
    }));
    return;
  }

  // Visitante: cria a conta aqui (ou entra, se já tiver).
  alvo.append(el('p', { class: 'texto-cinza mb-16', text: t('dados.texto') }));
  const abas = el('div', { class: 'abas mb-16' }, [
    el('button', { type: 'button', class: `aba ${abaDados === 'novo' ? 'ativa' : ''}`, text: t('dados.abaNovo'), onclick: () => { abaDados = 'novo'; irPara('dados', { rolar: false }); } }),
    el('button', { type: 'button', class: `aba ${abaDados === 'entrar' ? 'ativa' : ''}`, text: t('dados.abaEntrar'), onclick: () => { abaDados = 'entrar'; irPara('dados', { rolar: false }); } }),
  ]);
  alvo.append(abas);

  if (abaDados === 'entrar') {
    montarLogin(alvo);
    return;
  }

  const form = el('form', { novalidate: true, id: 'form-cadastro' });
  form.innerHTML = `
    <div class="campo">
      <label for="f-nome">${escapar(t('dados.nome'))}</label>
      <input type="text" id="f-nome" autocomplete="name">
      <span class="msg-erro">${escapar(t('dados.erroNome'))}</span>
    </div>
    <div class="linha-campos duas">
      <div class="campo">
        <label for="f-email">${escapar(t('dados.email'))}</label>
        <input type="email" id="f-email" autocomplete="email" placeholder="voce@email.com">
        <span class="msg-erro">${escapar(t('dados.erroEmail'))}</span>
      </div>
      <div class="campo">
        <label for="f-telefone">WhatsApp <span class="dica">${escapar(t('dados.whatsDica'))}</span></label>
        <input type="tel" id="f-telefone" autocomplete="tel" placeholder="(48) 99999-9999 / +54 9 11 ...">
      </div>
    </div>
    ${camposPessoaisHTML(rascunhoForm ? { idioma: idiomaAtual() } : {})}
    <div class="linha-campos duas">
      <div class="campo">
        <label for="f-senha">${escapar(t('dados.senha'))}</label>
        <input type="password" id="f-senha" autocomplete="new-password" placeholder="${escapar(t('dados.senhaDica'))}">
        <span class="msg-erro">${escapar(t('dados.erroSenha'))}</span>
      </div>
      <div class="campo">
        <label for="f-senha2">${escapar(t('dados.senha2'))}</label>
        <input type="password" id="f-senha2" autocomplete="new-password">
        <span class="msg-erro">${escapar(t('dados.erroSenha2'))}</span>
      </div>
    </div>
    <p class="texto-min texto-cinza">${escapar(t('dados.contaInfo'))}</p>`;
  alvo.append(form);
  if (rascunhoForm) restaurarValores(form, rascunhoForm);

  ligarCamposPessoais(form, (idioma) => { rascunhoForm = valoresDigitados(form); definirIdioma(idioma); });
  qs('#f-telefone', form).addEventListener('input', (ev) => {
    if (!ev.target.value.startsWith('+')) ev.target.value = mascaraTelefone(ev.target.value);
  });
  qsa('input, select', form).forEach((c) => c.addEventListener('input', () => c.closest('.campo')?.classList.remove('erro')));

  alvo.append(acoes({
    voltar: () => irPara('plano'),
    textoContinuar: t('dados.criarConta'),
    continuar: async () => {
      if (qs('#f-senha', form).value !== qs('#f-senha2', form).value) {
        qs('#f-senha2', form).closest('.campo').classList.add('erro');
        return;
      }
      const btn = qs('#btn-continuar');
      const restaurar = botaoCarregando(btn, t('dados.criando'));
      try {
        usuario = await cadastrar({
          nome: qs('#f-nome', form).value,
          email: qs('#f-email', form).value,
          telefone: qs('#f-telefone', form).value,
          senha: qs('#f-senha', form).value,
          ...lerCamposPessoais(form),
        });
        rascunhoForm = null;
        montarTopoPublico(usuario);
        toast(t('dados.contaCriada'), 'sucesso');
        irPara('saude');
      } catch (err) {
        restaurar();
        marcarErroCampo(form, err.codigo);
        toast(err instanceof ErroAuth ? err.message : t('comum.erroSalvar'), 'erro', 6000);
        if (!(err instanceof ErroAuth)) console.error('[reservar] erro no cadastro:', err);
      }
    },
  }));
}

function montarLogin(alvo) {
  const form = el('form', { novalidate: true });
  form.innerHTML = `
    <div class="campo">
      <label for="l-email">${escapar(t('dados.email'))}</label>
      <input type="email" id="l-email" autocomplete="email">
    </div>
    <div class="campo">
      <label for="l-senha">${escapar(t('dados.senha'))}</label>
      <input type="password" id="l-senha" autocomplete="current-password">
    </div>
    <button type="submit" class="btn btn-primario btn-bloco">${escapar(t('nav.entrar'))}</button>`;
  alvo.append(form);

  const depoisDeEntrar = (u) => {
    usuario = u;
    montarTopoPublico(usuario);
    irPara(ehAluno() && perfilCompleto(usuario) ? 'saude' : 'dados');
  };

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const btn = qs('button[type=submit]', form);
    const restaurar = botaoCarregando(btn, t('dados.entrando'));
    try {
      depoisDeEntrar(await entrar(qs('#l-email', form).value, qs('#l-senha', form).value));
    } catch (err) {
      restaurar();
      toast(err instanceof ErroAuth ? err.message : t('dados.erroEntrar'), 'erro', 6000);
    }
  });

  if (CONFIG.MODO_DADOS === 'firebase') {
    alvo.append(
      el('div', { class: 'separador-ou', text: t('dados.ou') }),
      el('button', {
        type: 'button', class: 'btn-google', text: t('dados.google'),
        onclick: async () => {
          try {
            depoisDeEntrar(await entrarComGoogle());
          } catch (err) {
            toast(err instanceof ErroAuth ? err.message : t('dados.erroEntrar'), 'erro', 6000);
          }
        },
      }),
    );
  }
  alvo.append(acoes({ voltar: () => irPara('plano') }));
}

/* ==========================================================================
   4. Saúde
   ========================================================================== */

async function etapaSaude(alvo) {
  alvo.innerHTML = '';
  alvo.append(
    el('h2', { class: 'mb-8', text: t('saude.titulo') }),
    el('p', { class: 'texto-cinza mb-16', text: t('saude.textoFluxo') }),
  );

  const vigente = await declaracaoValida(usuario.id);
  if (vigente) {
    alvo.append(
      resumoDeclaracaoEl(vigente, { aoBaixar: () => baixarPdfDeclaracao(vigente).catch((e) => toast(e.message, 'erro')) }),
      acoes({ voltar: () => irPara('dados'), continuar: () => irPara('pagamento'), textoContinuar: t('reserva.irPagamento') }),
    );
    return;
  }

  const caixa = el('div');
  alvo.append(caixa);
  montarFormularioSaude(caixa, {
    usuario,
    textoBotao: t('saude.assinarContinuar'),
    aoAssinar: () => {
      toast(t('saude.assinadaOk'), 'sucesso');
      irPara('pagamento');
    },
  });
  alvo.append(acoes({ voltar: () => irPara('dados') }));
}

/* ==========================================================================
   5. Pagamento (checkout)
   ========================================================================== */

async function etapaPagamento(alvo) {
  alvo.innerHTML = `<div class="vazio"><span class="spinner escuro"></span><p class="mt-16">${escapar(t('reserva.indoPagamento'))}</p></div>`;
  const pacote = pacoteEscolhido();
  location.href = `checkout.html?pacote=${encodeURIComponent(pacote.id)}&reserva=1`;
}

/* ==========================================================================
   Inicialização
   ========================================================================== */

async function iniciar() {
  aplicarTraducoes();
  montarTopoPublico(null);
  montarRodape();
  montarOndaCabecalho();

  try {
    await inicializarStore();
    usuario = await carregarUsuario();
    if (usuario) montarTopoPublico(usuario);
    [contexto, catalogo] = await Promise.all([carregarContexto(), obterPacotesAgrupados()]);
  } catch (err) {
    console.error('[reservar] falha ao iniciar:', err);
    qs('#etapa').innerHTML = '';
    qs('#etapa').append(el('div', { class: 'alerta alerta-perigo' }, [iconeEl('alerta'), el('span', { text: t('comum.erroCarregar') })]));
    return;
  }

  // Link direto para um plano (ex.: botão de um card na página inicial).
  const pacoteUrl = paramUrl('pacote');
  // O calendário continua vindo primeiro, mas limitado ao que o plano permite.
  const doLink = catalogo.todos.find((p) => p.id === pacoteUrl);
  if (doLink && pacoteUrl !== rascunho.pacoteId) {
    rascunho = salvarRascunho({
      pacoteId: doLink.id,
      quantidade: 1,
      pacoteFixo: true,
      tipo: doLink.tipo === 'individual' ? 'individual' : 'grupo',
      aulas: [],
      pularAula: false,
    });
  }

  montarPolitica();

  aoTrocarIdioma(() => {
    montarPolitica();
    irPara(etapaAtual, { rolar: false });
  });

  const hash = location.hash.replace('#', '');
  const inicial = ETAPAS.includes(hash) ? hash : 'aula';
  await irPara(inicial, { rolar: false });
}

iniciar();
