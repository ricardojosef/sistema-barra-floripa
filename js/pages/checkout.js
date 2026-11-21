/**
 * checkout.js — escolha de plano e pagamento.
 *
 * Etapas na mesma página: catálogo → pagamento → (aguardando) → confirmação.
 *   checkout.html                     catálogo
 *   checkout.html?pacote=ID           pagamento do plano
 *   checkout.html?pacote=ID&reserva=1 pagamento no fluxo de reserva (a aula
 *                                     escolhida em reservar.html vai junto)
 *   checkout.html?compra=ID           volta do Mercado Pago: espera o webhook
 *
 * Antes de pagar: cadastro completo, questionário de saúde vigente e aceite
 * dos termos/política de cancelamento. O cupom é opcional.
 */

import { CONFIG } from '../config.js';
import { exigirAuth, sair } from '../auth.js';
import { observar, obter } from '../store.js';
import {
  obterPacote, obterPacotesAgrupados, precoUnitario, sufixoPeriodo,
  economiaDoPacote, textoValidade, carregarContexto, nomeLocal,
} from '../precos.js';
import { saldoCreditos } from '../creditos.js';
import {
  METODOS, criarCompra, confirmarPagamento, processarPagamento, payloadPixDaCompra,
  desenharQrCode, validarLuhn, bandeiraCartao, mascaraCartao, mascaraValidade,
  validarValidade, opcoesParcelamento, nomeMetodo, ErroPagamento, montarBotoesPaypal,
} from '../pagamentos.js';
import { validarCupom, ErroCupom, descreverCupom } from '../cupons.js';
import { declaracaoValida } from '../saude.js';
import { montarFormularioSaude } from '../saude-form.js';
import { lerRascunho, reservasDoRascunho, limparRascunho, concluirReserva, aulasDaCompra } from '../reserva.js';
import { perfilCompleto } from '../documentos.js';
import { politicaHTML } from '../politica.js';
import { dataPorExtenso } from '../seletor-aula.js';
import { t } from '../i18n.js';
import {
  qs, qsa, el, formatarBRL, escapar, paramUrl, toast, copiar, faixaHorario,
  montarShellPainel, botaoCarregando, esperar, icone, iconeEl,
} from '../ui.js';

let usuario = null;
let contexto = null;
let pacote = null;
let compra = null;
let metodoAtual = METODOS[0]?.id || 'pix';
let cupomAplicado = null;      // { cupom, desconto, valorFinal }
let reservas = [];             // aulas escolhidas no fluxo de reserva

const valorAPagar = () => (cupomAplicado ? cupomAplicado.valorFinal : Number(pacote.preco));

/* --------------------------------------------------------------------------
   Etapa 1 — catálogo
   -------------------------------------------------------------------------- */

function cardPlano(p) {
  const unitario = precoUnitario(p);
  const card = el('article', { class: `card-plano ${p.destaque ? 'destaque' : ''}` });

  if (p.destaque) card.append(el('span', { class: 'selo-popular', text: 'Mais Popular' }));

  card.append(
    el('div', { class: 'plano-nome', text: p.nome }),
    el('div', { class: 'plano-desc', text: p.descricao || '' }),
  );

  const preco = el('div', { class: 'plano-preco' });
  preco.innerHTML = `${escapar(formatarBRL(p.preco))}${sufixoPeriodo(p) ? `<span class="periodo">${sufixoPeriodo(p)}</span>` : ''}`;
  card.append(preco);

  card.append(el('div', {
    class: 'plano-unitario',
    text: p.creditos > 1
      ? `${formatarBRL(unitario)} por aula`
      : (p.tipo === 'individual' ? 'Aula particular' : 'Aula avulsa'),
  }));

  const economia = economiaDoPacote(p);
  if (economia) {
    card.append(el('div', { class: 'selo-economia' }, [
      el('span', { text: `Economize ${formatarBRL(economia.valor)}` }),
      el('span', { class: 'percentual', text: `${economia.percentual}%` }),
    ]));
  }

  const avisos = [];
  const validade = textoValidade(p);
  if (validade) avisos.push({ icone: 'ampulheta', texto: `${validade.charAt(0).toUpperCase()}${validade.slice(1)}` });
  if (p.apenasFimDeSemana) avisos.push({ icone: 'agenda', texto: 'Somente sábado e domingo' });

  if (avisos.length) {
    const lista = el('ul', { class: 'plano-condicoes' });
    avisos.forEach((a) => lista.append(el('li', { class: 'com-icone' }, [iconeEl(a.icone), a.texto])));
    card.append(lista);
  }

  card.append(el('a', {
    class: `btn ${p.destaque ? 'btn-primario' : 'btn-secundario'} btn-bloco`,
    href: `checkout.html?pacote=${encodeURIComponent(p.id)}`,
    text: 'Comprar',
  }));

  return card;
}

