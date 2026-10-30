/**
 * tutorial.js — tour guiado de primeiro acesso.
 *
 * Duas partes:
 *  1. painel (dashboard.html): créditos, onde comprar, onde agendar, aulas;
 *  2. agendamento (agendar.html?tutorial=1): tipo de aula, calendário,
 *     horários e confirmação — mostrado sobre a tela de verdade.
 *
 * O tour destaca um elemento por vez com um "holofote" e um balão de
 * explicação. Não depende de biblioteca: é um overlay com um recorte feito
 * por box-shadow, reposicionado a cada passo.
 *
 * Acessibilidade: balão com role="dialog", foco no botão principal a cada
 * passo, setas ← → navegam e Esc encerra. Respeita prefers-reduced-motion.
 */

import { atualizar } from './store.js';
import { el, qs } from './ui.js';

/* --------------------------------------------------------------------------
   Persistência: quem já viu o tutorial
   -------------------------------------------------------------------------- */

const chaveLocal = (usuarioId) => `bf_tutorial_${usuarioId}`;

/**
 * O tutorial aparece no primeiro acesso do aluno. A marca de "já visto" fica
 * no perfil (vale em qualquer dispositivo) e também no navegador, para não
 * reaparecer se a gravação no perfil falhar por algum motivo.
 */
export function tutorialPendente(usuario) {
  if (!usuario || usuario.papel !== 'aluno') return false;
  if (usuario.tutorialConcluido) return false;
  try {
    if (localStorage.getItem(chaveLocal(usuario.id)) === 'concluido') return false;
  } catch { /* armazenamento bloqueado: segue para o perfil */ }
  return true;
}

export async function marcarTutorialConcluido(usuario) {
  if (!usuario) return;
  usuario.tutorialConcluido = true;
  try { localStorage.setItem(chaveLocal(usuario.id), 'concluido'); } catch { /* ignora */ }
  try {
    await atualizar('usuarios', usuario.id, { tutorialConcluido: true });
  } catch (err) {
    // Não é crítico: a marca local já impede que o tour reapareça aqui.
    console.warn('[tutorial] não foi possível gravar no perfil:', err);
  }
}

/* --------------------------------------------------------------------------
   Motor do tour
   -------------------------------------------------------------------------- */

const MARGEM = 16;      // distância mínima das bordas da tela
const FOLGA_FOCO = 8;   // respiro em volta do elemento destacado
const DISTANCIA = 14;   // espaço entre o destaque e o balão

const movimentoReduzido = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Espera a rolagem suave terminar. Um tempo fixo não serve: no celular o
 * alvo pode estar a mais de mil pixels e a rolagem leva quase um segundo —
 * o destaque aparecia fora do lugar e "escorregava" até o alvo.
 */
function aguardarRolagemParar(limiteMs = 1200) {
  return new Promise((resolve) => {
    const inicio = performance.now();
    let ultimo = window.scrollY;
    let quadrosParado = 0;

    const verificar = () => {
      const atual = window.scrollY;
      quadrosParado = atual === ultimo ? quadrosParado + 1 : 0;
      ultimo = atual;
      // Alguns quadros seguidos sem mudar = rolagem encerrada.
      if (quadrosParado >= 4 || performance.now() - inicio > limiteMs) resolve();
      else requestAnimationFrame(verificar);
    };
    requestAnimationFrame(verificar);
  });
}

/** Elemento existe, está renderizado e tem tamanho na tela. */
function visivel(node) {
  if (!node || !node.isConnected) return false;
  const estilo = getComputedStyle(node);
  if (estilo.display === 'none' || estilo.visibility === 'hidden') return false;
  const caixa = node.getBoundingClientRect();
  return caixa.width > 0 && caixa.height > 0;
}

/**
 * `alvo` pode ser: null (balão central), um seletor, uma lista de seletores
 * (usa o primeiro visível — ex.: menu lateral no desktop, barra inferior no
 * celular) ou uma função que devolve o elemento.
 */
function resolverAlvo(alvo) {
  if (!alvo) return null;
  if (typeof alvo === 'function') {
    const node = alvo();
    return visivel(node) ? node : null;
  }
  for (const seletor of [].concat(alvo)) {
    const node = qs(seletor);
    if (visivel(node)) return node;
  }
  return null;
}

