/**
 * checkout.js — escolha de plano e pagamento.
 *
 * Três etapas na mesma página: catálogo → pagamento → confirmação.
 * Sem `?pacote=` na URL, mostra o catálogo; com, vai direto ao pagamento.
 */

import { CONFIG } from '../config.js';
import { exigirAuth, sair } from '../auth.js';
import { obterPacote, obterPacotesAgrupados, precoUnitario, sufixoPeriodo } from '../precos.js';
import { saldoCreditos } from '../creditos.js';
import {
  METODOS, criarCompra, confirmarPagamento, processarPagamento, payloadPixDaCompra,
  desenharQrCode, validarLuhn, bandeiraCartao, mascaraCartao, mascaraValidade,
  validarValidade, opcoesParcelamento, nomeMetodo, ErroPagamento,
} from '../pagamentos.js';
import {
  qs, qsa, el, formatarBRL, escapar, paramUrl, toast, copiar,
  montarShellPainel, botaoCarregando, esperar,
} from '../ui.js';

let usuario = null;
let pacote = null;
let compra = null;
let metodoAtual = 'pix';

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
    text: p.creditos > 1 ? `${formatarBRL(unitario)} por aula` : 'Aula avulsa',
  }));

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
   Etapa 2 — resumo e métodos
   -------------------------------------------------------------------------- */

function montarResumo() {
  const alvo = qs('#resumo-conteudo');
  const periodo = pacote.tipo === 'mensal' ? ' por mês' : '';

  alvo.innerHTML = `
    <div class="linha-resumo">
      <span>${escapar(pacote.nome)}</span>
      <span class="negrito">${escapar(formatarBRL(pacote.preco))}</span>
    </div>
    <div class="linha-resumo">
      <span>Créditos de aula</span>
      <span class="negrito">${pacote.creditos}${escapar(periodo)}</span>
    </div>
    <div class="linha-resumo">
      <span>Duração de cada aula</span>
      <span>1h30</span>
    </div>
    ${pacote.creditos > 1 ? `
    <div class="linha-resumo">
      <span>Valor por aula</span>
      <span>${escapar(formatarBRL(precoUnitario(pacote)))}</span>
    </div>` : ''}
    <div class="linha-resumo total">
      <span>Total</span>
      <span class="valor">${escapar(formatarBRL(pacote.preco))}</span>
    </div>`;

  const aviso = qs('#aviso-modo');
  if (CONFIG.MODO_PAGAMENTO === 'mock') {
    aviso.innerHTML = `
      <span>🧪</span>
      <span><strong>Modo demonstração.</strong> Nenhuma cobrança real é feita.
      O pagamento é simulado e os créditos entram na hora, para você testar o
      sistema inteiro.</span>`;
  } else {
    aviso.classList.add('oculto');
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
      el('span', { class: 'icone', text: metodo.icone }),
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
}

/* --------------------------------------------------------------------------
   PIX
   -------------------------------------------------------------------------- */

async function prepararPix() {
  // A compra só é criada quando o aluno chega no método de pagamento.
  if (!compra) compra = await criarCompra({ alunoId: usuario.id, pacoteId: pacote.id, metodo: 'pix' });

  const payload = payloadPixDaCompra(compra);
  qs('#pix-copia').value = payload;

  await desenharQrCode(qs('#pix-qr'), payload, 200);
}

async function confirmarPix() {
  const btn = qs('#btn-pix-pago');
  const restaurar = botaoCarregando(btn, 'Verificando pagamento...');

  try {
    if (CONFIG.MODO_PAGAMENTO === 'mock') {
      // Simula o tempo que o banco leva para liquidar o PIX.
      await esperar(1800);
      await confirmarPagamento(compra.id, `PIX-${Date.now().toString(36).toUpperCase()}`);
      mostrarSucesso();
      return;
    }

    // Em produção quem confirma é o webhook do PSP; aqui só consultamos.
    await processarPagamento({ compra, metodo: 'pix' });
    mostrarSucesso();
  } catch (err) {
    restaurar();
    toast(err instanceof ErroPagamento ? err.message : 'Não foi possível confirmar o pagamento.', 'erro', 6000);
    console.error('[checkout] erro no PIX:', err);
  }
}

/* --------------------------------------------------------------------------
   Cartão
   -------------------------------------------------------------------------- */

function montarParcelas() {
  const select = qs('#cc-parcelas');
  select.innerHTML = '';

  for (const opcao of opcoesParcelamento(pacote.preco)) {
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
    if (!compra) {
      compra = await criarCompra({ alunoId: usuario.id, pacoteId: pacote.id, metodo: 'cartao' });
    }
    // Nota: no modo demo os dados do cartão nunca saem desta função. Em
    // produção, tokenize com o SDK do gateway e envie só o token.
    await processarPagamento({ compra, metodo: 'cartao' });
    mostrarSucesso();
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
  const btn = qs(`#${btnId}`);
  const restaurar = botaoCarregando(btn, 'Redirecionando...');

  try {
    if (!compra) {
      compra = await criarCompra({ alunoId: usuario.id, pacoteId: pacote.id, metodo });
    }
    await processarPagamento({ compra, metodo });
    mostrarSucesso();
  } catch (err) {
    restaurar();
    toast(err instanceof ErroPagamento ? err.message : `Não foi possível pagar com ${nomeMetodo(metodo)}.`, 'erro', 6000);
    console.error(`[checkout] erro no ${metodo}:`, err);
  }
}

/* --------------------------------------------------------------------------
   Etapa 3 — sucesso
   -------------------------------------------------------------------------- */

async function mostrarSucesso() {
  qs('#etapa-pagamento').classList.add('oculto');
  qs('#etapa-sucesso').classList.remove('oculto');
  window.scrollTo({ top: 0, behavior: 'smooth' });

  const saldo = await saldoCreditos(usuario.id);
  const chip = qs('#chip-creditos-valor');
  if (chip) chip.textContent = String(saldo);

  qs('#sucesso-detalhe').innerHTML = `
    <strong>${pacote.creditos} ${pacote.creditos === 1 ? 'crédito foi adicionado' : 'créditos foram adicionados'}</strong>
    à sua conta.<br>
    Saldo atual: <strong>${saldo} ${saldo === 1 ? 'crédito' : 'créditos'}</strong>.`;
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

  const chip = qs('#chip-creditos-valor');
  if (chip) chip.textContent = String(await saldoCreditos(usuario.id));

  const pacoteId = paramUrl('pacote');

  // Sem plano escolhido: mostra o catálogo.
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

  qs('#etapa-planos').classList.add('oculto');
  qs('#etapa-pagamento').classList.remove('oculto');

  montarResumo();
  montarMetodos();

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

  await selecionarMetodo('pix');
}

iniciar();
