/**
 * animacoes.js — animações de entrada e efeitos com tema de surf (GSAP).
 *
 * O GSAP é carregado sob demanda do CDN. Se a rede falhar ou o visitante
 * preferir menos movimento, a página continua completa e legível: nada aqui
 * esconde conteúdo de forma permanente.
 *
 * Princípio: o conteúdo nasce visível no HTML. Só escondemos um elemento
 * imediatamente antes de animá-lo, e apenas quando o GSAP já está carregado.
 */

const URL_GSAP = 'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.13.0/gsap.min.js';
const URL_SCROLLTRIGGER = 'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.13.0/ScrollTrigger.min.js';

/** Respeita quem pediu menos movimento no sistema operacional. */
const movimentoReduzido = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

function carregarScript(url) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = url;
    script.async = false; // preserva a ordem: GSAP antes do ScrollTrigger
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Falha ao carregar ${url}`));
    document.head.append(script);
  });
}

/* --------------------------------------------------------------------------
   Blocos de animação
   -------------------------------------------------------------------------- */

/** Entrada do hero: texto sobe e a foto de fundo dá um leve zoom-out. */
function animarHero(gsap) {
  const linha = gsap.timeline({ defaults: { ease: 'power3.out' } });

  linha.from('.hero-site-rotulo', { y: 24, opacity: 0, duration: 0.7 })
    .from('.hero-site h1', { y: 38, opacity: 0, duration: 0.9 }, '-=0.45')
    .from('.hero-site-destaque', { y: 30, opacity: 0, duration: 0.8 }, '-=0.6')
    .from('.hero-site-botoes .btn', { y: 22, opacity: 0, duration: 0.6, stagger: 0.12 }, '-=0.45')
    .from('.hero-site-scroll', { opacity: 0, duration: 0.6 }, '-=0.3');

  const fundo = document.querySelector('.hero-site-fundo');
  if (fundo) {
    gsap.from(fundo, { scale: 1.12, duration: 2.2, ease: 'power2.out' });
  }
}

/**
 * Elementos que sobem ao entrar na tela.
 * `once: true` evita que o conteúdo suma ao rolar de volta.
 */
function animarEntradas(gsap) {
  const alvos = [
    { sel: '.secao-cabecalho', y: 30 },
    { sel: '.bloco-site-texto', y: 34 },
    { sel: '.caixa-contorno', y: 40 },
    { sel: '.cartao-selo', y: 20, stagger: 0.1 },
    { sel: '.lista-check-laranja li', y: 18, stagger: 0.1 },
    { sel: '.cartao-turma', y: 24, stagger: 0.12 },
    { sel: '.cartao-seguranca', y: 32 },
    { sel: '.cartao-produto-foto', y: 30, stagger: 0.1 },
    { sel: '.local-cartao', y: 30 },
    { sel: '.foto-emoldurada', y: 34 },
  ];

  for (const { sel, y, stagger } of alvos) {
    const nodes = document.querySelectorAll(sel);
    if (!nodes.length) continue;

    // Cada elemento tem o próprio gatilho. Agrupar vários sob o gatilho do
    // primeiro fazia com que blocos distantes ficassem com opacity: 0 até
    // que a seção do primeiro entrasse na tela — ou para sempre, se nunca
    // entrasse.
    nodes.forEach((node, i) => {
      gsap.from(node, {
        y,
        opacity: 0,
        duration: 0.85,
        ease: 'power2.out',
        delay: stagger ? i * stagger : 0,
        scrollTrigger: {
          trigger: node,
          start: 'top 88%',
          once: true,
          // Se o elemento já estiver visível no carregamento, anima na hora.
          invalidateOnRefresh: true,
        },
      });
    });
  }
}

/** As fotos espalhadas entram em leque, como ondas chegando à praia. */
function animarGalerias(gsap) {
  const grupos = [
    { container: '.galeria-espalhada', itens: '.foto-espalhada' },
    { container: '.galeria-fundador', itens: '.fundador-principal, .fundador-secundaria' },
  ];

  for (const { container, itens } of grupos) {
    const raiz = document.querySelector(container);
    if (!raiz) continue;

    gsap.from(raiz.querySelectorAll(itens), {
      y: 50,
      opacity: 0,
      scale: 0.92,
      duration: 1,
      ease: 'back.out(1.4)',
      stagger: 0.14,
      scrollTrigger: { trigger: raiz, start: 'top 80%', once: true },
    });
  }
}

/**
 * Paralaxe nos fundos: a imagem desliza mais devagar que a página, dando
 * sensação de profundidade — como olhar o mar enquanto se caminha.
 */
function animarParalaxe(gsap) {
  const fundos = [
    { sel: '.hero-site-fundo', distancia: 70 },
    { sel: '.local-fundo', distancia: 50 },
  ];

  for (const { sel, distancia } of fundos) {
    const node = document.querySelector(sel);
    if (!node) continue;

    gsap.to(node, {
      yPercent: distancia / 10,
      ease: 'none',
      scrollTrigger: {
        trigger: node.closest('section'),
        start: 'top bottom',
        end: 'bottom top',
        scrub: true,
      },
    });
  }
}

/** O contador "De zero a 100%" ganha um pulso ao chegar no fim. */
function animarContador(gsap) {
  const contador = document.querySelector('#contador-evolucao');
  if (!contador) return;

  gsap.to(contador, {
    scale: 1.12,
    duration: 0.4,
    ease: 'power2.out',
    yoyo: true,
    repeat: 1,
    scrollTrigger: { trigger: contador, start: 'top 75%', once: true },
  });
}

/** Os cards de depoimento entram deslizando lateralmente, como a maré. */
function animarDepoimentos(gsap) {
  const faixa = document.querySelector('.depoimentos-faixa');
  if (!faixa) return;

  gsap.from(faixa.children, {
    x: 40,
    opacity: 0,
    duration: 0.7,
    ease: 'power2.out',
    stagger: 0.09,
    scrollTrigger: { trigger: faixa, start: 'top 85%', once: true },
  });
}

/** Leve flutuação contínua nos selos, lembrando boias no mar. */
function animarFlutuacao(gsap) {
  const flutuantes = document.querySelectorAll('.seguranca-icone, .cartao-selo .icone');

  flutuantes.forEach((node, i) => {
    gsap.to(node, {
      y: -7,
      duration: 2 + i * 0.25,
      ease: 'sine.inOut',
      repeat: -1,
      yoyo: true,
      delay: i * 0.2,
    });
  });
}

/**
 * Onda decorativa que separa o hero da seção seguinte, com ondulação
 * contínua. É puramente visual, então fica fora da árvore de acessibilidade.
 */
function montarOndaDivisoria(gsap) {
  const hero = document.querySelector('.hero-site');
  if (!hero || document.querySelector('.onda-divisoria')) return;

  const onda = document.createElement('div');
  onda.className = 'onda-divisoria';
  onda.setAttribute('aria-hidden', 'true');
  onda.innerHTML = `
    <svg viewBox="0 0 1440 120" preserveAspectRatio="none" focusable="false">
      <path class="onda-camada onda-tras"
        d="M0,64 C240,110 480,10 720,54 C960,98 1200,30 1440,64 L1440,120 L0,120 Z"></path>
      <path class="onda-camada onda-frente"
        d="M0,82 C240,40 480,116 720,78 C960,40 1200,104 1440,76 L1440,120 L0,120 Z"></path>
    </svg>`;
  hero.append(onda);

  // Deslocamento horizontal suave e infinito, em ritmos diferentes.
  gsap.to(onda.querySelector('.onda-tras'), {
    xPercent: 3, duration: 7, ease: 'sine.inOut', repeat: -1, yoyo: true,
  });
  gsap.to(onda.querySelector('.onda-frente'), {
    xPercent: -4, duration: 5, ease: 'sine.inOut', repeat: -1, yoyo: true,
  });
}

/* --------------------------------------------------------------------------
   Inicialização
   -------------------------------------------------------------------------- */

/**
 * Carrega o GSAP e aplica as animações. Falhar aqui nunca quebra a página:
 * sem as bibliotecas, tudo permanece visível e estático.
 */
export async function iniciarAnimacoes() {
  if (movimentoReduzido()) return;

  try {
    await carregarScript(URL_GSAP);
    await carregarScript(URL_SCROLLTRIGGER);
  } catch (err) {
    console.warn('[animacoes] GSAP indisponível; a página segue sem animações:', err.message);
    return;
  }

  const { gsap, ScrollTrigger } = window;
  if (!gsap || !ScrollTrigger) {
    console.warn('[animacoes] GSAP carregou mas não registrou as globais.');
    return;
  }

  gsap.registerPlugin(ScrollTrigger);

  animarHero(gsap);
  animarEntradas(gsap);
  animarGalerias(gsap);
  animarParalaxe(gsap);
  animarContador(gsap);
  animarDepoimentos(gsap);
  animarFlutuacao(gsap);
  montarOndaDivisoria(gsap);

  // As imagens vêm de outro domínio e mudam a altura da página ao carregar;
  // sem isto, os gatilhos ficariam calculados em posições erradas.
  window.addEventListener('load', () => ScrollTrigger.refresh());

  instalarRedeDeSeguranca(gsap, ScrollTrigger);
}

/**
 * Rede de segurança contra conteúdo preso em `opacity: 0`.
 *
 * Uma animação de entrada que nunca dispara (gatilho mal calculado, altura
 * da página mudando com imagens externas, aba em segundo plano) deixaria o
 * texto invisível de forma permanente. Aqui varremos a página alguns
 * segundos depois e revelamos qualquer elemento que ainda esteja apagado
 * mas já dentro ou acima da área visível.
 */
function instalarRedeDeSeguranca(gsap, ScrollTrigger) {
  const revelarPresos = () => {
    const alturaJanela = window.innerHeight;
    let revelados = 0;

    document.querySelectorAll('section *').forEach((node) => {
      const estilo = getComputedStyle(node);
      if (parseFloat(estilo.opacity) > 0.05) return;
      // Ignora o que está oculto de propósito (placeholders, menus fechados).
      if (estilo.display === 'none' || estilo.visibility === 'hidden') return;

      const caixa = node.getBoundingClientRect();
      if (caixa.width === 0 && caixa.height === 0) return;
      // Só mexe no que já deveria ter sido revelado.
      if (caixa.top > alturaJanela) return;

      gsap.set(node, { opacity: 1, y: 0, x: 0, scale: 1, clearProps: 'transform' });
      revelados += 1;
    });

    if (revelados) {
      console.warn(`[animacoes] ${revelados} elemento(s) presos em opacity:0 foram revelados.`);
    }
  };

  window.addEventListener('scroll', () => {
    clearTimeout(instalarRedeDeSeguranca.timer);
    instalarRedeDeSeguranca.timer = setTimeout(revelarPresos, 400);
  }, { passive: true });

  setTimeout(() => { ScrollTrigger.refresh(); revelarPresos(); }, 2500);
}
