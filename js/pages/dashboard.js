/**
 * dashboard.js — painel do aluno.
 *
 * Mostra saldo de créditos, próximas aulas, créditos por origem e os
 * pacotes à venda. Além disso:
 *  - conclui reservas pagas ainda não agendadas (fluxo de reserva);
 *  - destaca aulas canceladas por aviso da escola, pedindo para reagendar;
 *  - leva ao grupo de WhatsApp dos alunos depois da primeira aula marcada;
 *  - lembra de completar o cadastro e de renovar o questionário de saúde;
 *  - depois do prazo de cancelamento, troca "Cancelar" por "Justificar".
 */

import { exigirAuth, sair } from '../auth.js';
import { resumoAluno, creditosPorOrigem } from '../creditos.js';
import {
  proximasAulasDoAluno, historicoDoAluno, cancelar, alunoPodeCancelar, ErroAgenda,
} from '../agenda.js';
import { carregarContexto, obterPacotes, nomeLocal } from '../precos.js';
import { atualizar } from '../store.js';
import { mostrarAvisosPendentes } from '../avisos.js';
import { concluirReservasPendentes, reservasQueFalharam } from '../reserva.js';
import { ultimaDeclaracao, declaracaoVigente, diasParaVencer } from '../saude.js';
import { justificativasDoAluno } from '../justificativas.js';
import { abrirJustificativa } from '../justificativa-ui.js';
import { perfilCompleto } from '../documentos.js';
import { executarTour, passosPainel, tutorialPendente, marcarTutorialConcluido } from '../tutorial.js';
import { t } from '../i18n.js';
import {
  qs, el, formatarBRL, formatarDataExtenso, formatarData, faixaHorario, MESES_CURTO, hojeISO,
  dataDeISO, primeiroNome, montarShellPainel, toast, confirmar, paramUrl, vazio, icone, iconeEl,
} from '../ui.js';

let usuario = null;
let contexto = null;
let justificadas = new Set();   // aulas que já têm justificativa enviada

/* --------------------------------------------------------------------------
   Blocos da tela
   -------------------------------------------------------------------------- */

function itemAula(aula) {
  const data = dataDeISO(aula.data);
  const local = nomeLocal(contexto.mapaLocais, aula.localId);
  const titulo = aula.tipo === 'individual' ? t('aula.particular') : t('aula.grupo');

  const item = el('div', { class: 'item-aula' }, [
    el('div', { class: 'data-bloco' }, [
      el('span', { class: 'dia', text: String(data.getDate()).padStart(2, '0') }),
      el('span', { class: 'mes', text: MESES_CURTO[data.getMonth()] }),
    ]),
    el('div', { class: 'info' }, [
      el('div', { class: 'titulo', text: titulo }),
      el('div', { class: 'meta', text: `${faixaHorario(aula.horario, aula.duracaoMin)} · ${local}` }),
    ]),
  ]);

  const acoes = el('div', { class: 'flex-col gap-4 itens-centro' });
  acoes.append(el('span', { class: 'badge badge-sucesso', text: t('aula.confirmada') }));

  if (alunoPodeCancelar(aula, contexto.config)) {
    acoes.append(el('button', {
      class: 'btn btn-fantasma btn-peq',
      text: t('comum.cancelar'),
      onclick: () => cancelarAula(aula),
    }));
  } else if (justificadas.has(aula.id)) {
    acoes.append(el('span', { class: 'texto-min texto-cinza', text: t('just.emAnalise') }));
  } else {
    // Dentro das 12h o site não cancela mais: só a escola, com justificativa.
    acoes.append(el('button', {
      class: 'btn btn-fantasma btn-peq',
      title: t('dash.prazoEncerrado', { horas: contexto.config.horasMinimasCancelamento }),
      text: t('just.justificar'),
      onclick: () => abrirJustificativa(usuario, aula, { aoEnviar: carregarTudo }),
    }));
  }
  item.append(acoes);

  return item;
}

