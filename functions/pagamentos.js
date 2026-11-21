/**
 * pagamentos.js — servidor de pagamentos do Barra Floripa (Cloud Functions).
 *
 * Rotas (todas POST, em https://<região>-<projeto>.cloudfunctions.net/api):
 *   /mercadopago/preference  cria o Checkout Pro (PIX, cartão, boleto)
 *   /mercadopago/webhook     recebe o aviso de pagamento do Mercado Pago
 *   /paypal/ordem            cria a ordem do PayPal
 *   /paypal/capturar         captura a ordem que o aluno aprovou
 *   /compra/gratuita         confirma compra que ficou R$ 0 com cupom de 100%
 *
 * Só este arquivo emite crédito de compra em produção. O navegador nunca
 * decide se algo foi pago: ele cria a compra 'pendente' e este servidor
 * recalcula preço e cupom a partir do catálogo antes de cobrar.
 *
 * Segredos (firebase functions:secrets:set ...):
 *   MP_ACCESS_TOKEN     Access Token de produção do Mercado Pago (APP_USR-...)
 *   MP_WEBHOOK_SECRET   "Assinatura secreta" dos webhooks do Mercado Pago
 *   PAYPAL_CLIENT_ID / PAYPAL_SECRET  (opcionais, só se usar PayPal)
 * Variáveis (functions/.env): SITE_URL, PAYPAL_API
 */

const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const crypto = require('node:crypto');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const MP_ACCESS_TOKEN = defineSecret('MP_ACCESS_TOKEN');
const MP_WEBHOOK_SECRET = defineSecret('MP_WEBHOOK_SECRET');
const PAYPAL_CLIENT_ID = defineSecret('PAYPAL_CLIENT_ID');
const PAYPAL_SECRET = defineSecret('PAYPAL_SECRET');

class ErroHttp extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

/**
 * Catálogo de fábrica — cópia de DEFAULTS.pacotes (js/config.js). Só é usado
 * se o pacote não existir na coleção `pacotes` (escola que nunca salvou os
 * preços pelo painel). Mantenha os dois iguais.
 */
const PACOTES_PADRAO = {
  'pac-avulsa': { nome: 'Aula em Grupo Avulsa', tipo: 'avulsa', creditos: 1, preco: 150, validadeDias: null },
  'pac-4': { nome: 'Pacote 4 Aulas', tipo: 'pacote', creditos: 4, preco: 480, validadeDias: 30 },
  'pac-9': { nome: 'Pacote 9 Aulas', tipo: 'pacote', creditos: 9, preco: 990, validadeDias: 40 },
  'pac-12': { nome: 'Pacote 12 Aulas', tipo: 'pacote', creditos: 12, preco: 1300, validadeDias: 60 },
  'pac-individual': { nome: 'Aula Particular', tipo: 'individual', creditos: 1, preco: 250, validadeDias: null },
  'pac-mensal-1x': { nome: 'Mensalista 1x/semana', tipo: 'mensal', creditos: 4, preco: 400, validadeDias: 30, apenasFimDeSemana: true },
  'pac-mensal-2x': { nome: 'Mensalista 2x/semana', tipo: 'mensal', creditos: 8, preco: 720, validadeDias: 30, apenasFimDeSemana: true },
};

const siteUrl = () => (process.env.SITE_URL || '').replace(/\/+$/, '');

/* ---------- Cupons (mesma regra de js/cupons.js) ---------- */

function hojeBrasilia() {
  return new Date(Date.now() - 3 * 3600000).toISOString().slice(0, 10);
}

function descontoDoCupom(cupom, pacoteId, original) {
  if (!cupom || cupom.ativo === false) throw new ErroHttp(400, 'Cupom inválido ou desativado.');
  if (cupom.validoAte && cupom.validoAte < hojeBrasilia()) throw new ErroHttp(400, 'Este cupom expirou.');
  if (cupom.usosMaximos && Number(cupom.usos || 0) >= Number(cupom.usosMaximos)) {
    throw new ErroHttp(400, 'Este cupom já atingiu o limite de usos.');
  }
  if (Array.isArray(cupom.pacotes) && cupom.pacotes.length && !cupom.pacotes.includes(pacoteId)) {
    throw new ErroHttp(400, 'Este cupom não vale para o plano escolhido.');
  }
  let desconto = cupom.tipo === 'percentual' ? (original * Number(cupom.valor)) / 100 : Number(cupom.valor);
  desconto = Math.max(0, Math.min(original, Math.round(desconto * 100) / 100));
  let valor = Math.round((original - desconto) * 100) / 100;
  if (valor > 0 && valor < 1) { valor = 1; desconto = original - 1; }
  return { desconto, valor };
}

