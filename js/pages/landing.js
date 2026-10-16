/**
 * landing.js — controlador da página inicial.
 *
 * A página espelha o site oficial (barrafloripasurfschool.com.br), com uma
 * diferença combinada: no lugar do botão único que abria o WhatsApp, o hero
 * leva para "Agendar Aula" (cadastro) e "Entrar" (login) do sistema.
 *
 * Os links de produtos continuam indo para o WhatsApp, como no site original.
 */

import { ESCOLA } from '../config.js';
import { inicializarStore } from '../store.js';
import { usuarioOpcional } from '../auth.js';
import { iniciarAnimacoes } from '../animacoes.js';
import { qs, qsa, montarTopoPublico, montarRodape } from '../ui.js';

/* --------------------------------------------------------------------------
   Contador "DE ZERO A __%"
   -------------------------------------------------------------------------- */

/** Percentual final do contador (no site oficial, `const alvo = 100`). */
const META_CONTADOR = 100;

/**
 * Anima o contador quando a seção entra na tela. Usa IntersectionObserver
 * para só começar quando o usuário realmente vê o número.
 */
function iniciarContador() {
  const alvo = qs('#contador-evolucao');
  if (!alvo) return;

  // Sem suporte ou com movimento reduzido, mostra o valor final direto.
  const movimentoReduzido = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (!('IntersectionObserver' in window) || movimentoReduzido) {
    alvo.textContent = `${META_CONTADOR}%`;
    return;
  }

  let animou = false;

  const observador = new IntersectionObserver((entradas) => {
    for (const entrada of entradas) {
      if (!entrada.isIntersecting || animou) continue;
      animou = true;
      observador.disconnect();

      const duracao = 1400;
      const inicio = performance.now();

      const passo = (agora) => {
        const progresso = Math.min(1, (agora - inicio) / duracao);
        // Desaceleração suave no fim.
        const suave = 1 - (1 - progresso) ** 3;
        alvo.textContent = `${Math.round(suave * META_CONTADOR)}%`;
        if (progresso < 1) requestAnimationFrame(passo);
      };

      requestAnimationFrame(passo);
    }
  }, { threshold: 0.4 });

  observador.observe(alvo);
}

/* --------------------------------------------------------------------------
   Links externos
   -------------------------------------------------------------------------- */

/** Monta os links de WhatsApp dos produtos, com a mensagem de cada categoria. */
function montarLinksProdutos() {
  for (const link of qsa('[data-produto]')) {
    const item = link.dataset.produto;
    const mensagem = `Olá! Vim pelo site e quero adquirir ${item}.`;
    link.href = `https://wa.me/${ESCOLA.whatsapp}?text=${encodeURIComponent(mensagem)}`;
  }
}

/** Aponta "Ver mais depoimentos" para a ficha da escola no Google Maps. */
function montarLinkDepoimentos() {
  const link = qs('#link-depoimentos');
  if (link && ESCOLA.mapsUrl) link.href = ESCOLA.mapsUrl;
}

/* --------------------------------------------------------------------------
   Barra de progresso de leitura
   -------------------------------------------------------------------------- */

/**
 * Preenche a barra conforme a rolagem e, no desktop, só a revela depois que
 * o visitante passa da primeira seção — igual ao site oficial. No celular o
 * CSS a mantém sempre visível.
 */
function iniciarBarraProgresso() {
  const barra = qs('#barra-progresso');
  const preenchida = qs('#barra-progresso-preenchida');
  const marco = qs('#sobre');
  if (!barra || !preenchida) return;

  const atualizar = () => {
    const topo = window.scrollY || document.documentElement.scrollTop;
    const altura = document.documentElement.scrollHeight - document.documentElement.clientHeight;
    preenchida.style.width = `${altura > 0 ? (topo / altura) * 100 : 100}%`;

    if (marco) {
      barra.classList.toggle('visivel', topo >= marco.offsetTop - 100);
    } else {
      barra.classList.add('visivel');
    }
  };

  window.addEventListener('scroll', atualizar, { passive: true });
  atualizar();
}

/* --------------------------------------------------------------------------
   Cabeçalho translúcido
   -------------------------------------------------------------------------- */

/**
 * O topo é transparente sobre o hero e ganha o fundo de vidro assim que a
 * página rola. O CSS cuida da aparência; aqui só alternamos a classe.
 */
function iniciarTopoRolagem() {
  const topo = qs('#topo');
  if (!topo) return;

  const atualizar = () => {
    topo.classList.toggle('rolado', (window.scrollY || 0) > 60);
  };

  window.addEventListener('scroll', atualizar, { passive: true });
  atualizar();
}

/* --------------------------------------------------------------------------
   Placeholders de imagem
   -------------------------------------------------------------------------- */

/**
 * Cada <figure> ganha o nome do arquivo que ela espera, para que o
 * placeholder diga exatamente qual imagem colocar em /img.
 */
function rotularPlaceholders() {
  // Cards de produto usam <article>, não <figure>, mas têm o mesmo fallback.
  for (const alvo of qsa('figure, .cartao-produto-foto')) {
    const img = alvo.querySelector('img');
    if (!img) continue;
    alvo.dataset.rotulo = img.getAttribute('src')?.split('/').pop() || 'imagem';
  }
}

/* --------------------------------------------------------------------------
   Inicialização
   -------------------------------------------------------------------------- */

async function iniciar() {
  // Cabeçalho e rodapé primeiro: a página não fica em branco se o
  // armazenamento demorar a responder.
  montarTopoPublico(null);
  montarRodape();

  rotularPlaceholders();
  montarLinksProdutos();
  montarLinkDepoimentos();
  iniciarContador();
  iniciarBarraProgresso();
  iniciarTopoRolagem();

  // As animações entram por último e nunca bloqueiam o resto da página.
  iniciarAnimacoes();

  // Se já houver sessão, o topo troca "Entrar" por "Minha Área".
  try {
    await inicializarStore();
    const usuario = await usuarioOpcional();
    if (usuario) montarTopoPublico(usuario);
  } catch (err) {
    // A landing é informativa: sem o store ela continua válida.
    console.error('[landing] não foi possível verificar a sessão:', err);
  }
}

iniciar();