/**
 * Executa uma sequência de passos.
 *
 * passo = {
 *   alvo, titulo, texto,
 *   antes?: async () => void,   // prepara a tela (ex.: seleciona um horário)
 *   botoes?: [{ texto, valor, primario }]  // substitui "Próximo" no passo
 * }
 *
 * Resolve com 'concluido', 'pulado' ou o `valor` do botão escolhido.
 */
export function executarTour(passos, { rotuloEtapa = '' } = {}) {
  return new Promise((resolve) => {
    let indice = 0;
    let alvoAtual = null;
    let encerrado = false;
    let quadroPendente = 0;

    const raiz = el('div', { class: 'tour', 'aria-hidden': 'false' });
    if (movimentoReduzido()) raiz.classList.add('tour-sem-movimento');

    // Bloqueia cliques na página durante o tour: o aluno lê sem disparar
    // nada por engano. A navegação é toda pelo balão.
    const bloqueio = el('div', { class: 'tour-bloqueio' });
    const foco = el('div', { class: 'tour-foco' });

    const progresso = el('span', { class: 'tour-progresso' });
    const titulo = el('h3', { class: 'tour-titulo', id: 'tour-titulo' });
    const texto = el('div', { class: 'tour-texto', 'aria-live': 'polite' });
    const pontos = el('div', { class: 'tour-pontos', 'aria-hidden': 'true' });
    const btnPular = el('button', { type: 'button', class: 'tour-pular', text: 'Pular tutorial' });
    const acoes = el('div', { class: 'tour-acoes' });

    const balao = el('div', {
      class: 'tour-balao',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'tour-titulo',
    }, [
      el('div', { class: 'tour-cabecalho' }, [progresso, btnPular]),
      titulo,
      texto,
      el('div', { class: 'tour-rodape' }, [pontos, acoes]),
    ]);

    raiz.append(bloqueio, foco, balao);
    document.body.append(raiz);

    /* --- Posicionamento --- */

    function posicionar() {
      quadroPendente = 0;
      const larguraTela = window.innerWidth;
      const alturaTela = window.innerHeight;

      // Holofote sobre o alvo (ou recolhido no centro, escurecendo tudo).
      if (alvoAtual && visivel(alvoAtual)) {
        const r = alvoAtual.getBoundingClientRect();
        Object.assign(foco.style, {
          top: `${r.top - FOLGA_FOCO}px`,
          left: `${r.left - FOLGA_FOCO}px`,
          width: `${r.width + FOLGA_FOCO * 2}px`,
          height: `${r.height + FOLGA_FOCO * 2}px`,
          opacity: '1',
        });
        foco.classList.remove('tour-foco-vazio');
      } else {
        Object.assign(foco.style, {
          top: `${alturaTela / 2}px`, left: `${larguraTela / 2}px`, width: '0px', height: '0px',
        });
        foco.classList.add('tour-foco-vazio');
      }

      // Balão: abaixo do alvo se couber, senão acima; sem espaço, no rodapé.
      const largura = balao.offsetWidth;
      const altura = balao.offsetHeight;
      let topo;
      let esquerda;

      if (alvoAtual && visivel(alvoAtual)) {
        const r = alvoAtual.getBoundingClientRect();
        const abaixo = r.bottom + FOLGA_FOCO + DISTANCIA;
        const acima = r.top - FOLGA_FOCO - DISTANCIA - altura;

        if (abaixo + altura <= alturaTela - MARGEM) topo = abaixo;
        else if (acima >= MARGEM) topo = acima;
        else topo = alturaTela - altura - MARGEM;

        esquerda = r.left + r.width / 2 - largura / 2;
      } else {
        topo = (alturaTela - altura) / 2;
        esquerda = (larguraTela - largura) / 2;
      }

      esquerda = Math.min(Math.max(esquerda, MARGEM), larguraTela - largura - MARGEM);
      topo = Math.min(Math.max(topo, MARGEM), alturaTela - altura - MARGEM);

      balao.style.top = `${Math.round(topo)}px`;
      balao.style.left = `${Math.round(esquerda)}px`;
    }

    const agendarPosicao = () => {
      if (!quadroPendente) quadroPendente = requestAnimationFrame(posicionar);
    };

    /* --- Navegação --- */

    async function mostrar(i) {
      indice = i;
      const passo = passos[i];

      if (passo.antes) {
        try { await passo.antes(); } catch (err) { console.warn('[tutorial] preparo do passo falhou:', err); }
      }
      if (encerrado) return;

      alvoAtual = resolverAlvo(passo.alvo);

      if (alvoAtual) {
        // Leva o alvo para o meio da tela antes de destacar.
        alvoAtual.scrollIntoView({ block: 'center', behavior: movimentoReduzido() ? 'auto' : 'smooth' });
        await esperar(40); // dá tempo de a rolagem começar
        await aguardarRolagemParar();
        if (encerrado) return;
      }

      progresso.textContent = `${rotuloEtapa ? `${rotuloEtapa} · ` : ''}Passo ${i + 1} de ${passos.length}`;
      titulo.textContent = passo.titulo;
      texto.innerHTML = passo.texto; // conteúdo fixo deste arquivo, nunca do usuário

      pontos.innerHTML = '';
      passos.forEach((_, n) => {
        pontos.append(el('span', { class: `tour-ponto ${n === i ? 'ativo' : ''} ${n < i ? 'visto' : ''}` }));
      });

      acoes.innerHTML = '';
      if (i > 0) {
        acoes.append(el('button', {
          type: 'button', class: 'btn btn-claro btn-peq', text: 'Voltar',
          onclick: () => mostrar(indice - 1),
        }));
      }

      const botoes = passo.botoes || [{
        texto: i === passos.length - 1 ? 'Concluir' : 'Próximo →',
        valor: i === passos.length - 1 ? 'concluido' : null,
        primario: true,
      }];

      let principal = null;
      for (const b of botoes) {
        const botao = el('button', {
          type: 'button',
          class: `btn ${b.primario ? 'btn-primario' : 'btn-claro'} btn-peq`,
          text: b.texto,
          onclick: () => (b.valor ? encerrar(b.valor) : mostrar(indice + 1)),
        });
        if (b.primario) principal = botao;
        acoes.append(botao);
      }

      balao.classList.remove('tour-entrando');
      void balao.offsetWidth; // reinicia a animação de entrada
      balao.classList.add('tour-entrando');

      posicionar();
      (principal || acoes.lastElementChild)?.focus({ preventScroll: true });
    }

    function aoTeclar(ev) {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        encerrar('pulado');
      } else if (ev.key === 'ArrowRight' && !passos[indice].botoes && indice < passos.length - 1) {
        ev.preventDefault();
        mostrar(indice + 1);
      } else if (ev.key === 'ArrowLeft' && indice > 0) {
        ev.preventDefault();
        mostrar(indice - 1);
      }
    }

    function encerrar(resultado) {
      if (encerrado) return;
      encerrado = true;
      document.removeEventListener('keydown', aoTeclar, true);
      window.removeEventListener('resize', agendarPosicao);
      window.removeEventListener('scroll', agendarPosicao, true);
      if (quadroPendente) cancelAnimationFrame(quadroPendente);
      raiz.classList.add('tour-saindo');
      setTimeout(() => raiz.remove(), movimentoReduzido() ? 0 : 220);
      resolve(resultado);
    }

    btnPular.addEventListener('click', () => encerrar('pulado'));
    document.addEventListener('keydown', aoTeclar, true);
    window.addEventListener('resize', agendarPosicao);
    window.addEventListener('scroll', agendarPosicao, true);

    mostrar(0);
  });
}