/* ---------- Compras e créditos ---------- */

/** Confere o login do aluno pelo token do Firebase que o site envia. */
async function uidDoAluno(req) {
  const token = (req.get('Authorization') || '').replace(/^Bearer /, '');
  if (!token) throw new ErroHttp(401, 'Faça login novamente.');
  try {
    return (await admin.auth().verifyIdToken(token)).uid;
  } catch {
    throw new ErroHttp(401, 'Sessão expirada. Faça login novamente.');
  }
}

/**
 * Carrega a compra do aluno e regrava preço, cupom e créditos a partir do
 * catálogo. Quem cria a compra é o navegador, então valor e créditos dela
 * só passam a ser confiáveis depois daqui.
 */
const MAX_CREDITOS_PACOTE = 60;
const MAX_QUANTIDADE = 12;

async function prepararCompra(req) {
  const uid = await uidDoAluno(req);
  const compraId = String(req.body?.compraId || '');
  if (!compraId) throw new ErroHttp(400, 'Compra não informada.');

  const ref = db.collection('compras').doc(compraId);
  const snap = await ref.get();
  if (!snap.exists || snap.get('alunoId') !== uid) throw new ErroHttp(404, 'Compra não encontrada.');
  if (snap.get('status') === 'pago') throw new ErroHttp(409, 'Esta compra já foi paga.');

  const pacoteId = snap.get('pacoteId');
  const pacoteSnap = await db.collection('pacotes').doc(pacoteId).get();
  const pacote = pacoteSnap.exists ? pacoteSnap.data() : PACOTES_PADRAO[pacoteId];
  if (!pacote || pacote.ativo === false) throw new ErroHttp(400, 'Este plano não está mais disponível.');
  if (!(Number(pacote.creditos) >= 1 && Number(pacote.creditos) <= MAX_CREDITOS_PACOTE)) {
    throw new ErroHttp(400, 'Este plano está com o cadastro inválido. Avise a escola.');
  }

  // Aula avulsa/particular pode ser comprada em quantidade (ex.: 2 avulsas).
  const quantidade = Number(pacote.creditos) === 1
    ? Math.min(MAX_QUANTIDADE, Math.max(1, Math.trunc(Number(snap.get('quantidade')) || 1)))
    : 1;
  const original = Number(pacote.preco) * quantidade;
  let desconto = 0;
  let valor = original;
  const cupomCodigo = snap.get('cupomCodigo') || null;
  if (cupomCodigo) {
    const cupomSnap = await db.collection('cupons').doc(cupomCodigo).get();
    ({ desconto, valor } = descontoDoCupom(cupomSnap.exists ? cupomSnap.data() : null, pacoteId, original));
  }

  const usuario = (await db.collection('usuarios').doc(uid).get()).data() || {};
  const confiavel = {
    nomePacote: quantidade > 1 ? `${quantidade}× ${pacote.nome}` : pacote.nome,
    quantidade,
    valorOriginal: original,
    desconto,
    valor,
    creditos: Number(pacote.creditos) * quantidade,
    validadeDias: pacote.validadeDias ?? null,
    apenasFimDeSemana: pacote.apenasFimDeSemana === true,
    tipoPacote: pacote.tipo === 'individual' ? 'individual' : 'grupo',
    status: 'pendente',
    atualizadoEm: new Date().toISOString(),
  };
  await ref.update(confiavel);
  return { id: compraId, ...snap.data(), ...confiavel, pagador: { email: usuario.email, nome: usuario.nome } };
}

/** Fim do dia, N dias após o pagamento, no horário de Brasília (UTC-3). */
function expiraEmISO(pagoEm, validadeDias) {
  if (!validadeDias) return null;
  const FUSO = 3 * 60 * 60 * 1000;
  const local = new Date(pagoEm.getTime() - FUSO);
  local.setUTCDate(local.getUTCDate() + Number(validadeDias));
  local.setUTCHours(23, 59, 59, 999);
  return new Date(local.getTime() + FUSO).toISOString();
}

/**
 * Marca a compra como paga, lança os créditos e conta o uso do cupom.
 * Idempotente: avisos repetidos do gateway não dobram o saldo (a compra já
 * paga é ignorada e o lançamento tem id fixo `compra_<id>`, o mesmo que o
 * site usa no modo demonstração).
 */
