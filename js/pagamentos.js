/**
 * pagamentos.js — criação de compras, confirmação e emissão de créditos.
 *
 * MODO_PAGAMENTO = 'mock'  -> fluxo visual completo, sem cobrança real.
 * MODO_PAGAMENTO = 'real'  -> usa os SDKs dos gateways. Exige backend.
 *
 * AVISO DE SEGURANÇA
 * Em produção, quem credita as aulas tem que ser o SEU BACKEND, ao receber
 * o webhook do gateway. Se a emissão de crédito ficar no cliente (como aqui,
 * no modo demo), qualquer pessoa com o console aberto se dá crédito de graça.
 * Veja docs/GUIA.md, seção "Pagamentos em produção".
 */

import { CONFIG } from './config.js';
import { criar, transacao, driverAtual } from './store.js';
import { obterPacote, pacoteComQuantidade } from './precos.js';
import { lancarCredito } from './creditos.js';
import { calcularDesconto, registrarUsoCupom } from './cupons.js';
import { esperar, icone } from './ui.js';

export class ErroPagamento extends Error {
  constructor(codigo, mensagem) {
    super(mensagem);
    this.name = 'ErroPagamento';
    this.codigo = codigo;
  }
}

/** Métodos simulados (modo demonstração). */
const METODOS_DEMO = [
  { id: 'pix', nome: 'PIX', icone: 'raio', descricao: 'Aprovação na hora' },
  { id: 'cartao', nome: 'Cartão', icone: 'planos', descricao: 'Crédito em até 12x' },
  { id: 'mercadopago', nome: 'Mercado Pago', icone: 'carrinho', descricao: 'Saldo, cartão ou boleto' },
  { id: 'paypal', nome: 'PayPal', icone: 'globo', descricao: 'Conta PayPal' },
];

/**
 * Produção: cada meio de pagamento existe num lugar só. PIX, cartão e boleto
 * pelo Mercado Pago (ambiente seguro dele, sem cartão digitado no site);
 * PayPal só aparece quando o Client ID estiver configurado.
 */
const METODOS_REAIS = [
  { id: 'mercadopago', nome: 'PIX, cartão ou boleto', icone: 'carrinho', descricao: 'Pelo Mercado Pago' },
  ...(CONFIG.pagamentos.paypalClientId
    ? [{ id: 'paypal', nome: 'PayPal', icone: 'globo', descricao: 'Conta PayPal (internacional)' }]
    : []),
];

export const METODOS = CONFIG.MODO_PAGAMENTO === 'real' ? METODOS_REAIS : METODOS_DEMO;

export const nomeMetodo = (id) => [...METODOS_DEMO, ...METODOS_REAIS].find((m) => m.id === id)?.nome || id;

/* --------------------------------------------------------------------------
   Compras
   -------------------------------------------------------------------------- */

/**
 * Cria a compra com status 'pendente'. Nenhum crédito é emitido aqui.
 * `cupom`: documento do cupom já validado (cupons.js) ou null.
 * `reservas`: aulas escolhidas no fluxo de reserva ([{ data, horario, localId, tipo }]).
 * `quantidade`: para aula avulsa/particular (ex.: 2 aulas avulsas).
 */