/* --------------------------------------------------------------------------
   Roteiro do aluno
   -------------------------------------------------------------------------- */

/** Parte 1 — painel do aluno. */
export function passosPainel(usuario) {
  const nome = (usuario?.nome || '').trim().split(/\s+/)[0];
  return [
    {
      alvo: null,
      titulo: `Boas-vindas${nome ? `, ${nome}` : ''}!`,
      texto: `<p>Em menos de um minuto você vai saber agendar sua aula.</p>
              <p class="tour-dica">Use <kbd>→</kbd> e <kbd>←</kbd> para navegar, ou <kbd>Esc</kbd> para sair.</p>`,
    },
    {
      alvo: '.card-stat.laranja',
      titulo: 'Seus créditos',
      texto: `<p>Cada <strong>crédito vale uma aula</strong> de 1h30. Você compra
              créditos em pacotes e usa um a cada aula agendada.</p>
              <p>Pacotes têm prazo para usar — o painel avisa quando algum
              estiver perto de vencer.</p>`,
    },
    {
      alvo: '#chip-creditos',
      titulo: 'Sempre à vista',
      texto: '<p>O saldo também fica aqui no topo, em qualquer tela do sistema.</p>',
    },
    {
      alvo: '.acao-rapida[href="checkout.html"]',
      titulo: '1º passo: comprar créditos',
      texto: `<p>Sem créditos? Comece por aqui. Escolha um pacote, pague por
              <strong>PIX, cartão, Mercado Pago ou PayPal</strong> e os
              créditos entram na hora.</p>
              <p>Quanto maior o pacote, menor o preço por aula.</p>`,
    },
    {
      alvo: '.acao-rapida[href="agendar.html"]',
      titulo: '2º passo: agendar a aula',
      texto: '<p>Com créditos na conta, é aqui que você escolhe o dia, o horário e o professor.</p>',
    },
    {
      alvo: () => qs('#lista-proximas')?.closest('.card'),
      titulo: 'Suas próximas aulas',
      texto: `<p>Toda aula marcada aparece aqui, com data, horário, professor e local.</p>
              <p>Imprevisto? Você pode <strong>cancelar até 12h antes</strong>
              e o crédito volta para a sua conta.</p>`,
    },
    {
      alvo: () => qs('#lista-creditos')?.closest('.card'),
      titulo: 'De onde vem cada crédito',
      texto: '<p>Aqui você vê de qual pacote é cada crédito e até quando ele vale.</p>',
    },
    {
      alvo: ['#barra-lateral', '#nav-inferior'],
      titulo: 'Menu',
      texto: `<p>Pelo menu você chega a todas as telas: agendamento, créditos,
              histórico e planos.</p>
              <p>Para rever este tutorial, use <strong>Como agendar</strong> —
              no celular, ele fica ao tocar na sua foto, no topo.</p>`,
    },
    {
      alvo: null,
      titulo: 'Agora, na prática',
      texto: `<p>Quer ver a tela de agendamento por dentro? Mostramos cada
              etapa — sem marcar nenhuma aula.</p>`,
      botoes: [
        { texto: 'Agora não', valor: 'concluido' },
        { texto: 'Ver o agendamento →', valor: 'agendar', primario: true },
      ],
    },
  ];
}