async function creditarCompra(compraId, referencia, valorPago) {
  const ref = db.collection('compras').doc(compraId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error(`Compra ${compraId} não encontrada.`);
    const compra = snap.data();
    if (compra.status === 'pago') return;
    if (Math.abs(Number(valorPago) - Number(compra.valor)) > 0.01) {
      throw new Error(`Compra ${compraId}: pago ${valorPago}, esperado ${compra.valor}.`);
    }
    const cupomRef = compra.cupomCodigo ? db.collection('cupons').doc(compra.cupomCodigo) : null;
    const cupomSnap = cupomRef ? await tx.get(cupomRef) : null;

    const pagoEm = new Date();
    tx.update(ref, {
      status: 'pago',
      pagoEm: pagoEm.toISOString(),
      referenciaPagamento: referencia,
      atualizadoEm: pagoEm.toISOString(),
    });
    tx.set(db.collection('creditos').doc(`compra_${compraId}`), {
      alunoId: compra.alunoId,
      delta: Number(compra.creditos) || 0,
      motivo: 'compra',
      nomePacote: compra.nomePacote,
      pacoteId: compra.pacoteId,
      tipoPacote: compra.tipoPacote || 'grupo',
      apenasFimDeSemana: compra.apenasFimDeSemana === true,
      expiraEm: expiraEmISO(pagoEm, compra.validadeDias),
      compraId,
      agendamentoId: null,
      observacao: compra.cupomCodigo ? `Cupom ${compra.cupomCodigo}` : null,
      criadoEm: pagoEm.toISOString(),
    });
    if (cupomSnap?.exists) {
      tx.update(cupomRef, { usos: Number(cupomSnap.get('usos') || 0) + 1, atualizadoEm: pagoEm.toISOString() });
    }
  });
}

/** Pagamento recusado/cancelado: a compra pendente sai do caminho. */
async function marcarRecusada(compraId, motivo) {
  const ref = db.collection('compras').doc(compraId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists || snap.get('status') !== 'pendente') return;
    tx.update(ref, { status: 'recusado', motivoRecusa: motivo, atualizadoEm: new Date().toISOString() });
  });
}

/* ---------- Mercado Pago ---------- */

async function mercadoPago(caminho, opcoes = {}) {
  const resp = await fetch(`https://api.mercadopago.com${caminho}`, {
    ...opcoes,
    headers: {
      Authorization: `Bearer ${MP_ACCESS_TOKEN.value()}`,
      'Content-Type': 'application/json',
      ...(opcoes.method === 'POST' ? { 'X-Idempotency-Key': crypto.randomUUID() } : {}),
    },
  });
  const dados = await resp.json();
  if (!resp.ok) throw new Error(`Mercado Pago ${resp.status}: ${JSON.stringify(dados)}`);
  return dados;
}

async function criarPreferenciaMP(req) {
  const compra = await prepararCompra(req);
  if (compra.valor <= 0) throw new ErroHttp(400, 'Compra sem valor: use a confirmação gratuita.');
  const voltar = `${siteUrl()}/checkout.html?compra=${encodeURIComponent(compra.id)}`;

  const preferencia = await mercadoPago('/checkout/preferences', {
    method: 'POST',
    body: JSON.stringify({
      items: [{
        id: compra.pacoteId,
        title: compra.nomePacote + (compra.cupomCodigo ? ` (cupom ${compra.cupomCodigo})` : ''),
        quantity: 1,
        unit_price: compra.valor,
        currency_id: 'BRL',
      }],
      payer: compra.pagador?.email ? { email: compra.pagador.email, name: compra.pagador.nome } : undefined,
      external_reference: compra.id,
      back_urls: { success: voltar, pending: voltar, failure: voltar },
      auto_return: 'approved',
      payment_methods: { installments: 12 },
      statement_descriptor: 'BARRA FLORIPA',
    }),
  });
  return { initPoint: preferencia.init_point };
}

/** Confere a assinatura x-signature: prova que o aviso veio do Mercado Pago. */
function assinaturaMPValida(req, dataId) {
  const partes = Object.fromEntries(
    (req.get('x-signature') || '').split(',').map((p) => p.trim().split('=')),
  );
  if (!partes.ts || !partes.v1) return false;
  const manifesto = `id:${dataId};request-id:${req.get('x-request-id')};ts:${partes.ts};`;
  const esperado = crypto.createHmac('sha256', MP_WEBHOOK_SECRET.value()).update(manifesto).digest('hex');
  return partes.v1.length === esperado.length
    && crypto.timingSafeEqual(Buffer.from(partes.v1), Buffer.from(esperado));
}