async function montarCatalogo() {
  const { grupo, individual, mensal } = await obterPacotesAgrupados();

  const grupoEl = qs('#planos-grupo');
  grupoEl.innerHTML = '';
  grupo.forEach((p) => grupoEl.append(cardPlano(p)));

  const outrosEl = qs('#planos-outros');
  outrosEl.innerHTML = '';
  [...individual, ...mensal].forEach((p) => outrosEl.append(cardPlano(p)));
}

/* --------------------------------------------------------------------------
   Etapa 2 — resumo, cupom e métodos
   -------------------------------------------------------------------------- */

function montarPassosReserva() {
  const alvo = qs('#passos');
  alvo.classList.remove('oculto');
  const etapas = ['aula', 'plano', 'dados', 'saude', 'pagamento'];
  alvo.innerHTML = etapas.map((e, i) => `
    <li class="passo-fluxo ${i < 4 ? 'feito' : 'atual'}">
      ${i < 4 ? `<a href="reservar.html#${e}">` : '<span>'}
        <span class="passo-num">${i < 4 ? icone('check') : '5'}</span>
        <span class="passo-rotulo">${escapar(t(`reserva.passo.${e}`))}</span>
      ${i < 4 ? '</a>' : '</span>'}
    </li>`).join('');
  qs('#link-voltar').href = 'reservar.html#saude';
  qs('#link-voltar').textContent = `← ${t('comum.voltar')}`;
}