async function cancelarAula(aula) {
  const quando = `${formatarDataExtenso(aula.data)} às ${aula.horario}`;
  const confirmou = await confirmar({
    titulo: 'Cancelar aula',
    mensagem: `Cancelar a aula de ${quando}? O crédito volta para a sua conta e você poderá agendar outro horário.`,
    textoOk: 'Sim, cancelar',
    textoCancelar: 'Voltar',
    perigo: true,
  });
  if (!confirmou) return;

  try {
    await cancelar(aula.id, { id: usuario.id, nome: usuario.nome, papel: usuario.papel });
    toast('Aula cancelada. Seu crédito foi devolvido.', 'sucesso');
    await carregarTudo();
  } catch (err) {
    const mensagem = err instanceof ErroAgenda ? err.message : 'Não foi possível cancelar a aula.';
    toast(mensagem, 'erro', 6000);
    console.error('[dashboard] erro ao cancelar:', err);
  }
}

async function montarProximas() {
  const alvo = qs('#lista-proximas');
  const aulas = await proximasAulasDoAluno(usuario.id);

  alvo.innerHTML = '';
  if (!aulas.length) {
    alvo.append(vazio(
      t('dash.semAulas'),
      'prancha',
      { href: 'agendar.html', texto: t('dash.agendarAgora') },
    ));
    return aulas;
  }

  aulas.forEach((aula) => alvo.append(itemAula(aula)));
  return aulas;
}

async function montarCreditos(saldo) {
  const alvo = qs('#lista-creditos');
  alvo.innerHTML = '';

  if (saldo <= 0) {
    alvo.append(vazio(
      t('dash.semCreditos'),
      'creditos',
      { href: 'reservar.html', texto: t('dash.comprarPacote') },
    ));
    return;
  }

  const origens = await creditosPorOrigem(usuario.id);
  for (const origem of origens) {
    alvo.append(el('div', { class: 'cartao-credito' }, [
      el('div', { class: 'qtd', text: String(origem.quantidade) }),
      el('div', {
        class: 'rotulo',
        text: origem.quantidade === 1
          ? `Crédito ${origem.tipo === 'individual' ? 'Individual' : 'Grupo'}`
          : `Créditos ${origem.tipo === 'individual' ? 'Individuais' : 'Grupo'}`,
      }),
      el('div', { class: 'origem', text: origem.nomePacote }),
      el('a', { class: 'btn btn-primario btn-peq', href: 'agendar.html', text: t('dash.usarAgora') }),
    ]));
  }
}

async function montarMiniPacotes() {
  const alvo = qs('#mini-pacotes');
  const pacotes = await obterPacotes();

  const selecionados = pacotes
    .filter((p) => ['pac-4', 'pac-9', 'pac-mensal-2x'].includes(p.id) || p.destaque)
    .slice(0, 4);

  alvo.innerHTML = '';
  for (const pacote of selecionados) {
    alvo.append(el('a', {
      class: 'mini-pacote',
      href: `checkout.html?pacote=${encodeURIComponent(pacote.id)}`,
    }, [
      el('span', { text: pacote.nome }),
      el('span', {
        class: 'preco',
        text: formatarBRL(pacote.preco) + (pacote.tipo === 'mensal' ? '/mês' : ''),
      }),
    ]));
  }
}

function montarEstatisticas(resumo, proximaAula) {
  qs('#stat-creditos').textContent = String(resumo.saldo);
  qs('#stat-mes').textContent = String(resumo.aulasNoMes);

  const chip = qs('#chip-creditos-valor');
  if (chip) chip.textContent = String(resumo.saldo);

  if (proximaAula) {
    const data = dataDeISO(proximaAula.data);
    qs('#stat-proxima').textContent = `${String(data.getDate()).padStart(2, '0')}/${String(data.getMonth() + 1).padStart(2, '0')}`;
    qs('#stat-proxima-detalhe').textContent = `${proximaAula.horario}h · ${nomeLocal(contexto.mapaLocais, proximaAula.localId)}`;
  } else {
    qs('#stat-proxima').textContent = '—';
    qs('#stat-proxima-detalhe').textContent = t('dash.nenhumaAula');
  }
}

/* --------------------------------------------------------------------------
   Alertas do topo
   -------------------------------------------------------------------------- */

