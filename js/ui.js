/**
 * ui.js — helpers de DOM, formatação, toasts, modais e partes compartilhadas
 * do layout (cabeçalho e rodapé). Sem dependências externas.
 */

import { ESCOLA } from './config.js';
import { icone, iconeEl, temIcone, hidratarIcones } from './icones.js';
import {
  t, seletorIdiomaHTML, ligarSeletorIdioma, aplicarTraducoes, formatoDatas, localeDatas, idiomaAtual,
} from './i18n.js';

export { icone, iconeEl, hidratarIcones };

/* --------------------------------------------------------------------------
   Seleção e criação de elementos
   -------------------------------------------------------------------------- */

export const qs = (sel, raiz = document) => raiz.querySelector(sel);
export const qsa = (sel, raiz = document) => Array.from(raiz.querySelectorAll(sel));

/**
 * Cria um elemento. `attrs.text` define textContent (seguro contra HTML),
 * `attrs.html` define innerHTML (use só com conteúdo próprio, nunca com
 * entrada do usuário). Chaves iniciadas por `on` viram listeners.
 */
export function el(tag, attrs = {}, filhos = []) {
  const node = document.createElement(tag);
  for (const [chave, valor] of Object.entries(attrs)) {
    if (valor === null || valor === undefined || valor === false) continue;
    if (chave === 'text') node.textContent = valor;
    else if (chave === 'html') node.innerHTML = valor;
    else if (chave === 'class') node.className = valor;
    else if (chave === 'dataset') Object.assign(node.dataset, valor);
    else if (chave.startsWith('on') && typeof valor === 'function') {
      node.addEventListener(chave.slice(2).toLowerCase(), valor);
    } else node.setAttribute(chave, valor);
  }
  for (const filho of [].concat(filhos)) {
    if (filho === null || filho === undefined || filho === false) continue;
    node.append(filho instanceof Node ? filho : document.createTextNode(String(filho)));
  }
  return node;
}

/** Escapa texto para interpolação segura em template strings de HTML. */
export function escapar(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* --------------------------------------------------------------------------
   Formatação
   -------------------------------------------------------------------------- */

const fmtMoeda = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

export const formatarBRL = (valor) => fmtMoeda.format(Number(valor) || 0);

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const MESES_CURTO = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun',
  'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira',
  'quinta-feira', 'sexta-feira', 'sábado'];
const SEMANA_CURTO = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

export { MESES, MESES_CURTO, SEMANA, SEMANA_CURTO };

/**
 * Converte 'YYYY-MM-DD' em Date LOCAL (meia-noite).
 * Usar `new Date('2026-03-24')` interpretaria como UTC e poderia voltar um dia
 * dependendo do fuso — por isso a construção manual.
 */
export function dataDeISO(iso) {
  const [ano, mes, dia] = String(iso).split('-').map(Number);
  return new Date(ano, mes - 1, dia);
}

