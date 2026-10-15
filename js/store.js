/**
 * store.js — API única de dados.
 *
 * Todas as telas falam apenas com este módulo; ele delega para o driver
 * escolhido em CONFIG.MODO_DADOS ('local' ou 'firebase'). Os dois drivers
 * expõem exatamente a mesma interface, então trocar o modo não exige
 * mudança nenhuma nas páginas.
 *
 * Coleções: usuarios, professores, pacotes, compras, creditos, agendamentos,
 *           locais, avisos, avisosLidos, config
 */

import { CONFIG } from './config.js';

let driver = null;
let promessaInit = null;

/** Carrega e inicializa o driver configurado. Idempotente. */
export function inicializarStore() {
  if (promessaInit) return promessaInit;
  promessaInit = (async () => {
    if (CONFIG.MODO_DADOS === 'firebase') {
      const mod = await import('./store.firebase.js');
      driver = mod.criarDriver();
    } else {
      const mod = await import('./store.local.js');
      driver = mod.criarDriver();
    }
    await driver.inicializar();
    return driver;
  })();
  return promessaInit;
}

function exigirDriver() {
  if (!driver) {
    throw new Error('Store não inicializado. Chame `await inicializarStore()` antes de usar.');
  }
  return driver;
}

/**
 * Lista documentos de uma coleção.
 * `filtros` aceita duas formas:
 *   { papel: 'aluno' }                         igualdade
 *   { data: { op: '>=', valor: '2026-03-01' } } comparação
 * `opcoes`: { ordenarPor, direcao: 'asc'|'desc', limite }
 */
export const listar = (colecao, filtros = {}, opcoes = {}) =>
  exigirDriver().listar(colecao, filtros, opcoes);

export const obter = (colecao, id) => exigirDriver().obter(colecao, id);

/** Cria um documento. Se `dados.id` vier preenchido, ele é respeitado. */
export const criar = (colecao, dados) => exigirDriver().criar(colecao, dados);

export const atualizar = (colecao, id, campos) => exigirDriver().atualizar(colecao, id, campos);

export const remover = (colecao, id) => exigirDriver().remover(colecao, id);

/**
 * Executa `fn` com acesso exclusivo aos dados, evitando corridas entre
 * leitura e escrita (ex.: checar vaga no slot e só então gravar).
 * `fn` recebe um contexto com as mesmas operações acima.
 */
export const transacao = (fn) => exigirDriver().transacao(fn);

/**
 * Observa mudanças em uma coleção. Chama `cb(itens)` na hora e a cada
 * alteração. Devolve a função para cancelar a observação.
 */
export const observar = (colecao, filtros, cb, opcoes = {}) =>
  exigirDriver().observar(colecao, filtros, cb, opcoes);

/** Acesso ao driver bruto (usado por auth.js para Firebase Auth). */
export const driverAtual = () => exigirDriver();

/** Apaga tudo e re-semeia (só faz sentido no modo local). */
export const reiniciarDados = () => exigirDriver().reiniciar?.();

/* --------------------------------------------------------------------------
   Filtros — implementação compartilhada pelos drivers em memória
   -------------------------------------------------------------------------- */

/** Aplica um conjunto de filtros a um array de objetos. */
export function aplicarFiltros(itens, filtros = {}) {
  const entradas = Object.entries(filtros);
  if (!entradas.length) return itens;
  return itens.filter((item) => entradas.every(([campo, cond]) => {
    const valor = item[campo];
    if (cond !== null && typeof cond === 'object' && 'op' in cond) {
      switch (cond.op) {
        case '==': return valor === cond.valor;
        case '!=': return valor !== cond.valor;
        case '>': return valor > cond.valor;
        case '>=': return valor >= cond.valor;
        case '<': return valor < cond.valor;
        case '<=': return valor <= cond.valor;
        case 'in': return Array.isArray(cond.valor) && cond.valor.includes(valor);
        case 'not-in': return Array.isArray(cond.valor) && !cond.valor.includes(valor);
        default: return true;
      }
    }
    return valor === cond;
  }));
}

/** Ordena e limita, respeitando as mesmas opções nos dois drivers. */
export function aplicarOrdenacao(itens, { ordenarPor, direcao = 'asc', limite } = {}) {
  let saida = itens;
  if (ordenarPor) {
    saida = [...itens].sort((a, b) => {
      const va = a[ordenarPor];
      const vb = b[ordenarPor];
      if (va === vb) return 0;
      if (va === undefined || va === null) return 1;
      if (vb === undefined || vb === null) return -1;
      const cmp = va < vb ? -1 : 1;
      return direcao === 'desc' ? -cmp : cmp;
    });
  }
  return limite ? saida.slice(0, limite) : saida;
}