function montarResumo() {
  const alvo = qs('#resumo-conteudo');
  const periodo = pacote.tipo === 'mensal' ? ' por mês' : '';

  alvo.innerHTML = `
    <div class="linha-resumo">
      <span>${escapar(pacote.nome)}</span>
      <span class="negrito">${escapar(formatarBRL(pacote.preco))}</span>
    </div>
    <div class="linha-resumo">
      <span>${escapar(t('reserva.resumo.creditos'))}</span>
      <span class="negrito">${pacote.creditos}${escapar(periodo)}</span>
    </div>
    ${pacote.creditos > 1 ? `
    <div class="linha-resumo">
      <span>Valor por aula</span>
      <span>${escapar(formatarBRL(precoUnitario(pacote)))}</span>
    </div>` : ''}
    ${textoValidade(pacote) ? `
    <div class="linha-resumo">
      <span>${escapar(t('reserva.resumo.validade'))}</span>
      <span>${escapar(textoValidade(pacote).replace('válido por ', ''))}</span>
    </div>` : ''}
    ${pacote.apenasFimDeSemana ? `
    <div class="linha-resumo">
      <span>${escapar(t('reserva.resumo.dias'))}</span>
      <span>${escapar(t('reserva.resumo.fimDeSemana'))}</span>
    </div>` : ''}
    ${reservas.length ? `
    <div class="resumo-aula mt-8">
      <div class="texto-min texto-cinza">${escapar(reservas.length === 1 ? t('reserva.resumo.suaAula') : t('reserva.resumo.suasAulas', { n: reservas.length }))}</div>
      ${reservas.map((r) => `
      <div class="resumo-aula-item">
        <div class="negrito">${escapar(dataPorExtenso(r.data))}</div>
        <div>${escapar(faixaHorario(r.horario, contexto.config.duracaoMin))} · ${escapar(nomeLocal(contexto.mapaLocais, r.localId))}</div>
      </div>`).join('')}
      ${pacote.creditos > reservas.length ? `<div class="texto-min texto-cinza mt-8">${escapar(t('reserva.resumo.sobram', { n: pacote.creditos - reservas.length }))}</div>` : ''}
      <a href="reservar.html#aula" class="texto-min">${escapar(t('checkout.trocarAula'))}</a>
    </div>` : ''}
    ${cupomAplicado ? `
    <div class="linha-resumo texto-sucesso">
      <span>${escapar(t('checkout.desconto'))} (${escapar(cupomAplicado.cupom.codigo)})</span>
      <span class="negrito">− ${escapar(formatarBRL(cupomAplicado.desconto))}</span>
    </div>` : ''}
    <div class="linha-resumo total">
      <span>${escapar(t('reserva.resumo.total'))}</span>
      <span class="valor">${escapar(formatarBRL(valorAPagar()))}</span>
    </div>
    ${economiaDoPacote(pacote) ? `
    <div class="linha-economia">
      ${icone('moeda')} Você economiza ${escapar(formatarBRL(economiaDoPacote(pacote).valor))}
      em relação a ${pacote.creditos} aulas avulsas
    </div>` : ''}`;

  const aviso = qs('#aviso-modo');
  if (CONFIG.MODO_PAGAMENTO === 'mock') {
    aviso.innerHTML = `
      ${icone('teste')}
      <span><strong>Modo demonstração.</strong> Nenhuma cobrança real é feita.
      O pagamento é simulado e os créditos entram na hora, para você testar o
      sistema inteiro.</span>`;
  } else {
    aviso.classList.add('oculto');
  }
}

async function aplicarCupom(ev) {
  ev.preventDefault();
  const status = qs('#cupom-status');
  const codigo = qs('#cupom-codigo').value;
  const btn = qs('#btn-cupom');

  if (cupomAplicado) {
    // Segundo clique remove o cupom.
    cupomAplicado = null;
    compra = null;
    qs('#cupom-codigo').disabled = false;
    qs('#cupom-codigo').value = '';
    btn.textContent = t('checkout.aplicar');
    status.textContent = '';
    montarResumo();
    if (metodoAtual === 'pix') await prepararPix();
    if (metodoAtual === 'cartao') montarParcelas();
    return;
  }

  const restaurar = botaoCarregando(btn, '…');
  try {
    cupomAplicado = await validarCupom(codigo, pacote);
    restaurar();
    // A compra pendente foi criada com o valor antigo: a próxima nasce com o cupom.
    compra = null;
    qs('#cupom-codigo').value = cupomAplicado.cupom.codigo;
    qs('#cupom-codigo').disabled = true;
    btn.textContent = t('checkout.remover');
    status.className = 'texto-min mt-8 texto-sucesso';
    status.textContent = `✓ ${descreverCupom(cupomAplicado.cupom)}${cupomAplicado.cupom.descricao ? ` — ${cupomAplicado.cupom.descricao}` : ''}`;
    montarResumo();
    if (metodoAtual === 'pix') await prepararPix();
    if (metodoAtual === 'cartao') montarParcelas();
  } catch (err) {
    restaurar();
    status.className = 'texto-min mt-8 texto-perigo';
    status.textContent = err instanceof ErroCupom ? err.message : t('checkout.cupomErro');
    if (!(err instanceof ErroCupom)) console.error('[checkout] erro no cupom:', err);
  }
}

function montarMetodos() {
  const alvo = qs('#metodos');
  alvo.innerHTML = '';

  for (const metodo of METODOS) {
    alvo.append(el('button', {
      type: 'button',
      class: `metodo-btn ${metodo.id === metodoAtual ? 'ativo' : ''}`,
      dataset: { metodo: metodo.id },
      onclick: () => selecionarMetodo(metodo.id),
    }, [
      el('span', { class: 'icone-metodo-btn' }, [iconeEl(metodo.icone)]),
      el('span', { text: metodo.nome }),
      el('span', { class: 'texto-min texto-cinza', text: metodo.descricao }),
    ]));
  }
}

