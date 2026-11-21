/**
 * termos.js — termos de uso e política da escola, nos três idiomas.
 * O prazo de cancelamento e a validade do questionário vêm da configuração.
 */

import { inicializarStore } from '../store.js';
import { usuarioOpcional } from '../auth.js';
import { obterConfig } from '../precos.js';
import { TERMOS } from '../termos-texto.js';
import { politicaHTML } from '../politica.js';
import { idiomaAtual, aplicarTraducoes, aoTrocarIdioma } from '../i18n.js';
import { qs, montarTopoPublico, montarRodape, montarOndaCabecalho } from '../ui.js';
import { DEFAULTS } from '../config.js';

let config = {
  horasMinimasCancelamento: DEFAULTS.horasMinimasCancelamento,
  validadeDeclaracaoMeses: DEFAULTS.validadeDeclaracaoMeses,
};

function preencher(texto) {
  return texto
    .replace(/\{horas\}/g, String(config.horasMinimasCancelamento))
    .replace(/\{meses\}/g, String(config.validadeDeclaracaoMeses));
}

function renderizar() {
  aplicarTraducoes();
  const termos = TERMOS[idiomaAtual()] || TERMOS.pt;
  qs('#termos-atualizado').textContent = termos.atualizado;
  qs('#politica-destaque').innerHTML = politicaHTML({ horas: config.horasMinimasCancelamento, link: false });
  qs('#termos-conteudo').innerHTML = termos.secoes.map((s) => `
    <section id="${s.id}">
      <h2>${s.titulo}</h2>
      ${preencher(s.html)}
    </section>`).join('');
  if (location.hash) qs(location.hash)?.scrollIntoView();
}

async function iniciar() {
  montarTopoPublico(null);
  montarRodape();
  montarOndaCabecalho();
  renderizar();
  aoTrocarIdioma(renderizar);
  try {
    await inicializarStore();
    config = await obterConfig();
    renderizar();
    const usuario = await usuarioOpcional();
    if (usuario) montarTopoPublico(usuario);
  } catch (err) {
    console.warn('[termos] usando valores padrão:', err);
  }
}

iniciar();