/**
 * Parte 2 — tela de agendamento.
 * `ganchos.selecionarHorarioExemplo` escolhe um horário para revelar o botão
 * de confirmação; `ganchos.limparSelecao` desfaz isso ao final.
 */
export function passosAgendamento(ganchos = {}) {
  return [
    {
      alvo: () => qs('#tipo-aula')?.closest('.campo'),
      titulo: 'Escolha o tipo de aula',
      texto: `<p><strong>Em grupo:</strong> até 5 alunos por professor.<br>
              <strong>Particular:</strong> só você e o professor.</p>
              <p>O calendário se ajusta à escolha.</p>`,
    },
    {
      alvo: '#calendario',
      titulo: 'Escolha o dia',
      texto: `<p>Dias com <span class="tour-bolinha verde"></span> têm vaga.</p>
              <p>Dias apagados já passaram, estão lotados ou não valem para o
              seu plano — o mensalista, por exemplo, só agenda sábado e domingo.</p>`,
    },
    {
      alvo: () => qs('#lista-slots')?.closest('.card'),
      titulo: 'Escolha o horário e o professor',
      texto: `<p>Cada linha mostra o horário (aulas de 1h30), o professor, o
              local e a lotação — <strong>3/5</strong> quer dizer 3 alunos
              de 5 vagas.</p>
              <p>Horários <strong>LOTADO</strong> não podem ser escolhidos.</p>`,
    },
    {
      alvo: '#badge-creditos',
      titulo: 'Quanto custa',
      texto: '<p>Cada aula usa <strong>1 crédito</strong>. Aqui você confere quantos ainda tem.</p>',
    },
    {
      antes: ganchos.selecionarHorarioExemplo,
      alvo: ['#area-confirmacao', '#lista-slots'],
      titulo: 'Confirme',
      texto: `<p>Ao tocar num horário, aparece o botão <strong>Confirmar
              agendamento</strong>. Pronto: a aula vai para o seu painel.</p>
              <p class="tour-dica">Escolhemos um horário só para te mostrar —
              nada foi agendado.</p>`,
    },
    {
      antes: ganchos.limparSelecao,
      alvo: null,
      titulo: 'Tudo pronto!',
      texto: `<p>Agora é com você: escolha o dia, o horário e confirme.</p>
              <p>Para rever este passo a passo, use <strong>Como agendar</strong>
              no menu (no celular, toque na sua foto, no topo).</p>`,
      botoes: [{ texto: 'Começar a agendar', valor: 'concluido', primario: true }],
    },
  ];
}
