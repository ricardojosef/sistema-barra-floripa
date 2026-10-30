/**
 * icones.js — ícones de traço do sistema (no lugar dos emojis).
 *
 * Desenhados em grade de 24×24, traço de 1,75 e pontas arredondadas, para
 * herdarem a cor do texto (`currentColor`). Sem biblioteca externa: cada
 * ícone é só o conteúdo de um <svg>.
 *
 * Uso:
 *   icone('agenda')                 -> string <svg> (para template HTML)
 *   iconeEl('agenda')               -> elemento <svg> (para el())
 *   <span data-icone="agenda"></span> + hidratarIcones()  (HTML estático)
 */

const CAMINHOS = {
  inicio: '<path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9v11a1 1 0 0 0 1 1H10v-6h4v6h3.5a1 1 0 0 0 1-1V9"/>',
  agenda: '<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4M8 14h3"/>',
  creditos: '<path d="M2.5 9V7a2 2 0 0 1 2-2h15a2 2 0 0 1 2 2v2a3 3 0 0 0 0 6v2a2 2 0 0 1-2 2h-15a2 2 0 0 1-2-2v-2a3 3 0 0 0 0-6Z"/><path d="M14.5 5v2.5M14.5 10.75v2.5M14.5 16.5V19"/>',
  historico: '<path d="M3.5 12a8.5 8.5 0 1 0 2.5-6"/><path d="M3 4v4h4"/><path d="M12 8v4.5l3 1.8"/>',
  mensagens: '<path d="M20.5 12a8.5 8.5 0 0 1-12.4 7.55L3.5 20.5l1-4.4A8.5 8.5 0 1 1 20.5 12Z"/>',
  planos: '<rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M2.5 10h19M6.5 15h4"/>',
  ajuda: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.4c-.6.3-1 .8-1 1.5v.6"/><path d="M12 17.2h.01"/>',
  sair: '<path d="M9.5 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3.5"/><path d="M15.5 16.5 20 12l-4.5-4.5M20 12H9.5"/>',
  perfil: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  grupo: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/>',
  prancha: '<path d="M19.8 4.2c-2.6-1.3-8.1.6-11.9 5.3S3 18.6 4.4 19.6c1.4 1.3 6.5-.2 10.3-4.6s6.3-9.5 5.1-10.8Z"/><path d="M8.5 15.5 13 11"/>',
  ajustes: '<path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="17" cy="18" r="2"/>',
  local: '<path d="M12 21s-7-6.1-7-11.5a7 7 0 0 1 14 0C19 14.9 12 21 12 21Z"/><circle cx="12" cy="9.5" r="2.5"/>',
  relogio: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  onda: '<path d="M2 8c2.2 0 2.2-2 4.5-2S8.8 8 11 8s2.2-2 4.5-2S17.8 8 20 8s2-1.2 2-1.2"/><path d="M2 13c2.2 0 2.2-2 4.5-2s2.3 2 4.5 2 2.2-2 4.5-2 2.3 2 4.5 2 2-1.2 2-1.2"/><path d="M2 18c2.2 0 2.2-2 4.5-2s2.3 2 4.5 2 2.2-2 4.5-2 2.3 2 4.5 2 2-1.2 2-1.2"/>',
  alerta: '<path d="M12 3.5 2.5 20h19L12 3.5Z"/><path d="M12 10v4.5M12 17.3h.01"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.7h.01"/>',
  urgente: '<path d="M8.2 3h7.6L21 8.2v7.6L15.8 21H8.2L3 15.8V8.2Z"/><path d="M12 7.5v5.5M12 16.3h.01"/>',
  megafone: '<path d="M3.5 10v4a1 1 0 0 0 1 1H7l6 4.5V4.5L7 9H4.5a1 1 0 0 0-1 1Z"/><path d="M17 9a4 4 0 0 1 0 6M19.5 6.5a7.5 7.5 0 0 1 0 11"/>',
  carrinho: '<circle cx="9" cy="20" r="1.3"/><circle cx="18" cy="20" r="1.3"/><path d="M2.5 3.5H5l2.4 11.2a1.5 1.5 0 0 0 1.5 1.3h8.7a1.5 1.5 0 0 0 1.5-1.2L20.5 8H6"/>',
  globo: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  raio: '<path d="M13 2.5 4.5 13.5H12l-1 8 8.5-11H12l1-8Z"/>',
  recibo: '<path d="M5 3h14v18l-2.5-1.5L14 21l-2-1.5L10 21l-2.5-1.5L5 21Z"/><path d="M8.5 8h7M8.5 12h7M8.5 16h4"/>',
  lista: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
  lua: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>',
  email: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6.5 8.5 6.5 8.5-6.5"/>',
  telefone: '<path d="M5 3.5h3.5l1.8 4.5-2.3 1.5a11 11 0 0 0 6.5 6.5l1.5-2.3 4.5 1.8V19a2 2 0 0 1-2 2A17 17 0 0 1 3 5.5a2 2 0 0 1 2-2Z"/>',
  moeda: '<circle cx="12" cy="12" r="9"/><path d="M14.8 9.2c-.5-.9-1.5-1.4-2.8-1.4-1.6 0-2.8.8-2.8 2.1 0 3 5.6 1.5 5.6 4.3 0 1.3-1.2 2.1-2.8 2.1-1.4 0-2.5-.6-3-1.6M12 6v1.8M12 16.2V18"/>',
  camera: '<path d="M4 7.5h3L8.5 5h7L17 7.5h3a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8.5a1 1 0 0 1 1-1Z"/><circle cx="12" cy="13" r="3.5"/>',
  ampulheta: '<path d="M6.5 3h11M6.5 21h11"/><path d="M7.5 3v3l4.5 6 4.5-6V3M7.5 21v-3l4.5-6 4.5 6v3"/>',
  estorno: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
  teste: '<path d="M9.5 3h5M10 3v6l-5.2 9.2A1.9 1.9 0 0 0 6.4 21h11.2a1.9 1.9 0 0 0 1.6-2.8L14 9V3"/><path d="M7.5 15h9"/>',
  filtro: '<path d="M3.5 5h17l-6.5 8v6l-4 2v-8Z"/>',
  chave: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l2.5 2.5M15 8l2 2"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  fechar: '<path d="M6 6l12 12M18 6 6 18"/>',
  seta: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  mais: '<path d="M12 5v14M5 12h14"/>',
};

const ATRIBUTOS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"';

export const temIcone = (nome) => Object.prototype.hasOwnProperty.call(CAMINHOS, nome);

/** SVG em texto, para templates HTML. */
export function icone(nome, classe = 'icone') {
  const caminho = CAMINHOS[nome];
  if (!caminho) return '';
  return `<svg class="${classe}" ${ATRIBUTOS}>${caminho}</svg>`;
}

/** SVG como elemento, para montar com el(). */
export function iconeEl(nome, classe = 'icone') {
  const tpl = document.createElement('template');
  tpl.innerHTML = icone(nome, classe);
  return tpl.content.firstElementChild || document.createTextNode('');
}

/** Troca cada <span data-icone="nome"> do HTML estático pelo SVG. */
export function hidratarIcones(raiz = document) {
  raiz.querySelectorAll('[data-icone]').forEach((alvo) => {
    if (alvo.dataset.iconeOk) return;
    alvo.innerHTML = icone(alvo.dataset.icone, alvo.dataset.iconeClasse || 'icone');
    alvo.dataset.iconeOk = '1';
  });
}
