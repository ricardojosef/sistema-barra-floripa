/**
 * i18n.js — idioma do site (português, inglês, espanhol).
 *
 * Ordem de decisão:
 *   1. o idioma escolhido pelo visitante (seletor no topo), salvo no navegador;
 *   2. o idioma preferido do aluno logado (perfil `idioma`);
 *   3. o idioma do navegador (navigator.languages) — é o que reconhece o
 *      turista já no primeiro acesso;
 *   4. português.
 *
 * Uso:
 *   HTML estático:  <h1 data-i18n="hero.titulo">Texto em PT</h1>
 *                   data-i18n-html (conteúdo com tags), data-i18n-placeholder,
 *                   data-i18n-title, data-i18n-aria
 *   JavaScript:     t('reserva.passo1', { n: 3 })  -> texto com {n} trocado
 *
 * O texto em português fica no próprio HTML (funciona sem JavaScript) e
 * também no dicionário, que é a fonte usada ao voltar do inglês/espanhol.
 */

import { TEXTOS } from './i18n-textos.js';

export const IDIOMAS = [
  { id: 'pt', curto: 'PT', nome: 'Português', bandeira: '🇧🇷', html: 'pt-BR' },
  { id: 'en', curto: 'EN', nome: 'English', bandeira: '🇺🇸', html: 'en' },
  { id: 'es', curto: 'ES', nome: 'Español', bandeira: '🇪🇸', html: 'es' },
];

const CHAVE = 'bf_idioma';
const valido = (id) => IDIOMAS.some((i) => i.id === id);

function lerSalvo() {
  try { return localStorage.getItem(CHAVE); } catch { return null; }
}

/** Idioma do navegador, reduzido a pt/en/es (outros caem no inglês). */
export function idiomaDoNavegador() {
  const lista = navigator.languages?.length ? navigator.languages : [navigator.language || 'pt-BR'];
  for (const cod of lista) {
    const base = String(cod).slice(0, 2).toLowerCase();
    if (valido(base)) return base;
  }
  // Turista de outro país: inglês é a aposta mais segura.
  return 'en';
}

let atual = valido(lerSalvo()) ? lerSalvo() : idiomaDoNavegador();
const ouvintes = new Set();

export const idiomaAtual = () => atual;

/** Texto traduzido. Cai no português e, por fim, na própria chave. */
export function t(chave, vars = null) {
  const bruto = TEXTOS[atual]?.[chave] ?? TEXTOS.pt[chave] ?? chave;
  if (!vars) return bruto;
  return String(bruto).replace(/\{(\w+)\}/g, (_, nome) => (vars[nome] ?? `{${nome}}`));
}

/** Aplica as traduções aos elementos marcados com data-i18n*. */
export function aplicarTraducoes(raiz = document) {
  document.documentElement.lang = IDIOMAS.find((i) => i.id === atual)?.html || 'pt-BR';
  raiz.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  raiz.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
  raiz.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  raiz.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
  raiz.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
}

/**
 * Troca o idioma. `salvar` grava a escolha no navegador (escolha explícita
 * do visitante). Avisa os ouvintes para as telas redesenharem o que é
 * montado por JavaScript.
 */
export function definirIdioma(id, { salvar = true } = {}) {
  if (!valido(id)) return;
  const mudou = id !== atual;
  atual = id;
  if (salvar) {
    try { localStorage.setItem(CHAVE, id); } catch { /* navegação privada */ }
  }
  aplicarTraducoes();
  if (mudou) {
    ouvintes.forEach((cb) => {
      try { cb(id); } catch (err) { console.error('[i18n] ouvinte falhou:', err); }
    });
  }
}

/** Registra um callback para a troca de idioma. Devolve a função que cancela. */
export function aoTrocarIdioma(cb) {
  ouvintes.add(cb);
  return () => ouvintes.delete(cb);
}

/* --------------------------------------------------------------------------
   Formato das datas
   --------------------------------------------------------------------------
   Padrão brasileiro (dia/mês/ano) em todo o site. A exceção é o "gringo"
   que lê em inglês e é dos Estados Unidos (país do cadastro ou, antes do
   login, o idioma do navegador en-US): para ele, mês/dia/ano. Espanhol e
   inglês britânico também usam dia/mês/ano. Painéis da equipe e documentos
   oficiais (PDF) ficam sempre no padrão brasileiro.
   -------------------------------------------------------------------------- */

let paisDoUsuario = null;
// Painéis da equipe já nascem no padrão brasileiro (antes mesmo do login).
let datasSempreBR = ['professor', 'admin'].includes(document.body?.dataset.page);

/** 'dmy' (24/03/2026) ou 'mdy' (03/24/2026). */
export function formatoDatas() {
  if (datasSempreBR || atual !== 'en') return 'dmy';
  if (paisDoUsuario) return paisDoUsuario === 'US' ? 'mdy' : 'dmy';
  const nav = String(navigator.languages?.[0] || navigator.language || '');
  return /^en-US$/i.test(nav) ? 'mdy' : 'dmy';
}

/** Locale para Intl (datas por extenso), coerente com formatoDatas(). */
export function localeDatas() {
  if (datasSempreBR || atual === 'pt') return 'pt-BR';
  if (atual === 'es') return 'es-ES';
  return formatoDatas() === 'mdy' ? 'en-US' : 'en-GB';
}

/** Equipe (professor/admin): datas sempre no padrão brasileiro. */
export function fixarDatasBrasileiras() { datasSempreBR = true; }

/**
 * Usa o idioma do perfil quando o visitante ainda não escolheu nenhum
 * explicitamente neste navegador. Também guarda o país (formato das datas).
 */
export function adotarIdiomaDoUsuario(usuario) {
  if (usuario?.papel && usuario.papel !== 'aluno') datasSempreBR = true;
  if (usuario?.nacionalidade) paisDoUsuario = String(usuario.nacionalidade).toUpperCase();
  if (!usuario?.idioma || !valido(usuario.idioma)) return;
  if (valido(lerSalvo())) return;
  definirIdioma(usuario.idioma, { salvar: false });
}

/** HTML do seletor compacto (PT · EN · ES). */
export function seletorIdiomaHTML(classeExtra = '') {
  return `<div class="seletor-idioma ${classeExtra}" role="group" aria-label="Idioma / Language">
    ${IDIOMAS.map((i) => `<button type="button" data-idioma="${i.id}" class="${i.id === atual ? 'ativo' : ''}"
      aria-pressed="${i.id === atual}" title="${i.nome}">${i.curto}</button>`).join('')}
  </div>`;
}

/** Liga os botões de um seletor já inserido na página. */
export function ligarSeletorIdioma(raiz = document, aoEscolher = null) {
  raiz.querySelectorAll('.seletor-idioma button[data-idioma]').forEach((btn) => {
    btn.addEventListener('click', () => {
      definirIdioma(btn.dataset.idioma);
      document.querySelectorAll('.seletor-idioma button[data-idioma]').forEach((b) => {
        const ativo = b.dataset.idioma === atual;
        b.classList.toggle('ativo', ativo);
        b.setAttribute('aria-pressed', String(ativo));
      });
      aoEscolher?.(btn.dataset.idioma);
    });
  });
}

// Já marca o <html lang> certo assim que o módulo carrega.
document.documentElement.lang = IDIOMAS.find((i) => i.id === atual)?.html || 'pt-BR';
