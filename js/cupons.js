/**
 * cupons.js — cupons de desconto na compra de pacotes.
 *
 * Documento `cupons/{CODIGO}` (o id é o próprio código, em maiúsculas):
 *   { codigo, descricao, tipo: 'percentual'|'valor', valor, ativo,
 *     validoAte: 'YYYY-MM-DD'|null, usosMaximos: n|null, usos,
 *     pacotes: [ids] (vazio = vale para todos) }
 *
 * As regras do Firestore deixam qualquer visitante LER um cupom pelo código
 * (para validar no checkout), mas não LISTAR a coleção: ninguém descobre os
 * códigos existentes. Em produção quem aplica o desconto de verdade é o
 * servidor de pagamentos (functions/pagamentos.js), que repete esta mesma
 * validação — o valor calculado aqui é só para mostrar ao aluno.
 */

import { obter, listar, criar, atualizar, remover } from './store.js';
import { hojeISO } from './ui.js';

export class ErroCupom extends Error {
  constructor(codigo, mensagem) {
    super(mensagem);
    this.name = 'ErroCupom';
    this.codigo = codigo;
  }
}

export const normalizarCodigo = (codigo) => String(codigo || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');

/** Valor mínimo cobrado depois do desconto (o gateway não cobra R$ 0,00). */
const VALOR_MINIMO = 1;

/**
 * Calcula o desconto de um cupom sobre um pacote. Função pura, idêntica à
 * do servidor. Devolve { desconto, valorFinal, gratuito }.
 */
export function calcularDesconto(cupom, valorOriginal) {
  const original = Number(valorOriginal) || 0;
  let desconto = cupom.tipo === 'percentual'
    ? (original * Number(cupom.valor)) / 100
    : Number(cupom.valor);
  desconto = Math.max(0, Math.min(original, Math.round(desconto * 100) / 100));
  let valorFinal = Math.round((original - desconto) * 100) / 100;
  // 100% vira cortesia; acima de zero, respeita o mínimo do gateway.
  if (valorFinal > 0 && valorFinal < VALOR_MINIMO) {
    valorFinal = VALOR_MINIMO;
    desconto = original - VALOR_MINIMO;
  }
  return { desconto, valorFinal, gratuito: valorFinal === 0 };
}

/** Motivo pelo qual o cupom não vale para este pacote (null = vale). */
export function motivoInvalido(cupom, pacoteId, hoje = hojeISO()) {
  if (!cupom || cupom.ativo === false) return 'Cupom inválido ou desativado.';
  if (cupom.validoAte && cupom.validoAte < hoje) return 'Este cupom expirou.';
  if (cupom.usosMaximos && Number(cupom.usos || 0) >= Number(cupom.usosMaximos)) return 'Este cupom já atingiu o limite de usos.';
  if (Array.isArray(cupom.pacotes) && cupom.pacotes.length && !cupom.pacotes.includes(pacoteId)) {
    return 'Este cupom não vale para o plano escolhido.';
  }
  return null;
}

/** Busca e valida o cupom para o pacote. Lança ErroCupom se não valer. */
export async function validarCupom(codigo, pacote) {
  const id = normalizarCodigo(codigo);
  if (!id) throw new ErroCupom('VAZIO', 'Digite o código do cupom.');
  let cupom = null;
  try {
    cupom = await obter('cupons', id);
  } catch {
    cupom = null;
  }
  const motivo = motivoInvalido(cupom, pacote.id);
  if (motivo) throw new ErroCupom('INVALIDO', motivo);
  return { cupom, ...calcularDesconto(cupom, pacote.preco) };
}

/** Texto curto do benefício: '10% off' / 'R$ 50 off'. */
export function descreverCupom(cupom) {
  return cupom.tipo === 'percentual'
    ? `${Number(cupom.valor)}% de desconto`
    : `R$ ${Number(cupom.valor).toFixed(2).replace('.', ',')} de desconto`;
}

/* --------------------------------------------------------------------------
   Administração
   -------------------------------------------------------------------------- */

export async function listarCupons() {
  return listar('cupons', {}, { ordenarPor: 'criadoEm', direcao: 'desc' });
}

export async function criarCupom({ codigo, descricao, tipo, valor, validoAte, usosMaximos, pacotes }) {
  const id = normalizarCodigo(codigo);
  if (id.length < 3) throw new ErroCupom('CODIGO', 'O código precisa ter pelo menos 3 letras ou números.');
  if (!['percentual', 'valor'].includes(tipo)) throw new ErroCupom('TIPO', 'Escolha o tipo de desconto.');
  const numero = Number(valor);
  if (!Number.isFinite(numero) || numero <= 0) throw new ErroCupom('VALOR', 'Informe o valor do desconto.');
  if (tipo === 'percentual' && numero > 100) throw new ErroCupom('VALOR', 'O percentual vai até 100.');
  if (await obter('cupons', id)) throw new ErroCupom('EXISTE', `Já existe um cupom ${id}.`);

  return criar('cupons', {
    id,
    codigo: id,
    descricao: String(descricao || '').trim().slice(0, 120),
    tipo,
    valor: numero,
    ativo: true,
    validoAte: validoAte || null,
    usosMaximos: usosMaximos ? Number(usosMaximos) : null,
    usos: 0,
    pacotes: Array.isArray(pacotes) ? pacotes : [],
  });
}

export const alternarCupom = (id, ativo) => atualizar('cupons', id, { ativo });
export const removerCupom = (id) => remover('cupons', id);

/**
 * Conta um uso do cupom. Em produção quem conta é o servidor, ao confirmar o
 * pagamento; no modo de demonstração o próprio navegador conta.
 */
export async function registrarUsoCupom(codigo) {
  const id = normalizarCodigo(codigo);
  if (!id) return;
  try {
    const cupom = await obter('cupons', id);
    if (cupom) await atualizar('cupons', id, { usos: Number(cupom.usos || 0) + 1 });
  } catch (err) {
    console.warn('[cupons] não foi possível contar o uso do cupom:', err);
  }
}