async function webhookMP(req) {
  const tipo = req.query.type || req.body?.type;
  const dataId = String(req.query['data.id'] || req.body?.data?.id || '').toLowerCase();
  if (tipo !== 'payment' || !dataId) return { ok: true }; // outros avisos: ignora
  if (!assinaturaMPValida(req, dataId)) throw new ErroHttp(401, 'Assinatura inválida.');

  let pagamento;
  try {
    pagamento = await mercadoPago(`/v1/payments/${dataId}`);
  } catch (err) {
    // O botão "Simular" do painel manda um id que não existe.
    logger.warn('Pagamento não encontrado no Mercado Pago', err.message);
    return { ok: true };
  }

  const compraId = pagamento.external_reference;
  if (!compraId) return { ok: true };

  // PIX e boleto chegam primeiro como 'pending' e depois como 'approved'.
  if (pagamento.status === 'approved') {
    await creditarCompra(compraId, `MP-${pagamento.id}`, pagamento.transaction_amount);
  } else if (['rejected', 'cancelled'].includes(pagamento.status)) {
    await marcarRecusada(compraId, `${pagamento.status}: ${pagamento.status_detail || ''}`);
  }
  return { ok: true };
}

/* ---------- Cupom de 100% ---------- */

async function compraGratuita(req) {
  const compra = await prepararCompra(req);
  if (compra.valor !== 0) throw new ErroHttp(400, 'Esta compra tem valor a pagar.');
  await creditarCompra(compra.id, `CUPOM-${compra.cupomCodigo || 'GRATIS'}`, 0);
  return { ok: true };
}

/* ---------- PayPal ---------- */

async function paypal(caminho, corpo = {}) {
  const base = process.env.PAYPAL_API;
  const basic = Buffer.from(`${PAYPAL_CLIENT_ID.value()}:${PAYPAL_SECRET.value()}`).toString('base64');
  const respToken = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const { access_token: token } = await respToken.json();

  const resp = await fetch(`${base}${caminho}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  const dados = await resp.json();
  if (!resp.ok) throw new Error(`PayPal ${resp.status}: ${JSON.stringify(dados)}`);
  return dados;
}

async function criarOrdemPaypal(req) {
  const compra = await prepararCompra(req);
  const ordem = await paypal('/v2/checkout/orders', {
    intent: 'CAPTURE',
    purchase_units: [{
      custom_id: compra.id,
      description: compra.nomePacote,
      amount: { currency_code: 'BRL', value: compra.valor.toFixed(2) },
    }],
  });
  return { id: ordem.id };
}

async function capturarPaypal(req) {
  await uidDoAluno(req);
  const orderId = String(req.body?.orderId || '');
  if (!/^[A-Z0-9]+$/.test(orderId)) throw new ErroHttp(400, 'Ordem inválida.');

  const captura = await paypal(`/v2/checkout/orders/${orderId}/capture`);
  const pagamento = captura.purchase_units?.[0]?.payments?.captures?.[0];
  if (captura.status !== 'COMPLETED' || pagamento?.status !== 'COMPLETED'
      || pagamento.amount.currency_code !== 'BRL') {
    throw new ErroHttp(402, 'O PayPal não confirmou o pagamento.');
  }
  await creditarCompra(pagamento.custom_id, `PAYPAL-${pagamento.id}`, pagamento.amount.value);
  return { ok: true };
}

/* ---------- Roteamento ---------- */

const ROTAS = {
  '/mercadopago/preference': criarPreferenciaMP,
  '/mercadopago/webhook': webhookMP,
  '/paypal/ordem': criarOrdemPaypal,
  '/paypal/capturar': capturarPaypal,
  '/compra/gratuita': compraGratuita,
};

exports.api = onRequest(
  {
    region: 'southamerica-east1',
    cors: true,
    secrets: [MP_ACCESS_TOKEN, MP_WEBHOOK_SECRET, PAYPAL_CLIENT_ID, PAYPAL_SECRET],
  },
  async (req, res) => {
    const rota = ROTAS[req.path];
    if (req.method !== 'POST' || !rota) {
      res.status(404).json({ erro: 'Rota não encontrada.' });
      return;
    }
    try {
      res.json(await rota(req));
    } catch (err) {
      logger.error(req.path, err);
      res.status(err.status || 500).json({ erro: err.status ? err.message : 'Erro no servidor de pagamentos.' });
    }
  },
);