export async function criarCompra({ alunoId, pacoteId, metodo, cupom = null, reservas = [], quantidade = 1 }) {
  const base = await obterPacote(pacoteId);
  const pacote = base ? pacoteComQuantidade(base, quantidade) : null;
  if (!pacote) throw new ErroPagamento('PACOTE_INVALIDO', 'Plano não encontrado.');
  if (pacote.ativo === false) throw new ErroPagamento('PACOTE_INATIVO', 'Este plano não está mais disponível.');

  const preco = Number(pacote.preco);
  const { desconto, valorFinal } = cupom ? calcularDesconto(cupom, preco) : { desconto: 0, valorFinal: preco };

  return criar('compras', {
    alunoId,
    pacoteId: pacote.id,
    nomePacote: pacote.nome,
    quantidade: pacote.quantidade,
    valorOriginal: preco,
    desconto,
    cupomCodigo: cupom?.codigo || null,
    valor: valorFinal,
    // Nunca mais aulas do que créditos do plano.
    reservas: (reservas || []).slice(0, Number(pacote.creditos) || 1),
    reservaStatus: reservas?.length ? 'pendente' : null,
    aceiteTermosEm: new Date().toISOString(),
    creditos: pacote.creditos,
    // Regras do pacote viajam junto com a compra: assim, se o admin alterar
    // o catálogo depois, quem já comprou mantém as condições contratadas.
    validadeDias: pacote.validadeDias ?? null,
    apenasFimDeSemana: pacote.apenasFimDeSemana === true,
    tipoPacote: pacote.tipo === 'individual' ? 'individual' : 'grupo',
    metodo,
    status: 'pendente',
    referenciaPagamento: null,
    criadoEm: new Date().toISOString(),
    pagoEm: null,
  });
}

/**
 * Confirma o pagamento e emite os créditos.
 *
 * Idempotente: se a compra já estiver paga, devolve o estado atual sem
 * lançar crédito de novo. É o que impede que um duplo clique, um retry do
 * webhook ou um reload da página dobrem o saldo do aluno.
 */
export async function confirmarPagamento(compraId, referencia = null) {
  return transacao(async (ops) => {
    const compra = await ops.obter('compras', compraId);
    if (!compra) throw new ErroPagamento('NAO_ENCONTRADA', 'Compra não encontrada.');

    if (compra.status === 'pago') {
      return { compra, jaEstavaPaga: true };
    }
    if (compra.status === 'cancelado') {
      throw new ErroPagamento('CANCELADA', 'Esta compra foi cancelada e não pode ser paga.');
    }

    const pagoEm = new Date();

    const atualizada = await ops.atualizar('compras', compraId, {
      status: 'pago',
      pagoEm: pagoEm.toISOString(),
      referenciaPagamento: referencia || `SIM-${Date.now().toString(36).toUpperCase()}`,
    });

    // A validade começa a contar do pagamento, não da criação da compra.
    let expiraEm = null;
    if (compra.validadeDias) {
      const limite = new Date(pagoEm);
      limite.setDate(limite.getDate() + Number(compra.validadeDias));
      limite.setHours(23, 59, 59, 999);
      expiraEm = limite.toISOString();
    }

    await lancarCredito(ops, {
      // Mesmo id que o servidor usa: a compra só credita uma vez, venha a
      // confirmação do navegador (demonstração) ou do webhook (produção).
      id: `compra_${compraId}`,
      alunoId: compra.alunoId,
      delta: Number(compra.creditos) || 0,
      motivo: 'compra',
      compraId,
      nomePacote: compra.nomePacote,
      pacoteId: compra.pacoteId,
      tipoPacote: compra.tipoPacote || 'grupo',
      apenasFimDeSemana: compra.apenasFimDeSemana === true,
      expiraEm,
    });

    return { compra: { ...compra, ...atualizada }, jaEstavaPaga: false };
  }).then(async (resultado) => {
    // Demonstração: o próprio navegador conta o uso do cupom.
    if (!resultado.jaEstavaPaga && resultado.compra.cupomCodigo) {
      await registrarUsoCupom(resultado.compra.cupomCodigo);
    }
    return resultado;
  });
}

/** Cancela uma compra pendente (o aluno desistiu no checkout). */
export async function cancelarCompra(compraId) {
  return transacao(async (ops) => {
    const compra = await ops.obter('compras', compraId);
    if (!compra) throw new ErroPagamento('NAO_ENCONTRADA', 'Compra não encontrada.');
    if (compra.status === 'pago') {
      throw new ErroPagamento('JA_PAGA', 'Esta compra já foi paga. Fale com a escola para pedir estorno.');
    }
    return ops.atualizar('compras', compraId, { status: 'cancelado' });
  });
}

/* --------------------------------------------------------------------------
   PIX — payload copia-e-cola (BR Code / EMV)
   -------------------------------------------------------------------------- */