/** Converte um Date para 'YYYY-MM-DD' no fuso local. */
export function isoDeData(data) {
  const ano = data.getFullYear();
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

/** 'YYYY-MM-DD' de hoje. */
export const hojeISO = () => isoDeData(new Date());

/**
 * 24/03/2026 — padrão brasileiro em todo o site; 03/24/2026 só para o
 * visitante americano lendo em inglês (veja formatoDatas em i18n.js).
 * `br: true` força dia/mês/ano (documentos oficiais, como o PDF).
 */
export function formatarData(iso, { br = false } = {}) {
  if (!iso) return '';
  const d = dataDeISO(String(iso).slice(0, 10));
  if (Number.isNaN(d.getTime())) return String(iso);
  const dia = String(d.getDate()).padStart(2, '0');
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  return !br && formatoDatas() === 'mdy' ? `${mes}/${dia}/${d.getFullYear()}` : `${dia}/${mes}/${d.getFullYear()}`;
}

/** terça-feira, 24 de março (no idioma do visitante; equipe sempre em português) */
export function formatarDataExtenso(iso, comAno = false) {
  const d = dataDeISO(iso);
  const locale = localeDatas();
  if (locale !== 'pt-BR') {
    return new Intl.DateTimeFormat(locale, {
      weekday: 'long', day: 'numeric', month: 'long', ...(comAno ? { year: 'numeric' } : {}),
    }).format(d);
  }
  const base = `${SEMANA[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]}`;
  return comAno ? `${base} de ${d.getFullYear()}` : base;
}

/** 24 mar */
export function formatarDataCurta(iso) {
  const d = dataDeISO(iso);
  const locale = localeDatas();
  if (locale !== 'pt-BR') return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(d);
  return `${d.getDate()} ${MESES_CURTO[d.getMonth()]}`;
}

/* --------------------------------------------------------------------------
   Campos de data (dd/mm/aaaa)
   --------------------------------------------------------------------------
   O <input type="date"> nativo mostra a data no formato do navegador (um
   Chrome em inglês exibe mm/dd/yyyy). Para manter dia/mês/ano, todo campo
   de data vira um campo de texto com máscara. O `.value` continua lendo e
   gravando 'YYYY-MM-DD', então o resto do código não muda.
   -------------------------------------------------------------------------- */

const VALOR_NATIVO = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

/** 'dd/mm/aaaa' (ou 'mm/dd/aaaa') -> 'YYYY-MM-DD', ou null se incompleto/inválido. */
export function isoDeTextoData(texto, formato = formatoDatas()) {
  const m = String(texto || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const [dia, mes] = formato === 'mdy' ? [Number(m[2]), Number(m[1])] : [Number(m[1]), Number(m[2])];
  const ano = Number(m[3]);
  const d = new Date(ano, mes - 1, dia);
  if (ano < 1900 || d.getFullYear() !== ano || d.getMonth() !== mes - 1 || d.getDate() !== dia) return null;
  return isoDeData(d);
}

function mascaraData(texto) {
  const dig = String(texto).replace(/\D/g, '').slice(0, 8);
  if (dig.length <= 2) return dig;
  if (dig.length <= 4) return `${dig.slice(0, 2)}/${dig.slice(2)}`;
  return `${dig.slice(0, 2)}/${dig.slice(2, 4)}/${dig.slice(4)}`;
}

export function melhorarCampoData(input) {
  if (!input || input.dataset.campoData) return;
  const inicial = VALOR_NATIVO.get.call(input);
  const formato = formatoDatas();
  input.type = 'text';
  input.dataset.campoData = formato;
  input.inputMode = 'numeric';
  input.maxLength = 10;
  input.autocomplete = input.getAttribute('autocomplete') || 'off';
  if (!input.placeholder) {
    input.placeholder = formato === 'mdy' ? 'mm/dd/yyyy'
      : (localeDatas() === 'pt-BR' ? 'dd/mm/aaaa' : ({ en: 'dd/mm/yyyy', es: 'dd/mm/aaaa' }[idiomaAtual()] || 'dd/mm/aaaa'));
  }

  const lerTexto = () => VALOR_NATIVO.get.call(input);
  const gravarTexto = (v) => VALOR_NATIVO.set.call(input, v);
  Object.defineProperty(input, 'value', {
    configurable: true,
    get: () => isoDeTextoData(lerTexto(), formato) || '',
    set: (v) => {
      const s = String(v ?? '');
      gravarTexto(/^\d{4}-\d{2}-\d{2}/.test(s) ? formatarData(s.slice(0, 10)) : mascaraData(s));
    },
  });
  input.value = inicial;

  input.addEventListener('input', () => {
    gravarTexto(mascaraData(lerTexto()));
    input.setCustomValidity('');
  });
  input.addEventListener('blur', () => {
    const texto = lerTexto();
    const invalida = !!texto && !isoDeTextoData(texto, formato);
    input.setCustomValidity(invalida ? t('comum.dataInvalida', { formato: input.placeholder }) : '');
    if (invalida) toast(t('comum.dataInvalida', { formato: input.placeholder }), 'aviso', 5000);
  });
}

/** Converte os campos de data dentro de `raiz`. */
export function melhorarCamposData(raiz = document) {
  raiz.querySelectorAll?.('input[type="date"]').forEach(melhorarCampoData);
}

// Campos criados depois (formulários montados por JavaScript) também.
if (typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
  const iniciarObservador = () => {
    melhorarCamposData(document);
    new MutationObserver((mudancas) => {
      for (const m of mudancas) {
        m.addedNodes.forEach((n) => {
          if (n.nodeType !== 1) return;
          if (n.matches?.('input[type="date"]')) melhorarCampoData(n);
          else melhorarCamposData(n);
        });
      }
    }).observe(document.documentElement, { childList: true, subtree: true });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciarObservador);
  else iniciarObservador();
}

/** Soma a duração ao horário: ('08:00', 90) -> '09:30'. */
export function horarioFim(horario, duracaoMin) {
  const [h, m] = horario.split(':').map(Number);
  const total = h * 60 + m + Number(duracaoMin || 0);
  const hh = String(Math.floor(total / 60) % 24).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** '08:00 – 09:30h' */
export function faixaHorario(horario, duracaoMin) {
  return `${horario} – ${horarioFim(horario, duracaoMin)}h`;
}

/** Date combinando 'YYYY-MM-DD' + 'HH:MM' no fuso local. */
export function dataHoraDe(iso, horario) {
  const d = dataDeISO(iso);
  const [h, m] = String(horario).split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d;
}

/** Iniciais para o avatar: 'Ricardo Silva' -> 'RS'. */
export function iniciais(nome) {
  const partes = String(nome || '?').trim().split(/\s+/);
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

/**
 * Avatar do usuário: a foto do perfil, se houver; senão as iniciais.
 * `classeExtra` ajusta o tamanho (ex.: 'avatar-g').
 */
export function avatarHTML(usuario, classeExtra = '') {
  const nome = usuario?.nome || '?';
  if (usuario?.fotoUrl) {
    return `<span class="avatar com-foto ${classeExtra}"><img src="${escapar(usuario.fotoUrl)}" alt="" loading="lazy"></span>`;
  }
  return `<span class="avatar ${classeExtra}">${escapar(iniciais(nome))}</span>`;
}

export function avatarEl(usuario, classeExtra = '') {
  const tpl = document.createElement('template');
  tpl.innerHTML = avatarHTML(usuario, classeExtra).trim();
  return tpl.content.firstElementChild;
}

/** Primeiro nome. */
export const primeiroNome = (nome) => String(nome || '').trim().split(/\s+/)[0] || '';

/** "há 2 dias" / "em 3 horas" */
export function tempoRelativo(iso) {
  const alvo = new Date(iso).getTime();
  if (Number.isNaN(alvo)) return '';
  const diffMs = alvo - Date.now();
  const abs = Math.abs(diffMs);
  const min = Math.round(abs / 60000);
  const passado = diffMs < 0;
  const frase = (n, unidade) => {
    const plural = n === 1 ? unidade : `${unidade}s`;
    return passado ? `há ${n} ${plural}` : `em ${n} ${plural}`;
  };
  if (min < 1) return 'agora';
  if (min < 60) return frase(min, 'minuto');
  const horas = Math.round(min / 60);
  if (horas < 24) return frase(horas, 'hora');
  const dias = Math.round(horas / 24);
  if (dias < 30) return frase(dias, 'dia');
  const meses = Math.round(dias / 30);
  const unidade = meses === 1 ? 'mês' : 'meses';
  return passado ? `há ${meses} ${unidade}` : `em ${meses} ${unidade}`;
}

/** Máscara de telefone brasileiro. */
export function mascaraTelefone(valor) {
  const d = String(valor).replace(/\D/g, '').slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/* --------------------------------------------------------------------------
   Identificadores
   -------------------------------------------------------------------------- */

export function gerarId(prefixo = 'id') {
  const aleatorio = crypto.getRandomValues(new Uint32Array(2));
  return `${prefixo}-${Date.now().toString(36)}-${aleatorio[0].toString(36)}${aleatorio[1].toString(36)}`;
}

export const agoraISO = () => new Date().toISOString();

/* --------------------------------------------------------------------------
   Toasts
   -------------------------------------------------------------------------- */

function containerToasts() {
  let cont = qs('#toasts');
  if (!cont) {
    cont = el('div', { id: 'toasts', 'aria-live': 'polite', 'aria-atomic': 'false' });
    document.body.append(cont);
  }
  return cont;
}

/** tipo: 'info' | 'sucesso' | 'erro' | 'aviso' */
export function toast(mensagem, tipo = 'info', duracaoMs = 3800) {
  const icones = { sucesso: 'check', erro: 'fechar', aviso: 'alerta', info: 'info' };
  const node = el('div', { class: `toast toast-${tipo}`, role: 'status' }, [
    el('strong', {}, [iconeEl(icones[tipo] || 'info')]),
    el('span', { class: 'cresce', text: mensagem }),
  ]);
  containerToasts().append(node);
  setTimeout(() => {
    node.classList.add('saindo');
    node.addEventListener('animationend', () => node.remove(), { once: true });
  }, duracaoMs);
  return node;
}

/* --------------------------------------------------------------------------
   Modais
   -------------------------------------------------------------------------- */

/**
 * Abre um modal. `corpo` pode ser string (HTML confiável) ou Node.
 * `botoes` é uma lista de { texto, classe, valor, autoFechar }.
 * Retorna { fundo, fechar, aoFechar(cb) }.
 */
export function abrirModal({ titulo, corpo, botoes = [], largo = false, classe = '', fecharFora = true }) {
  const fundo = el('div', { class: 'modal-fundo', role: 'dialog', 'aria-modal': 'true' });
  const caixa = el('div', { class: `modal ${largo ? 'largo' : ''} ${classe}` });

  let resolverFechamento;
  const promessa = new Promise((res) => { resolverFechamento = res; });

  const fechar = (valor = null) => {
    if (!fundo.isConnected) return;
    fundo.remove();
    document.body.style.overflow = '';
    document.removeEventListener('keydown', aoTeclar);
    resolverFechamento(valor);
  };

  const aoTeclar = (ev) => { if (ev.key === 'Escape') fechar(null); };

  if (titulo) {
    caixa.append(el('div', { class: 'modal-cabecalho' }, [
      el('h3', { text: titulo }),
      el('button', { class: 'modal-fechar', 'aria-label': 'Fechar', onclick: () => fechar(null), html: '&times;' }),
    ]));
  }

  const corpoNode = el('div', { class: 'modal-corpo' });
  if (typeof corpo === 'string') corpoNode.innerHTML = corpo;
  else if (corpo) corpoNode.append(corpo);
  caixa.append(corpoNode);

  if (botoes.length) {
    const rodape = el('div', { class: 'modal-rodape' });
    for (const b of botoes) {
      rodape.append(el('button', {
        class: `btn ${b.classe || 'btn-claro'}`,
        text: b.texto,
        onclick: () => {
          if (b.onClick) b.onClick(fechar);
          if (b.autoFechar !== false) fechar(b.valor ?? true);
        },
      }));
    }
    caixa.append(rodape);
  }

  fundo.append(caixa);
  if (fecharFora) {
    fundo.addEventListener('click', (ev) => { if (ev.target === fundo) fechar(null); });
  }
  document.addEventListener('keydown', aoTeclar);
  document.body.append(fundo);
  document.body.style.overflow = 'hidden';

  // Foco no primeiro elemento interativo, para acessibilidade de teclado.
  const focavel = caixa.querySelector('input, select, textarea, button:not(.modal-fechar)');
  if (focavel) focavel.focus();

  return { fundo, caixa, corpo: corpoNode, fechar, promessa };
}

/** Confirmação simples. Resolve para true/false. */
export async function confirmar({ titulo = 'Confirmar', mensagem, textoOk = 'Confirmar', textoCancelar = 'Cancelar', perigo = false }) {
  const { promessa } = abrirModal({
    titulo,
    corpo: `<p>${escapar(mensagem)}</p>`,
    botoes: [
      { texto: textoCancelar, classe: 'btn-claro', valor: false },
      { texto: textoOk, classe: perigo ? 'btn-perigo' : 'btn-primario', valor: true },
    ],
  });
  return (await promessa) === true;
}

/* --------------------------------------------------------------------------
   Estados de carregamento
   -------------------------------------------------------------------------- */

/** Coloca um botão em estado "carregando" e devolve a função que restaura. */
export function botaoCarregando(btn, texto = 'Aguarde...') {
  const original = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '';
  btn.append(el('span', { class: 'spinner' }), document.createTextNode(texto));
  return () => {
    btn.disabled = false;
    btn.innerHTML = original;
  };
}

/** Bloco de estado vazio. `nomeIcone` é um nome de js/icones.js. */
export function vazio(mensagem, nomeIcone = 'onda', acao = null) {
  const node = el('div', { class: 'vazio' }, [
    el('span', { class: 'vazio-icone' }, [temIcone(nomeIcone) ? iconeEl(nomeIcone) : nomeIcone]),
    el('p', { text: mensagem }),
  ]);
  if (acao) {
    node.append(el('a', { class: 'btn btn-primario btn-peq mt-16', href: acao.href, text: acao.texto }));
  }
  return node;
}

/* --------------------------------------------------------------------------
   Cabeçalho e rodapé compartilhados
   -------------------------------------------------------------------------- */

const LOGO = 'logomenor-barrafloripa.png';

export function marcaHTML(comLink = true) {
  const interno = `
    <img src="${LOGO}" alt="Logo ${ESCOLA.nome}" width="42" height="42">
    <span class="marca-texto">
      <span class="marca-nome">${ESCOLA.nome}</span>
      <span class="marca-sub">${ESCOLA.subtitulo}</span>
    </span>`;
  return comLink
    ? `<a href="index.html" class="marca">${interno}</a>`
    : `<div class="marca">${interno}</div>`;
}

/** Cabeçalho público (landing, login). `usuario` pode ser null. */
export function montarTopoPublico(usuario = null) {
  const alvo = qs('#topo');
  if (!alvo) return;

  const linkPainel = usuario
    ? (usuario.papel === 'aluno' ? 'dashboard.html'
      : usuario.papel === 'admin' ? 'admin.html' : 'professor.html')
    : null;

  alvo.innerHTML = `
    <div class="container topo-inner">
      ${marcaHTML()}
      <nav class="nav-publica" aria-label="Navegação principal">
        <a href="index.html#sobre">${t('nav.sobre')}</a>
        <a href="index.html#aulas">${t('nav.aulas')}</a>
        <a href="index.html#politica">${t('nav.politica')}</a>
        <a href="index.html#produtos">${t('nav.produtos')}</a>
      </nav>
      <div class="topo-acoes">
        ${seletorIdiomaHTML('topo-idioma')}
        ${usuario
          ? `<a href="${linkPainel}" class="btn btn-primario btn-peq">${t('nav.minhaArea')}</a>`
          : `<a href="login.html" class="btn btn-secundario btn-peq">${t('nav.entrar')}</a>
             <a href="reservar.html" class="btn btn-primario btn-peq">${t('nav.agendar')}</a>`}
        <button class="btn-menu" id="btn-menu" aria-label="Abrir menu" aria-expanded="false">
          <span></span><span></span><span></span>
        </button>
      </div>
    </div>
    <div class="menu-mobile" id="menu-mobile">
      <a href="index.html#sobre">${t('nav.sobre')}</a>
      <a href="index.html#aulas">${t('nav.aulas')}</a>
      <a href="index.html#politica">${t('nav.politica')}</a>
      <a href="index.html#produtos">${t('nav.produtos')}</a>
      <a href="index.html#local">${t('nav.ondeFica')}</a>
      <a href="index.html#depoimentos">${t('nav.depoimentos')}</a>
      ${seletorIdiomaHTML('menu-idioma')}
      ${usuario
        ? `<a href="${linkPainel}" class="btn btn-primario">${t('nav.minhaArea')}</a>`
        : `<a href="login.html" class="btn btn-secundario">${t('nav.entrar')}</a>
           <a href="reservar.html" class="btn btn-primario">${t('nav.agendar')}</a>`}
    </div>`;

  const btn = qs('#btn-menu', alvo);
  const menu = qs('#menu-mobile', alvo);
  btn?.addEventListener('click', () => {
    const aberto = menu.classList.toggle('aberto');
    btn.setAttribute('aria-expanded', String(aberto));
  });

  // Trocar o idioma redesenha topo e rodapé; o resto da página se traduz
  // pelos atributos data-i18n (aplicarTraducoes).
  ligarSeletorIdioma(alvo, () => {
    montarTopoPublico(usuario);
    if (qs('#rodape')?.innerHTML) montarRodape();
  });
}

/** Rodapé público. */
/** Logo do WhatsApp (glifo oficial, preenchido). */
export const LOGO_WHATSAPP = '<svg class="logo-whatsapp" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.17.2-.35.22-.64.08-.3-.15-1.26-.47-2.39-1.48-.88-.79-1.48-1.76-1.65-2.06-.17-.3-.02-.46.13-.6.13-.14.3-.35.44-.52.15-.18.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.61-.92-2.2-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.79.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.07c.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.7.62.71.23 1.36.2 1.87.12.57-.08 1.76-.72 2-1.41.25-.7.25-1.29.18-1.41-.08-.13-.28-.2-.57-.35Zm-5.42 7.4h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.86 9.86 0 0 1-1.51-5.26c0-5.45 4.44-9.88 9.89-9.88 2.64 0 5.12 1.03 6.99 2.9a9.82 9.82 0 0 1 2.89 6.99c0 5.45-4.44 9.88-9.88 9.88Zm8.41-18.3A11.82 11.82 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.89c0 2.1.55 4.14 1.59 5.95L.06 24l6.3-1.65a11.88 11.88 0 0 0 5.68 1.45h.01c6.55 0 11.89-5.34 11.89-11.9 0-3.17-1.24-6.16-3.48-8.41Z"/></svg>';

/** Link do WhatsApp da escola com a mensagem inicial no idioma do visitante. */
export function linkWhatsappEscola(chaveMensagem = 'whats.mensagem') {
  return `https://wa.me/${ESCOLA.whatsapp}?text=${encodeURIComponent(t(chaveMensagem))}`;
}

/** Botão flutuante "Dúvidas? Fale no WhatsApp" (página inicial). */
export function montarBotaoWhatsapp() {
  let botao = qs('#whats-flutuante');
  if (!botao) {
    botao = el('a', { id: 'whats-flutuante', class: 'whats-flutuante', target: '_blank', rel: 'noopener' });
    document.body.append(botao);
  }
  botao.href = linkWhatsappEscola();
  botao.setAttribute('aria-label', t('whats.flutuanteAria'));
  botao.innerHTML = `${LOGO_WHATSAPP}<span class="whats-flutuante-texto">${escapar(t('whats.flutuante'))}</span>`;
}

export function montarRodape() {
  const alvo = qs('#rodape');
  if (!alvo) return;
  alvo.className = 'rodape';
  alvo.innerHTML = `
    <div class="container">
      <div class="rodape-grade">
        <div>
          ${marcaHTML()}
          <p class="mt-16 texto-peq">${t('rodape.texto', { ano: ESCOLA.desde })}</p>
        </div>
        <div>
          <h4>${t('rodape.navegacao')}</h4>
          <ul>
            <li><a href="index.html#sobre">${t('rodape.sobre')}</a></li>
            <li><a href="index.html#aulas">${t('rodape.aulas')}</a></li>
            <li><a href="reservar.html">${t('nav.agendar')}</a></li>
            <li><a href="termos.html">${t('rodape.termos')}</a></li>
            <li><a href="termos.html#cancelamento">${t('rodape.cancelamento')}</a></li>
            <li><a href="login.html">${t('rodape.areaAluno')}</a></li>
            <li><a href="login.html?perfil=professor">${t('rodape.areaProfessor')}</a></li>
          </ul>
        </div>
        <div>
          <h4>${t('rodape.contato')}</h4>
          <a class="btn-whatsapp-rodape" href="${linkWhatsappEscola()}" target="_blank" rel="noopener">
            ${LOGO_WHATSAPP}<span>${escapar(t('whats.rodape'))}</span>
          </a>
          <ul>
            <li>${ESCOLA.endereco}</li>
            <li><a href="https://wa.me/${ESCOLA.whatsapp}" target="_blank" rel="noopener">WhatsApp ${ESCOLA.telefone}</a></li>
            <li><a href="mailto:${ESCOLA.email}">${ESCOLA.email}</a></li>
            <li><a href="https://instagram.com/${ESCOLA.instagram}" target="_blank" rel="noopener">@${ESCOLA.instagram}</a></li>
          </ul>
        </div>
      </div>
      <div class="rodape-fim">
        <span>© ${new Date().getFullYear()} ${ESCOLA.nome} Surf School. ${t('rodape.direitos')}</span>
        <span>${t('rodape.resumo')}</span>
      </div>
    </div>`;
}

/**
 * Cabeçalho + navegação dos painéis autenticados.
 * `paginaAtual` marca o item ativo: 'inicio' | 'agendar' | 'creditos' |
 * 'historico' | 'planos' | 'turmas' | 'admin'.
 */
/** Guarda o idioma escolhido no perfil (e-mails e professor passam a saber) e redesenha. */
async function salvarIdiomaDoAluno(idioma) {
  try {
    const { atualizarMeuPerfil } = await import('./auth.js');
    await atualizarMeuPerfil({ idioma });
  } catch (err) {
    console.warn('[ui] não foi possível salvar o idioma no perfil:', err);
  }
  location.reload();
}

export function montarShellPainel({ usuario, paginaAtual, aoSair, chipCreditos = false }) {
  const topo = qs('#painel-topo');
  if (topo) {
    topo.className = 'painel-topo';
    topo.innerHTML = `
      <div class="painel-topo-inner">
        ${marcaHTML()}
        <div class="topo-acoes">
          ${chipCreditos ? `
            <a href="creditos.html" class="chip-creditos" id="chip-creditos" title="Seus créditos disponíveis">
              ${icone('creditos')}<span id="chip-creditos-valor">—</span><span class="chip-rotulo"> créditos</span>
            </a>` : ''}
          <button class="usuario-chip" id="btn-usuario" aria-label="Menu do usuário">
            <span class="nome">${escapar(primeiroNome(usuario.nome))}</span>
            ${avatarHTML(usuario)}
          </button>
        </div>
      </div>`;

    qs('#btn-usuario', topo)?.addEventListener('click', () => {
      const papelTexto = { aluno: 'Aluno', professor: 'Professor', admin: 'Administrador' }[usuario.papel];
      const modal = abrirModal({
        titulo: 'Minha conta',
        corpo: `
          <div class="flex itens-centro gap-12 mb-16">
            ${avatarHTML(usuario, 'avatar-g')}
            <div>
              <div class="negrito">${escapar(usuario.nome)}</div>
              <div class="texto-peq texto-cinza">${escapar(usuario.email)}</div>
              <span class="badge badge-laranja mt-8">${papelTexto}</span>
            </div>
          </div>
          ${usuario.papel === 'aluno' ? `<div class="idioma-modal"><span class="texto-peq texto-cinza">Idioma / Language</span>${seletorIdiomaHTML('')}</div>` : ''}`,
        botoes: [
          { texto: 'Meu perfil', classe: 'btn-claro', onClick: () => { location.href = 'perfil.html'; } },
          // No celular a barra inferior não comporta o atalho do tutorial;
          // por isso ele também fica aqui, no modal da conta.
          ...(usuario.papel === 'aluno'
            ? [{
              texto: 'Como agendar',
              classe: 'btn-claro',
              onClick: () => { location.href = 'dashboard.html?tutorial=1'; },
            }]
            : []),
          { texto: 'Sair', classe: 'btn-perigo', onClick: () => aoSair?.() },
        ],
      });
      // No celular o seletor de idioma do topo fica escondido: ele mora aqui.
      if (usuario.papel === 'aluno') ligarSeletorIdioma(modal.corpo, salvarIdiomaDoAluno);
    });
  }

  // `curto` é o rótulo da barra inferior do celular, onde cabe uma palavra.
  const itensPorPapel = {
    aluno: [
      { id: 'inicio', href: 'dashboard.html', icone: 'inicio', texto: t('menu.inicio') },
      { id: 'agendar', href: 'agendar.html', icone: 'agenda', texto: t('menu.agendar'), curto: t('menu.agendarCurto') },
      { id: 'creditos', href: 'creditos.html', icone: 'creditos', texto: t('menu.creditos'), curto: t('menu.creditosCurto') },
      { id: 'historico', href: 'historico.html', icone: 'historico', texto: t('menu.historico') },
      { id: 'mensagens', href: 'mensagens.html', icone: 'mensagens', texto: t('menu.mensagens') },
      { separador: true },
      { id: 'planos', href: 'checkout.html', icone: 'planos', texto: t('menu.planos') },
      { id: 'saude', href: 'saude.html', icone: 'saude', texto: t('menu.saude') },
      { id: 'perfil', href: 'perfil.html', icone: 'perfil', texto: t('menu.perfil'), curto: t('menu.perfilCurto') },
      { id: 'termos', href: 'termos.html', icone: 'lista', texto: t('menu.termos') },
      { id: 'tutorial', href: 'dashboard.html?tutorial=1', icone: 'ajuda', texto: t('menu.tutorial') },
    ],
    professor: [
      { id: 'turmas', href: 'professor.html#turmas', icone: 'prancha', texto: 'Minhas turmas', curto: 'Turmas' },
      { id: 'saldo', href: 'professor.html#saldo', icone: 'moeda', texto: 'Meu saldo', curto: 'Saldo' },
      { id: 'declaracoes', href: 'professor.html#declaracoes', icone: 'saude', texto: 'Declarações de saúde', curto: 'Saúde' },
      { id: 'disponibilidade', href: 'professor.html#disponibilidade', icone: 'agenda', texto: 'Disponibilidade', curto: 'Horários' },
      { id: 'mensagens', href: 'professor.html#mensagens', icone: 'mensagens', texto: 'Mensagens' },
      { separador: true },
      { id: 'perfil', href: 'perfil.html', icone: 'perfil', texto: 'Meu perfil', curto: 'Perfil' },
    ],
    admin: [
      { id: 'turmas', href: 'professor.html#turmas', icone: 'prancha', texto: 'Turmas' },
      { id: 'saldo', href: 'professor.html#saldo', icone: 'moeda', texto: 'Saldo dos professores', curto: 'Saldo' },
      { id: 'declaracoes', href: 'professor.html#declaracoes', icone: 'saude', texto: 'Declarações de saúde', curto: 'Saúde' },
      { id: 'admin', href: 'admin.html', icone: 'ajustes', texto: 'Administração', curto: 'Admin' },
      { id: 'disponibilidade', href: 'professor.html#disponibilidade', icone: 'agenda', texto: 'Disponibilidade', curto: 'Horários' },
      { id: 'mensagens', href: 'professor.html#mensagens', icone: 'mensagens', texto: 'Mensagens' },
      { separador: true },
      { id: 'perfil', href: 'perfil.html', icone: 'perfil', texto: 'Meu perfil', curto: 'Perfil' },
    ],
  };

  const itens = itensPorPapel[usuario.papel] || [];
  const lateral = qs('#barra-lateral');
  if (lateral) {
    lateral.className = 'barra-lateral';
    lateral.innerHTML = itens.map((item) => item.separador
      ? '<div class="separador"></div>'
      : `<a href="${item.href}" class="${item.id === paginaAtual ? 'ativo' : ''}" data-item="${item.id}">
           ${icone(item.icone)}<span>${item.texto}</span>
         </a>`).join('')
      + `<div class="empurra"></div>
         <button id="btn-sair-lateral">${icone('sair')}<span>Sair</span></button>`;
    qs('#btn-sair-lateral', lateral)?.addEventListener('click', () => aoSair?.());
  }

  const inferior = qs('#nav-inferior');
  if (inferior) {
    inferior.className = 'nav-inferior';
    inferior.innerHTML = itens.filter((i) => !i.separador).slice(0, 5).map((item) => `
      <a href="${item.href}" class="${item.id === paginaAtual ? 'ativo' : ''}" data-item="${item.id}">
        ${icone(item.icone)}<span>${item.curto || item.texto}</span>
      </a>`).join('');
  }

  // Seletor de idioma no topo do aluno (estrangeiros usam o painel também).
  if (usuario.papel === 'aluno' && topo) {
    qs('.topo-acoes', topo)?.insertAdjacentHTML('afterbegin', seletorIdiomaHTML('topo-idioma painel'));
    ligarSeletorIdioma(topo, salvarIdiomaDoAluno);
  }

  // Ícones escritos direto no HTML da página (<span data-icone="...">).
  hidratarIcones();
  aplicarTraducoes();
  montarOndaCabecalho();

  if (usuario.papel === 'aluno') atualizarBadgeMensagens(usuario.id);
}

/**
 * Onda laranja na base do cabeçalho com foto (.painel-cabecalho). Fica em
 * SVG no próprio HTML para acompanhar a largura sem distorcer o traço.
 */
export function montarOndaCabecalho() {
  qsa('.painel-cabecalho').forEach((cab) => {
    if (qs('.onda-cabecalho', cab)) return;
    cab.insertAdjacentHTML('beforeend', `
    <svg class="onda-cabecalho" viewBox="0 0 1200 46" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path class="onda-frente" d="M0 18 C150 0 300 36 450 18 S750 0 900 18 S1100 34 1200 16 V46 H0Z"/>
      <path class="onda-fundo" d="M0 30 C200 14 350 46 550 30 S900 14 1200 30 V46 H0Z"/>
    </svg>`);
  });
}

/** Marca o item ativo do menu sem remontá-lo (abas dentro da mesma página). */
export function marcarItemMenu(id) {
  qsa('#barra-lateral a[data-item], #nav-inferior a[data-item]').forEach((a) => {
    a.classList.toggle('ativo', a.dataset.item === id);
  });
}

/**
 * Contador de mensagens não lidas no item "Mensagens" do menu do aluno.
 * Import dinâmico: as páginas públicas, que também usam este arquivo, não
 * precisam carregar o módulo de mensagens.
 */
export async function atualizarBadgeMensagens(alunoId) {
  try {
    const { contarNaoLidas } = await import('./mensagens.js');
    const total = await contarNaoLidas(alunoId);
    qsa('a[data-item="mensagens"]').forEach((a) => {
      a.querySelector('.badge-menu')?.remove();
      if (total > 0) a.append(el('span', { class: 'badge-menu', text: total > 9 ? '9+' : String(total) }));
    });
  } catch (err) {
    console.warn('[ui] não foi possível contar as mensagens não lidas:', err);
  }
}

/** Lê um parâmetro da query string. */
export function paramUrl(nome) {
  return new URLSearchParams(location.search).get(nome);
}

/** Copia texto para a área de transferência, com fallback para navegadores antigos. */
export async function copiar(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    const area = el('textarea', { style: 'position:fixed;opacity:0' });
    area.value = texto;
    document.body.append(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    area.remove();
    return ok;
  }
}

/** Pausa (usada para simular latência de rede no modo demo). */
export const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