async function selecionarMetodo(id) {
  metodoAtual = id;

  qsa('.metodo-btn').forEach((b) => b.classList.toggle('ativo', b.dataset.metodo === id));
  qsa('.painel-metodo').forEach((p) => p.classList.toggle('oculto', p.dataset.metodo !== id));

  if (id === 'pix') await prepararPix();
  if (id === 'cartao') montarParcelas();
  if (id === 'paypal' && CONFIG.MODO_PAGAMENTO === 'real') await prepararPaypalReal();
}

/** Termos aceitos? Senão destaca a caixa e avisa. */
function exigirAceite() {
  if (qs('#aceite-termos').checked) return true;
  qs('#linha-termos').classList.add('erro-aceite');
  qs('#linha-termos').scrollIntoView({ behavior: 'smooth', block: 'center' });
  toast(t('checkout.aceiteObrigatorio'), 'aviso', 5000);
  return false;
}

/** Cria (uma vez) a compra pendente com cupom e reserva. */
async function garantirCompra(metodo) {
  if (!compra) {
    compra = await criarCompra({
      alunoId: usuario.id,
      pacoteId: pacote.id,
      metodo,
      cupom: cupomAplicado?.cupom || null,
      reservas,
    });
  }
  return compra;
}

/* --------------------------------------------------------------------------
   PIX (demonstração)
   -------------------------------------------------------------------------- */

async function prepararPix() {
  if (CONFIG.MODO_PAGAMENTO === 'real') return;
  await garantirCompra('pix');
  const payload = payloadPixDaCompra(compra);
  qs('#pix-copia').value = payload;
  await desenharQrCode(qs('#pix-qr'), payload, 200);
}

async function confirmarPix() {
  if (!exigirAceite()) return;
  const btn = qs('#btn-pix-pago');
  const restaurar = botaoCarregando(btn, 'Verificando pagamento...');

  try {
    await esperar(1800);
    const { compra: paga } = await confirmarPagamento(compra.id, `PIX-${Date.now().toString(36).toUpperCase()}`);
    await mostrarSucesso(paga);
  } catch (err) {
    restaurar();
    toast(err instanceof ErroPagamento ? err.message : 'Não foi possível confirmar o pagamento.', 'erro', 6000);
    console.error('[checkout] erro no PIX:', err);
  }
}

/* --------------------------------------------------------------------------
   Cartão (demonstração)
   -------------------------------------------------------------------------- */

function montarParcelas() {
  const select = qs('#cc-parcelas');
  select.innerHTML = '';

  for (const opcao of opcoesParcelamento(valorAPagar())) {
    const texto = opcao.parcelas === 1
      ? `À vista — ${formatarBRL(opcao.total)}`
      : `${opcao.parcelas}x de ${formatarBRL(opcao.valorParcela)} sem juros`;
    select.append(el('option', { value: String(opcao.parcelas), text: texto }));
  }
}

function atualizarPreviewCartao() {
  const numero = qs('#cc-numero').value;
  const nome = qs('#cc-nome').value.trim();
  const validade = qs('#cc-validade').value;

  qs('#prev-numero').textContent = numero || '•••• •••• •••• ••••';
  qs('#prev-nome').textContent = nome ? nome.toUpperCase() : 'NOME NO CARTÃO';
  qs('#prev-validade').textContent = validade || 'MM/AA';
  qs('#prev-bandeira').textContent = bandeiraCartao(numero) || '—';
}