function alerta(tipo, nomeIcone, conteudo, acao = null) {
  const node = el('div', { class: `alerta alerta-${tipo}` }, [
    iconeEl(nomeIcone),
    el('span', { class: 'cresce' }, conteudo),
  ]);
  if (acao) node.append(acao);
  return node;
}

async function montarAlertas(resumo, historico) {
  const area = qs('#alerta-creditos');
  area.innerHTML = '';
  const hoje = hojeISO();

  // 1. Cadastro incompleto (entrou com Google ou se cadastrou antes do CPF).
  if (!perfilCompleto(usuario)) {
    area.append(alerta('aviso', 'documento', [t('dash.completarPerfil')],
      el('a', { href: 'perfil.html?completar=1&voltar=dashboard.html', class: 'negrito', text: `${t('dash.completar')} →` })));
  }

  // 2. Aulas canceladas pela escola por aviso (tempestade): pedir para reagendar.
  const porAviso = historico.filter((a) => a.status === 'cancelado' && a.canceladoPorAviso && a.data >= hoje && !a.reagendarVisto);
  if (porAviso.length) {
    const quais = porAviso.map((a) => `${formatarData(a.data)} ${a.horario}`).join(', ');
    area.append(alerta('perigo', 'alerta', [
      el('strong', { text: t('dash.canceladaAviso') }), el('br'),
      t('dash.canceladaAvisoTexto', { quais }),
    ], el('div', { class: 'flex gap-8 quebra' }, [
      el('a', { href: 'agendar.html', class: 'btn btn-primario btn-peq', text: t('dash.reagendar') }),
      el('button', {
        type: 'button', class: 'btn btn-claro btn-peq', text: t('comum.entendi'),
        onclick: async (ev) => {
          ev.currentTarget.closest('.alerta')?.remove();
          // O aluno não altera agendamentos além do cancelamento: guarda no navegador.
          porAviso.forEach((a) => { try { localStorage.setItem(`bf_visto_${a.id}`, '1'); } catch { /* ok */ } });
        },
      }),
    ])));
  }

  // 3. Reserva paga cuja vaga acabou antes de agendar.
  const falhas = await reservasQueFalharam(usuario.id);
  for (const compra of falhas) {
    area.append(alerta('aviso', 'agenda', [
      t('dash.reservaFalhou', { quando: compra.falhas.map((a) => `${formatarData(a.data)} ${a.horario}`).join(', ') }),
    ], el('div', { class: 'flex gap-8 quebra' }, [
      el('a', { href: 'agendar.html', class: 'btn btn-primario btn-peq', text: t('dash.escolherOutro') }),
      el('button', {
        type: 'button', class: 'btn btn-claro btn-peq', text: t('comum.entendi'),
        onclick: async (ev) => {
          ev.currentTarget.closest('.alerta')?.remove();
          try { await atualizar('compras', compra.id, { reservaStatus: 'dispensada' }); } catch { /* ok */ }
        },
      }),
    ])));
  }

  // 4. Questionário de saúde vencido ou perto de vencer.
  const decl = await ultimaDeclaracao(usuario.id);
  const dias = diasParaVencer(decl);
  if (!declaracaoVigente(decl)) {
    area.append(alerta('aviso', 'saude', [decl ? t('dash.saudeVencida') : t('dash.saudePendente')],
      el('a', { href: 'saude.html', class: 'negrito', text: `${t('dash.responder')} →` })));
  } else if (dias !== null && dias <= 15) {
    area.append(alerta('info', 'saude', [t('dash.saudeVencendo', { dias })],
      el('a', { href: 'saude.html', class: 'negrito', text: `${t('dash.renovar')} →` })));
  }

  // 5. Sem créditos nem aulas.
  if (resumo.saldo === 0 && resumo.totalAgendadas === 0) {
    area.append(alerta('aviso', 'creditos', [t('dash.semCreditosAlerta')],
      el('a', { href: 'reservar.html', class: 'negrito', text: `${t('dash.verPlanos')} →` })));
  }
}