/** Monta um campo no formato EMV: ID + tamanho (2 dígitos) + valor. */
function campoEMV(id, valor) {
  const conteudo = String(valor);
  return `${id}${String(conteudo.length).padStart(2, '0')}${conteudo}`;
}

/** CRC16/CCITT-FALSE, exigido pelo padrão do BR Code. */
function crc16(texto) {
  let crc = 0xffff;
  for (let i = 0; i < texto.length; i += 1) {
    crc ^= texto.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** Remove acentos e limita o tamanho — o BR Code só aceita ASCII. */
function limpar(texto, max) {
  return String(texto)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ]/g, '')
    .toUpperCase()
    .slice(0, max)
    .trim();
}

/**
 * Gera o payload PIX copia-e-cola.
 *
 * A estrutura segue o padrão do Banco Central, então o texto é válido.
 * No modo demo a chave é a de exemplo do config.js — troque pela chave real
 * da escola para receber de verdade.
 */
export function gerarPayloadPix({ chave, valor, beneficiario, cidade, identificador = '***' }) {
  const merchantAccount = campoEMV('00', 'BR.GOV.BCB.PIX') + campoEMV('01', chave);

  let payload = campoEMV('00', '01')
    + campoEMV('26', merchantAccount)
    + campoEMV('52', '0000')
    + campoEMV('53', '986')
    + campoEMV('54', Number(valor).toFixed(2))
    + campoEMV('58', 'BR')
    + campoEMV('59', limpar(beneficiario, 25) || 'BARRA FLORIPA')
    + campoEMV('60', limpar(cidade, 15) || 'FLORIANOPOLIS')
    + campoEMV('62', campoEMV('05', limpar(identificador, 25) || '***'));

  payload += '6304';
  return payload + crc16(payload);
}

/** Payload PIX da compra, já com os dados da escola. */
export function payloadPixDaCompra(compra) {
  return gerarPayloadPix({
    chave: CONFIG.pagamentos.pixChave,
    valor: compra.valor,
    beneficiario: CONFIG.pagamentos.pixBeneficiario,
    cidade: CONFIG.pagamentos.pixCidade,
    identificador: compra.id.slice(-20),
  });
}

/* --------------------------------------------------------------------------
   QR Code
   -------------------------------------------------------------------------- */

/**
 * O QR é gerado pela biblioteca `qrcodejs` carregada sob demanda do cdnjs.
 *
 * Nota: uma primeira versão deste arquivo trazia um encoder QR escrito à mão.
 * Ele desenhava algo parecido com um QR, mas nenhum leitor conseguia
 * decodificar (a ordem dos blocos e a informação de formato estavam erradas).
 * Um app de banco que não lê o código é pior do que não ter QR, então a
 * geração ficou com uma biblioteca testada. O payload PIX continua sendo
 * montado aqui, em `gerarPayloadPix`.
 */
const URL_QRCODE_LIB = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';

let promessaLibQr = null;

/** Carrega a biblioteca uma única vez. */
function carregarLibQr() {
  if (window.QRCode) return Promise.resolve(window.QRCode);
  if (promessaLibQr) return promessaLibQr;

  promessaLibQr = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = URL_QRCODE_LIB;
    script.async = true;
    script.onload = () => (window.QRCode
      ? resolve(window.QRCode)
      : reject(new Error('Biblioteca de QR carregou, mas não registrou QRCode.')));
    script.onerror = () => reject(new Error('Não foi possível carregar a biblioteca de QR Code.'));
    document.head.append(script);
  });
  return promessaLibQr;
}

/**
 * Desenha o QR Code de `texto` dentro de `container` (uma <div> vazia).
 *
 * Se o CDN estiver indisponível (offline, bloqueio de rede), mostra um aviso
 * com a orientação de usar o copia-e-cola — que funciona sem internet e é o
 * caminho principal do PIX de qualquer forma.
 */