async function pagarComCartao(ev) {
  ev.preventDefault();
  if (!exigirAceite()) return;

  const numero = qs('#cc-numero').value.replace(/\s/g, '');
  const nome = qs('#cc-nome').value.trim();
  const validade = qs('#cc-validade').value;
  const cvv = qs('#cc-cvv').value.replace(/\D/g, '');

  const erros = {
    'cc-numero': !validarLuhn(numero),
    'cc-nome': nome.length < 3,
    'cc-validade': !validarValidade(validade),
    'cc-cvv': cvv.length < 3,
  };
  Object.entries(erros).forEach(([id, temErro]) => {
    qs(`#${id}`).closest('.campo').classList.toggle('erro', temErro);
  });
  if (Object.values(erros).some(Boolean)) {
    toast('Confira os dados do cartão.', 'aviso');
    return;
  }

  const btn = qs('#btn-pagar-cartao');
  const restaurar = botaoCarregando(btn, 'Processando pagamento...');

  try {
    await garantirCompra('cartao');
    const { compra: paga } = await processarPagamento({ compra, metodo: 'cartao' });
    await mostrarSucesso(paga);
  } catch (err) {
    restaurar();
    toast(err instanceof ErroPagamento ? err.message : 'Pagamento não autorizado.', 'erro', 6000);
    console.error('[checkout] erro no cartão:', err);
  }
}

/* --------------------------------------------------------------------------
   Mercado Pago e PayPal
   -------------------------------------------------------------------------- */

async function pagarComGateway(metodo, btnId) {
  if (!exigirAceite()) return;
  const btn = qs(`#${btnId}`);
  const restaurar = botaoCarregando(btn, CONFIG.MODO_PAGAMENTO === 'real' ? t('checkout.redirecionando') : 'Processando...');

  try {
    await garantirCompra(metodo);
    const resultado = await processarPagamento({ compra, metodo });
    if (resultado?.aguardando) {
      // Cupom de 100%: o servidor credita; a tela espera como no retorno do MP.
      location.href = `checkout.html?compra=${encodeURIComponent(compra.id)}`;
      return;
    }
    await mostrarSucesso(resultado.compra);
  } catch (err) {
    restaurar();
    toast(err instanceof ErroPagamento ? err.message : `Não foi possível pagar com ${nomeMetodo(metodo)}.`, 'erro', 7000);
    console.error(`[checkout] erro no ${metodo}:`, err);
  }
}

async function prepararPaypalReal() {
  const container = qs('#paypal-container');
  qs('#btn-paypal').classList.add('oculto');
  if (container.dataset.montado) return;
  container.dataset.montado = '1';
  try {
    await montarBotoesPaypal(container, {
      obterCompra: async (metodo) => {
        if (!qs('#aceite-termos').checked) {
          exigirAceite();
          throw new Error('Termos não aceitos');
        }
        return garantirCompra(metodo);
      },
      aoAprovar: (c) => { location.href = `checkout.html?compra=${encodeURIComponent(c.id)}`; },
      aoErro: (err) => {
        console.error('[checkout] PayPal:', err);
        toast('O PayPal não concluiu o pagamento. Tente de novo ou use o Mercado Pago.', 'erro', 6000);
      },
    });
  } catch (err) {
    container.dataset.montado = '';
    container.innerHTML = '';
    container.append(el('p', { class: 'texto-peq texto-perigo', text: err.message }));
  }
}

/* --------------------------------------------------------------------------
   Retorno do pagamento real: espera o webhook
   -------------------------------------------------------------------------- */

async function aguardarConfirmacao(compraId) {
  qs('#etapa-planos').classList.add('oculto');
  qs('#etapa-pagamento').classList.add('oculto');
  qs('#etapa-aguardando').classList.remove('oculto');

  const inicial = await obter('compras', compraId);
  if (!inicial || inicial.alunoId !== usuario.id) {
    toast('Compra não encontrada.', 'erro');
    location.replace('dashboard.html');
    return;
  }
  pacote = await obterPacote(inicial.pacoteId);

  let concluido = false;
  const cancelar = observar('compras', { alunoId: usuario.id }, async (lista) => {
    const atual = lista.find((c) => c.id === compraId);
    if (!atual || concluido) return;
    if (atual.status === 'pago') {
      concluido = true;
      cancelar?.();
      await mostrarSucesso(atual);
    } else if (atual.status === 'cancelado' || atual.status === 'recusado') {
      concluido = true;
      cancelar?.();
      qs('#aguardando-detalhe').textContent = 'O pagamento não foi aprovado. Nenhum valor foi cobrado — tente de novo pelo checkout.';
    }
  });
}