/** Botão do grupo de WhatsApp: aparece depois que o aluno tem aula marcada. */
function montarGrupoWhatsapp(historico) {
  const alvo = qs('#grupo-whatsapp');
  alvo.innerHTML = '';
  const link = contexto.config.grupoWhatsapp;
  const temAula = historico.some((a) => a.status === 'confirmado' || a.status === 'realizado');
  if (!link || !temAula) return;
  alvo.append(el('a', {
    class: 'cartao-whatsapp', href: link, target: '_blank', rel: 'noopener',
  }, [
    el('span', { class: 'icone-acao' }, [iconeEl('whatsapp')]),
    el('span', { class: 'cresce' }, [
      el('strong', { text: t('dash.grupoTitulo') }), el('br'),
      el('span', { class: 'texto-peq', text: t('dash.grupoTexto') }),
    ]),
    el('span', { class: 'btn btn-claro btn-peq', text: t('dash.grupoEntrar') }),
  ]));
}

/* --------------------------------------------------------------------------
   Carga
   -------------------------------------------------------------------------- */

async function carregarTudo() {
  contexto = await carregarContexto();
  const [resumo, historico, justificativas] = await Promise.all([
    resumoAluno(usuario.id),
    historicoDoAluno(usuario.id),
    justificativasDoAluno(usuario.id).catch(() => []),
  ]);
  justificadas = new Set(justificativas.filter((j) => j.status === 'pendente').map((j) => j.agendamentoId));
  // "Entendi" no aviso de reagendamento fica guardado neste navegador.
  historico.forEach((a) => {
    try { if (localStorage.getItem(`bf_visto_${a.id}`)) a.reagendarVisto = true; } catch { /* ok */ }
  });

  const aulas = await montarProximas();
  montarEstatisticas(resumo, aulas[0] || null);
  montarGrupoWhatsapp(historico);
  await Promise.all([montarCreditos(resumo.saldo), montarMiniPacotes(), montarAlertas(resumo, historico)]);
}

async function iniciar() {
  usuario = await exigirAuth(['aluno']);

  montarShellPainel({
    usuario,
    paginaAtual: 'inicio',
    chipCreditos: true,
    aoSair: () => sair(),
  });

  qs('#saudacao-nome').textContent = primeiroNome(usuario.nome);
  const hoje = new Date();
  const dataFormatada = formatarDataExtenso(
    `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`,
    true,
  );
  qs('#saudacao-data').textContent = `${dataFormatada.charAt(0).toUpperCase()}${dataFormatada.slice(1)} · Florianópolis`;

  // Reserva paga que ainda não virou aula (o aluno fechou a aba no pagamento).
  try {
    const resultados = await concluirReservasPendentes(usuario);
    if (resultados.some((r) => r.agendadas?.length)) toast(t('dash.reservaAgendada'), 'sucesso', 5000);
  } catch (err) {
    console.warn('[dashboard] não foi possível concluir reservas pendentes:', err);
  }

  try {
    await carregarTudo();
  } catch (err) {
    console.error('[dashboard] falha ao carregar:', err);
    toast('Não foi possível carregar seus dados. Recarregue a página.', 'erro');
  }

  if (paramUrl('compra') === 'ok') {
    toast('Pagamento confirmado! Seus créditos já estão disponíveis.', 'sucesso', 5000);
    history.replaceState(null, '', 'dashboard.html');
  }
  if (paramUrl('agendado') === 'ok') {
    toast(t('dash.agendadoOk'), 'sucesso', 5000);
    history.replaceState(null, '', 'dashboard.html');
  }

  const pedidoNoMenu = paramUrl('tutorial') === '1';
  if (pedidoNoMenu || tutorialPendente(usuario)) {
    if (pedidoNoMenu) history.replaceState(null, '', 'dashboard.html');

    const resultado = await executarTour(passosPainel(usuario), { rotuloEtapa: 'Seu painel' });
    await marcarTutorialConcluido(usuario);

    if (resultado === 'agendar') {
      location.href = 'agendar.html?tutorial=1';
      return;
    }
  }

  try {
    await mostrarAvisosPendentes(usuario.id);
  } catch (err) {
    console.error('[dashboard] falha ao mostrar avisos:', err);
  }
}

iniciar();
