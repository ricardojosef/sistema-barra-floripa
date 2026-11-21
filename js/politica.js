/**
 * politica.js — resumo das condições de cancelamento, mostrado na página
 * inicial, no fluxo de reserva e no checkout. O texto completo fica em
 * termos.html. O prazo (12h) vem da configuração da escola.
 */

import { t } from './i18n.js';
import { icone } from './icones.js';

export function politicaHTML({ horas = 12, titulo = true, link = true } = {}) {
  const itens = [
    ['relogio', t('politica.prazo', { horas })],
    ['alerta', t('politica.bloqueio', { horas })],
    ['fechar', t('politica.falta')],
    ['anexo', t('politica.justificativa')],
    ['onda', t('politica.tempo')],
    ['documento', t('politica.documento')],
  ];
  return `
    ${titulo ? `<h3 class="mb-8 com-icone">${icone('lista')}${t('politica.titulo')}</h3>` : ''}
    <ul class="lista-politica">
      ${itens.map(([ic, texto]) => `<li>${icone(ic)}<span>${texto}</span></li>`).join('')}
    </ul>
    ${link ? `<a href="termos.html" class="texto-peq negrito" target="_blank" rel="noopener">${t('politica.verTermos')} →</a>` : ''}`;
}