export async function desenharQrCode(container, texto, tamanho = 200) {
  container.innerHTML = '';
  try {
    const QRCode = await carregarLibQr();
    // eslint-disable-next-line no-new
    new QRCode(container, {
      text: texto,
      width: tamanho,
      height: tamanho,
      colorDark: '#1a1a1a',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M,
    });
    return true;
  } catch (err) {
    console.warn('[pagamentos] QR indisponível:', err.message);
    container.innerHTML = `
      <div class="vazio" style="padding:20px">
        <span class="vazio-icone">${icone('lista')}</span>
        <p class="texto-peq">Não foi possível carregar o QR Code agora.<br>
        Use o código <strong>copia e cola</strong> abaixo — ele funciona no app do seu banco.</p>
      </div>`;
    return false;
  }
}

/* --------------------------------------------------------------------------
   Cartão de crédito — validação no cliente
   -------------------------------------------------------------------------- */

/** Algoritmo de Luhn: pega erro de digitação, não valida se o cartão existe. */
export function validarLuhn(numero) {
  const digitos = String(numero).replace(/\D/g, '');
  if (digitos.length < 13 || digitos.length > 19) return false;
  let soma = 0;
  let dobrar = false;
  for (let i = digitos.length - 1; i >= 0; i -= 1) {
    let d = Number(digitos[i]);
    if (dobrar) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    soma += d;
    dobrar = !dobrar;
  }
  return soma % 10 === 0;
}

export function bandeiraCartao(numero) {
  const d = String(numero).replace(/\D/g, '');
  if (/^4/.test(d)) return 'Visa';
  if (/^(5[1-5]|2[2-7])/.test(d)) return 'Mastercard';
  if (/^3[47]/.test(d)) return 'Amex';
  if (/^(36|38|30[0-5])/.test(d)) return 'Diners';
  if (/^(6011|65|64[4-9])/.test(d)) return 'Discover';
  if (/^(606282|3841)/.test(d)) return 'Hipercard';
  if (/^(50|5067|4576|4011)/.test(d)) return 'Elo';
  return '';
}

export function mascaraCartao(valor) {
  const d = String(valor).replace(/\D/g, '').slice(0, 19);
  return d.replace(/(\d{4})(?=\d)/g, '$1 ').trim();
}

export function mascaraValidade(valor) {
  const d = String(valor).replace(/\D/g, '').slice(0, 4);
  return d.length <= 2 ? d : `${d.slice(0, 2)}/${d.slice(2)}`;
}

/** Valida MM/AA e verifica se não está vencido. */
export function validarValidade(texto) {
  const m = /^(\d{2})\/(\d{2})$/.exec(String(texto).trim());
  if (!m) return false;
  const mes = Number(m[1]);
  const ano = 2000 + Number(m[2]);
  if (mes < 1 || mes > 12) return false;
  const ultimoDia = new Date(ano, mes, 0, 23, 59, 59);
  return ultimoDia >= new Date();
}

/** Opções de parcelamento (sem juros, como a escola pratica). */
export function opcoesParcelamento(valor, maxParcelas = 12, minimoParcela = 50) {
  const opcoes = [];
  for (let n = 1; n <= maxParcelas; n += 1) {
    const parcela = valor / n;
    if (n > 1 && parcela < minimoParcela) break;
    opcoes.push({ parcelas: n, valorParcela: parcela, total: valor });
  }
  return opcoes;
}


/* --------------------------------------------------------------------------
   Processamento
   -------------------------------------------------------------------------- */

/**
 * Processa o pagamento conforme o modo configurado.
 *
 * 'mock': simula a latência do gateway e confirma no próprio navegador.
 * 'real': o servidor (functions/pagamentos.js) cria a cobrança; o aluno
 *         paga no Mercado Pago e volta para checkout.html?compra=<id>, onde
 *         a tela espera o webhook marcar a compra como paga.
 */
export async function processarPagamento({ compra, metodo }) {
  if (CONFIG.MODO_PAGAMENTO === 'real') {
    return processarPagamentoReal({ compra, metodo });
  }

  // Simula o tempo de resposta de um gateway de verdade.
  await esperar(1600);
  const referencia = `${metodo.toUpperCase()}-${Date.now().toString(36).toUpperCase()}`;
  return confirmarPagamento(compra.id, referencia);
}