/* --------------------------------------------------------------------------
   Etapa 3 — sucesso
   -------------------------------------------------------------------------- */

async function mostrarSucesso(compraPaga) {
  qs('#etapa-pagamento').classList.add('oculto');
  qs('#etapa-aguardando').classList.add('oculto');
  qs('#etapa-sucesso').classList.remove('oculto');
  window.scrollTo({ top: 0, behavior: 'smooth' });

  // A aula escolhida no fluxo de reserva vira agendamento agora.
  const atual = (compraPaga?.id && await obter('compras', compraPaga.id)) || compraPaga;
  const area = qs('#sucesso-aula');
  if (aulasDaCompra(atual).length) {
    area.innerHTML = '<div class="vazio"><span class="spinner escuro"></span></div>';
    const resultado = await concluirReserva(atual, usuario);
    limparRascunho();
    area.innerHTML = '';
    const linhaAula = (a) => `${dataPorExtenso(a.data)} · ${faixaHorario(a.horario, contexto.config.duracaoMin)} · ${nomeLocal(contexto.mapaLocais, a.localId)}`;
    if (resultado.agendadas.length) {
      const linhas = [];
      resultado.agendadas.forEach((a) => linhas.push(el('br'), linhaAula(a)));
      area.append(el('div', { class: 'alerta alerta-sucesso' }, [
        iconeEl('agenda'),
        el('span', { class: 'cresce' }, [
          el('strong', { text: resultado.agendadas.length === 1 ? t('checkout.aulaAgendada') : t('checkout.aulasAgendadas', { n: resultado.agendadas.length }) }),
          ...linhas,
          el('br'),
          el('span', { class: 'texto-min', text: t('checkout.leveDocumento') }),
        ]),
      ]));
      qs('#btn-sucesso-agendar').textContent = t('checkout.agendarOutra');
    }
    if (resultado.falhas.length) {
      const linhas = [];
      resultado.falhas.forEach((a) => linhas.push(el('br'), `${linhaAula(a)} — ${a.erro}`));
      area.append(el('div', { class: `alerta alerta-aviso ${resultado.agendadas.length ? 'mt-16' : ''}` }, [
        iconeEl('alerta'),
        el('span', { class: 'cresce' }, [el('strong', { text: t('checkout.reservaFalhouTitulo') }), ...linhas, el('br'), t('checkout.reservaFalhou')]),
      ]));
    }
  }

  const saldo = await saldoCreditos(usuario.id);
  const chip = qs('#chip-creditos-valor');
  if (chip) chip.textContent = String(saldo);

  const creditos = Number(atual?.creditos ?? pacote?.creditos ?? 0);
  qs('#sucesso-detalhe').innerHTML = `
    <strong>${creditos} ${creditos === 1 ? 'crédito foi adicionado' : 'créditos foram adicionados'}</strong>
    à sua conta.<br>
    Saldo atual: <strong>${saldo} ${saldo === 1 ? 'crédito' : 'créditos'}</strong>.`;
}

/* --------------------------------------------------------------------------
   Pré-requisitos: cadastro completo e questionário de saúde
   -------------------------------------------------------------------------- */

/** Mostra o formulário de saúde e esconde o pagamento até o aluno assinar. */
async function exigirDeclaracao() {
  const vigente = await declaracaoValida(usuario.id);
  if (vigente) return true;
  qs('#grade-pagamento').classList.add('oculto');
  qs('#card-saude').classList.remove('oculto');
  montarFormularioSaude(qs('#form-saude'), {
    usuario,
    textoBotao: t('saude.assinarContinuar'),
    aoAssinar: () => {
      qs('#card-saude').classList.add('oculto');
      qs('#grade-pagamento').classList.remove('oculto');
      toast(t('saude.assinadaOk'), 'sucesso');
    },
  });
  return false;
}

