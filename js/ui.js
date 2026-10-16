/**
 * ui.js — helpers de DOM, formatação, toasts, modais e partes compartilhadas
 * do layout (cabeçalho e rodapé). Sem dependências externas.
 */

import { ESCOLA } from './config.js';

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

/** 24/03/2026 */
export function formatarData(iso) {
  const d = dataDeISO(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

/** terça-feira, 24 de março */
export function formatarDataExtenso(iso, comAno = false) {
  const d = dataDeISO(iso);
  const base = `${SEMANA[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]}`;
  return comAno ? `${base} de ${d.getFullYear()}` : base;
}

/** 24 mar */
export function formatarDataCurta(iso) {
  const d = dataDeISO(iso);
  return `${d.getDate()} ${MESES_CURTO[d.getMonth()]}`;
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
  const icones = { sucesso: '✓', erro: '✕', aviso: '!', info: 'i' };
  const node = el('div', { class: `toast toast-${tipo}`, role: 'status' }, [
    el('strong', { text: icones[tipo] || 'i' }),
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

/** Bloco de estado vazio. */
export function vazio(mensagem, icone = '🌊', acao = null) {
  const node = el('div', { class: 'vazio' }, [
    el('span', { class: 'vazio-icone', text: icone }),
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
        <a href="index.html#sobre">Sobre</a>
        <a href="index.html#aulas">Aulas</a>
        <a href="index.html#produtos">Produtos</a>
      </nav>
      <div class="topo-acoes">
        ${usuario
          ? `<a href="${linkPainel}" class="btn btn-primario btn-peq">Minha Área</a>`
          : `<a href="login.html" class="btn btn-secundario btn-peq">Entrar</a>
             <a href="login.html?aba=cadastro" class="btn btn-primario btn-peq">Agendar Aula</a>`}
        <button class="btn-menu" id="btn-menu" aria-label="Abrir menu" aria-expanded="false">
          <span></span><span></span><span></span>
        </button>
      </div>
    </div>
    <div class="menu-mobile" id="menu-mobile">
      <a href="index.html#sobre">Sobre</a>
      <a href="index.html#aulas">Aulas</a>
      <a href="index.html#produtos">Produtos</a>
      <a href="index.html#local">Onde fica</a>
      <a href="index.html#depoimentos">Depoimentos</a>
      ${usuario
        ? `<a href="${linkPainel}" class="btn btn-primario">Minha Área</a>`
        : `<a href="login.html" class="btn btn-secundario">Entrar</a>
           <a href="login.html?aba=cadastro" class="btn btn-primario">Agendar Aula</a>`}
    </div>`;

  const btn = qs('#btn-menu', alvo);
  const menu = qs('#menu-mobile', alvo);
  btn?.addEventListener('click', () => {
    const aberto = menu.classList.toggle('aberto');
    btn.setAttribute('aria-expanded', String(aberto));
  });
}

/** Rodapé público. */
export function montarRodape() {
  const alvo = qs('#rodape');
  if (!alvo) return;
  alvo.className = 'rodape';
  alvo.innerHTML = `
    <div class="container">
      <div class="rodape-grade">
        <div>
          ${marcaHTML()}
          <p class="mt-16 texto-peq">
            Aprenda a surfar com segurança e técnica na melhor escola de
            Florianópolis. Transformando vidas através do surf desde
            ${ESCOLA.desde}.
          </p>
        </div>
        <div>
          <h4>Navegação</h4>
          <ul>
            <li><a href="index.html#sobre">Sobre a escola</a></li>
            <li><a href="index.html#aulas">Nossas aulas</a></li>
            <li><a href="index.html#produtos">Produtos</a></li>
            <li><a href="login.html">Área do aluno</a></li>
            <li><a href="login.html?perfil=professor">Área do professor</a></li>
          </ul>
        </div>
        <div>
          <h4>Contato</h4>
          <ul>
            <li>${ESCOLA.endereco}</li>
            <li><a href="https://wa.me/${ESCOLA.whatsapp}" target="_blank" rel="noopener">WhatsApp ${ESCOLA.telefone}</a></li>
            <li><a href="mailto:${ESCOLA.email}">${ESCOLA.email}</a></li>
            <li><a href="https://instagram.com/${ESCOLA.instagram}" target="_blank" rel="noopener">@${ESCOLA.instagram}</a></li>
          </ul>
        </div>
      </div>
      <div class="rodape-fim">
        <span>© ${new Date().getFullYear()} ${ESCOLA.nome} Surf School. Todos os direitos reservados.</span>
        <span>Aulas de 1h30 · Máx. 5 alunos por professor</span>
      </div>
    </div>`;
}

/**
 * Cabeçalho + navegação dos painéis autenticados.
 * `paginaAtual` marca o item ativo: 'inicio' | 'agendar' | 'creditos' |
 * 'historico' | 'planos' | 'turmas' | 'admin'.
 */
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
              <span>🎟️</span><span id="chip-creditos-valor">—</span> créditos
            </a>` : ''}
          <button class="usuario-chip" id="btn-usuario" aria-label="Menu do usuário">
            <span class="nome">${escapar(primeiroNome(usuario.nome))}</span>
            <span class="avatar">${escapar(iniciais(usuario.nome))}</span>
          </button>
        </div>
      </div>`;

    qs('#btn-usuario', topo)?.addEventListener('click', () => {
      const papelTexto = { aluno: 'Aluno', professor: 'Professor', admin: 'Administrador' }[usuario.papel];
      abrirModal({
        titulo: 'Minha conta',
        corpo: `
          <div class="flex itens-centro gap-12 mb-16">
            <span class="avatar" style="width:52px;height:52px;font-size:1.1rem">${escapar(iniciais(usuario.nome))}</span>
            <div>
              <div class="negrito">${escapar(usuario.nome)}</div>
              <div class="texto-peq texto-cinza">${escapar(usuario.email)}</div>
              <span class="badge badge-laranja mt-8">${papelTexto}</span>
            </div>
          </div>`,
        botoes: [
          { texto: 'Fechar', classe: 'btn-claro' },
          { texto: 'Sair', classe: 'btn-perigo', onClick: () => aoSair?.() },
        ],
      });
    });
  }

  const itensPorPapel = {
    aluno: [
      { id: 'inicio', href: 'dashboard.html', icone: '🏠', texto: 'Início' },
      { id: 'agendar', href: 'agendar.html', icone: '📅', texto: 'Agendar Aula' },
      { id: 'creditos', href: 'creditos.html', icone: '🎟️', texto: 'Meus Créditos' },
      { id: 'historico', href: 'historico.html', icone: '📋', texto: 'Histórico' },
      { separador: true },
      { id: 'planos', href: 'checkout.html', icone: '💳', texto: 'Planos e Preços' },
    ],
    professor: [
      { id: 'turmas', href: 'professor.html', icone: '🏄', texto: 'Minhas Turmas' },
      { id: 'agenda', href: 'professor.html#agenda', icone: '📅', texto: 'Agenda' },
    ],
    admin: [
      { id: 'turmas', href: 'professor.html', icone: '🏄', texto: 'Turmas' },
      { separador: true },
      { id: 'admin', href: 'admin.html', icone: '⚙️', texto: 'Administração' },
    ],
  };

  const itens = itensPorPapel[usuario.papel] || [];
  const lateral = qs('#barra-lateral');
  if (lateral) {
    lateral.className = 'barra-lateral';
    lateral.innerHTML = itens.map((item) => item.separador
      ? '<div class="separador"></div>'
      : `<a href="${item.href}" class="${item.id === paginaAtual ? 'ativo' : ''}">
           <span class="icone">${item.icone}</span><span>${item.texto}</span>
         </a>`).join('')
      + `<div class="empurra"></div>
         <button id="btn-sair-lateral"><span class="icone">🚪</span><span>Sair</span></button>`;
    qs('#btn-sair-lateral', lateral)?.addEventListener('click', () => aoSair?.());
  }

  const inferior = qs('#nav-inferior');
  if (inferior) {
    inferior.className = 'nav-inferior';
    inferior.innerHTML = itens.filter((i) => !i.separador).slice(0, 5).map((item) => `
      <a href="${item.href}" class="${item.id === paginaAtual ? 'ativo' : ''}">
        <span class="icone">${item.icone}</span><span>${item.texto.split(' ')[0]}</span>
      </a>`).join('');
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