/** Chama uma rota do servidor de pagamentos com o login do aluno. */
export async function chamarServidor(rota, corpo) {
  if (!CONFIG.backendUrl) {
    throw new ErroPagamento('SEM_BACKEND', 'O servidor de pagamentos ainda não foi configurado (CONFIG.backendUrl).');
  }
  const token = await driverAtual().tokenAtual?.();
  if (!token) throw new ErroPagamento('SEM_SESSAO', 'Sua sessão expirou. Entre novamente para pagar.');

  let resp;
  try {
    resp = await fetch(`${CONFIG.backendUrl}${rota}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(corpo),
    });
  } catch {
    throw new ErroPagamento('REDE', 'Não foi possível falar com o servidor de pagamentos. Verifique a internet.');
  }
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new ErroPagamento('SERVIDOR', dados.erro || 'O servidor de pagamentos recusou a operação.');
  return dados;
}

async function processarPagamentoReal({ compra, metodo }) {
  // Cupom de 100%: não há o que cobrar; o servidor confere e credita.
  if (Number(compra.valor) === 0) {
    await chamarServidor('/compra/gratuita', { compraId: compra.id });
    return { aguardando: true };
  }

  if (metodo === 'mercadopago') {
    // Checkout Pro: o servidor cria a preferência (com o preço do catálogo e
    // o cupom conferidos lá) e devolve o endereço da tela do Mercado Pago.
    const { initPoint } = await chamarServidor('/mercadopago/preference', { compraId: compra.id });
    if (!initPoint) throw new ErroPagamento('MP_FALHOU', 'Não foi possível abrir o Mercado Pago.');
    location.href = initPoint; // o aluno volta pela back_url (checkout.html?compra=...)
    return new Promise(() => {});
  }

  if (metodo === 'paypal') {
    throw new ErroPagamento('PAYPAL_SDK', 'O PayPal é pago pelos botões do próprio PayPal, logo abaixo.');
  }

  throw new ErroPagamento('METODO_INVALIDO', 'Método de pagamento indisponível.');
}

/* --------------------------------------------------------------------------
   PayPal (produção) — botões do SDK oficial
   -------------------------------------------------------------------------- */

let promessaPaypal = null;

function carregarSdkPaypal() {
  if (window.paypal?.Buttons) return Promise.resolve(window.paypal);
  if (promessaPaypal) return promessaPaypal;
  promessaPaypal = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    // disable-funding=card: cartão é sempre pelo Mercado Pago (sem sobreposição).
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(CONFIG.pagamentos.paypalClientId)}`
      + '&currency=BRL&intent=capture&disable-funding=card,credit';
    s.onload = () => resolve(window.paypal);
    s.onerror = () => { promessaPaypal = null; reject(new ErroPagamento('PAYPAL', 'Não foi possível carregar o PayPal.')); };
    document.head.append(s);
  });
  return promessaPaypal;
}

/**
 * Desenha os botões do PayPal em `container`. `obterCompra` cria (ou
 * devolve) a compra pendente; `aoAprovar` roda depois da captura.
 */
export async function montarBotoesPaypal(container, { obterCompra, aoAprovar, aoErro }) {
  const paypal = await carregarSdkPaypal();
  container.innerHTML = '';
  let compraAtual = null;
  await paypal.Buttons({
    style: { layout: 'vertical', color: 'gold', shape: 'rect', label: 'paypal' },
    createOrder: async () => {
      compraAtual = await obterCompra('paypal');
      const { id } = await chamarServidor('/paypal/ordem', { compraId: compraAtual.id });
      return id;
    },
    onApprove: async ({ orderID }) => {
      await chamarServidor('/paypal/capturar', { orderId: orderID });
      await aoAprovar(compraAtual);
    },
    onError: (err) => aoErro?.(err),
  }).render(container);
}