/* --------------------------------------------------------------------------
   Inicialização
   -------------------------------------------------------------------------- */

async function iniciar() {
  usuario = await exigirAuth(['aluno']);

  montarShellPainel({
    usuario,
    paginaAtual: 'planos',
    chipCreditos: true,
    aoSair: () => sair(),
  });

  contexto = await carregarContexto();
  const chip = qs('#chip-creditos-valor');
  if (chip) chip.textContent = String(await saldoCreditos(usuario.id));

  // Volta do Mercado Pago (ou do PayPal / cupom 100%).
  const compraRetorno = paramUrl('compra');
  if (compraRetorno) {
    await aguardarConfirmacao(compraRetorno);
    return;
  }

  // Cadastro feito antes desta versão (ou via Google) sem documento.
  if (!perfilCompleto(usuario)) {
    toast(t('checkout.completarPerfil'), 'aviso', 6000);
    location.replace(`perfil.html?completar=1&voltar=${encodeURIComponent(location.pathname.split('/').pop() + location.search)}`);
    return;
  }

  const pacoteId = paramUrl('pacote');

  if (!pacoteId) {
    await montarCatalogo();
    return;
  }

  pacote = await obterPacote(pacoteId);
  if (!pacote || pacote.ativo === false) {
    toast('Este plano não está mais disponível.', 'erro');
    await montarCatalogo();
    return;
  }

  // Fluxo de reserva: a aula escolhida acompanha a compra.
  if (paramUrl('reserva') === '1') {
    const rascunho = lerRascunho();
    if (rascunho.pacoteId === pacote.id) reservas = reservasDoRascunho(rascunho).slice(0, Number(pacote.creditos) || 1);
    montarPassosReserva();
  }

  qs('#etapa-planos').classList.add('oculto');
  qs('#etapa-pagamento').classList.remove('oculto');
  qs('#politica-resumo').innerHTML = politicaHTML({ horas: contexto.config.horasMinimasCancelamento });
  qs('[data-i18n-html="checkout.aceite"]').innerHTML = t('checkout.aceite', { horas: contexto.config.horasMinimasCancelamento });

  montarResumo();
  montarMetodos();

  qs('#aceite-termos').addEventListener('change', () => qs('#linha-termos').classList.remove('erro-aceite'));
  qs('#form-cupom').addEventListener('submit', aplicarCupom);

  // Listeners do cartão
  qs('#cc-numero').addEventListener('input', (ev) => {
    ev.target.value = mascaraCartao(ev.target.value);
    atualizarPreviewCartao();
  });
  qs('#cc-validade').addEventListener('input', (ev) => {
    ev.target.value = mascaraValidade(ev.target.value);
    atualizarPreviewCartao();
  });
  qs('#cc-cvv').addEventListener('input', (ev) => {
    ev.target.value = ev.target.value.replace(/\D/g, '');
  });
  qs('#cc-nome').addEventListener('input', atualizarPreviewCartao);
  qsa('#form-cartao input').forEach((input) => {
    input.addEventListener('input', () => input.closest('.campo')?.classList.remove('erro'));
  });
  qs('#form-cartao').addEventListener('submit', pagarComCartao);

  // PIX
  qs('#btn-copiar-pix').addEventListener('click', async () => {
    const ok = await copiar(qs('#pix-copia').value);
    toast(ok ? 'Código PIX copiado!' : 'Não foi possível copiar. Selecione e copie manualmente.', ok ? 'sucesso' : 'erro');
  });
  qs('#btn-pix-pago').addEventListener('click', confirmarPix);

  // Gateways
  qs('#btn-mercadopago').addEventListener('click', () => pagarComGateway('mercadopago', 'btn-mercadopago'));
  qs('#btn-paypal').addEventListener('click', () => pagarComGateway('paypal', 'btn-paypal'));

  // Sem declaração vigente o formulário aparece no lugar do pagamento; os
  // métodos já ficam prontos para quando o aluno assinar.
  await exigirDeclaracao();
  await selecionarMetodo(metodoAtual);
}

iniciar();
