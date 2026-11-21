/**
 * saude-form.js — formulário do PAR-Q + Termo de Responsabilidade, com
 * assinatura desenhada no dedo/mouse. Usado no fluxo de reserva e na página
 * "Saúde e termo" do aluno.
 */

import { PERGUNTAS, TERMO, assinarDeclaracao, ErroSaude } from './saude.js';
import { idadeEm } from './documentos.js';
import { t, idiomaAtual } from './i18n.js';
import { qs, qsa, el, escapar, toast, botaoCarregando, mascaraTelefone } from './ui.js';

/* --------------------------------------------------------------------------
   Quadro de assinatura
   -------------------------------------------------------------------------- */

function criarQuadroAssinatura(canvas) {
  const ctx = canvas.getContext('2d');
  let desenhando = false;
  // Fundo branco: o PNG da assinatura sai sem transparência (fica certo no PDF).
  const pintarFundo = () => { ctx.save(); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.restore(); };
  let tracos = 0;

  const ajustar = () => {
    // Resolução interna fixa: o PNG fica pequeno e nítido em qualquer tela.
    canvas.width = 600;
    canvas.height = 200;
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111';
    pintarFundo();
  };
  ajustar();

  const ponto = (ev) => {
    const r = canvas.getBoundingClientRect();
    return { x: ((ev.clientX - r.left) / r.width) * canvas.width, y: ((ev.clientY - r.top) / r.height) * canvas.height };
  };

  canvas.addEventListener('pointerdown', (ev) => {
    desenhando = true;
    canvas.setPointerCapture(ev.pointerId);
    const p = ponto(ev);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    tracos += 1;
    canvas.closest('.quadro-assinatura')?.classList.add('assinado');
  });
  canvas.addEventListener('pointermove', (ev) => {
    if (!desenhando) return;
    const p = ponto(ev);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  });
  const parar = () => { desenhando = false; };
  canvas.addEventListener('pointerup', parar);
  canvas.addEventListener('pointercancel', parar);

  return {
    vazio: () => tracos === 0,
    limpar: () => {
      pintarFundo();
      tracos = 0;
      canvas.closest('.quadro-assinatura')?.classList.remove('assinado');
    },
    imagem: () => canvas.toDataURL('image/png'),
  };
}

/* --------------------------------------------------------------------------
   Formulário
   -------------------------------------------------------------------------- */

/**
 * Monta o formulário em `container`. `aoAssinar(declaracao)` roda depois de
 * gravar. `textoBotao` permite "Assinar e continuar" no fluxo de reserva.
 */
export function montarFormularioSaude(container, { usuario, aoAssinar, textoBotao = null }) {
  const idioma = idiomaAtual();
  const perguntas = PERGUNTAS[idioma] || PERGUNTAS.pt;
  const termo = TERMO[idioma] || TERMO.pt;

  container.innerHTML = `
    <form class="form-saude" novalidate>
      <p class="texto-peq texto-cinza mb-16">${escapar(t('saude.intro'))}</p>

      <h4 class="mb-8">${escapar(t('saude.parqTitulo'))}</h4>
      <ol class="lista-parq">
        ${perguntas.map((p, i) => `
          <li class="pergunta-parq" data-indice="${i}">
            <span class="texto-pergunta">${escapar(p)}</span>
            <span class="opcoes-parq" role="radiogroup" aria-label="${escapar(p)}">
              <label class="opcao-parq"><input type="radio" name="q${i}" value="sim"><span>${escapar(t('saude.sim'))}</span></label>
              <label class="opcao-parq"><input type="radio" name="q${i}" value="nao"><span>${escapar(t('saude.nao'))}</span></label>
            </span>
          </li>`).join('')}
      </ol>

      <div class="alerta alerta-aviso oculto" id="aviso-sim">
        <span class="cresce">${escapar(t('saude.avisoSim'))}</span>
      </div>

      <div class="campo">
        <label for="saude-obs">${escapar(t('saude.observacoes'))} <span class="dica">${escapar(t('saude.opcional'))}</span></label>
        <textarea id="saude-obs" rows="2" maxlength="600" placeholder="${escapar(t('saude.observacoesDica'))}"></textarea>
      </div>

      <h4 class="mt-24 mb-8">${escapar(termo.titulo)}</h4>
      <div class="caixa-termo">
        <p>${escapar(termo.texto1)}</p>
        <p class="negrito mt-8">${escapar(termo.texto2)}</p>
      </div>

      <div class="linha-campos duas mt-16">
        <div class="campo">
          <label for="saude-nome">${escapar(t('saude.nomeCompleto'))}</label>
          <input type="text" id="saude-nome" autocomplete="name" value="${escapar(usuario?.nome || '')}">
          <span class="msg-erro">${escapar(t('saude.erroNome'))}</span>
        </div>
        <div class="campo">
          <label for="saude-rg">${escapar(t('saude.rg'))} <span class="dica">${escapar(t('saude.opcional'))}</span></label>
          <input type="text" id="saude-rg" maxlength="30">
        </div>
      </div>
      <div class="linha-campos duas">
        <div class="campo">
          <label for="saude-nasc">${escapar(t('saude.nascimento'))}</label>
          <input type="date" id="saude-nasc" value="${escapar(usuario?.nascimento || '')}">
          <span class="msg-erro">${escapar(t('saude.erroNascimento'))}</span>
        </div>
        <div class="campo">
          <label for="saude-celular">${escapar(t('saude.celular'))}</label>
          <input type="tel" id="saude-celular" value="${escapar(usuario?.telefone || '')}">
        </div>
      </div>
      <div class="campo oculto" id="campo-responsavel">
        <label for="saude-responsavel">${escapar(t('saude.responsavel'))}</label>
        <input type="text" id="saude-responsavel" maxlength="120">
        <span class="dica">${escapar(t('saude.responsavelDica'))}</span>
      </div>

      <div class="campo">
        <label>${escapar(t('saude.assinatura'))}</label>
        <div class="quadro-assinatura">
          <canvas aria-label="${escapar(t('saude.assinatura'))}"></canvas>
          <span class="quadro-dica">${escapar(t('saude.assineAqui'))}</span>
          <button type="button" class="btn btn-fantasma btn-peq quadro-limpar">${escapar(t('saude.limpar'))}</button>
        </div>
      </div>

      <label class="checkbox-linha mb-16">
        <input type="checkbox" id="saude-aceite">
        <span>${escapar(t('saude.aceite'))}</span>
      </label>

      <button type="submit" class="btn btn-primario btn-bloco">${escapar(textoBotao || t('saude.assinar'))}</button>
    </form>`;

  const form = qs('form', container);
  const quadro = criarQuadroAssinatura(qs('canvas', form));
  qs('.quadro-limpar', form).addEventListener('click', quadro.limpar);

  const atualizarAvisoSim = () => {
    const algumSim = qsa('input[type=radio][value=sim]:checked', form).length > 0;
    qs('#aviso-sim', form).classList.toggle('oculto', !algumSim);
  };
  qsa('input[type=radio]', form).forEach((r) => r.addEventListener('change', () => {
    r.closest('.pergunta-parq')?.classList.remove('erro');
    atualizarAvisoSim();
  }));

  const atualizarResponsavel = () => {
    const idade = idadeEm(qs('#saude-nasc', form).value);
    qs('#campo-responsavel', form).classList.toggle('oculto', !(idade !== null && idade < 18));
  };
  qs('#saude-nasc', form).addEventListener('change', atualizarResponsavel);
  atualizarResponsavel();
  qs('#saude-celular', form).addEventListener('input', (ev) => {
    if (/^\(?\d/.test(ev.target.value) && !ev.target.value.startsWith('+')) ev.target.value = mascaraTelefone(ev.target.value);
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const respostas = perguntas.map((_, i) => qs(`input[name=q${i}]:checked`, form)?.value || null);
    qsa('.pergunta-parq', form).forEach((li, i) => li.classList.toggle('erro', !respostas[i]));
    if (respostas.some((r) => !r)) {
      toast(t('saude.erroRespostas'), 'aviso');
      qs('.pergunta-parq.erro', form)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    if (quadro.vazio()) {
      toast(t('saude.erroAssinatura'), 'aviso');
      return;
    }
    if (!qs('#saude-aceite', form).checked) {
      toast(t('saude.erroAceite'), 'aviso');
      return;
    }

    const btn = qs('button[type=submit]', form);
    const restaurar = botaoCarregando(btn, t('comum.salvando'));
    try {
      const decl = await assinarDeclaracao(usuario, {
        respostas,
        nomeCompleto: qs('#saude-nome', form).value,
        rg: qs('#saude-rg', form).value,
        celular: qs('#saude-celular', form).value,
        nascimento: qs('#saude-nasc', form).value,
        responsavelNome: qs('#saude-responsavel', form).value,
        observacoes: qs('#saude-obs', form).value,
        assinatura: quadro.imagem(),
        aceite: true,
        idioma,
      });
      await aoAssinar?.(decl);
    } catch (err) {
      restaurar();
      toast(err instanceof ErroSaude ? err.message : t('saude.erroSalvar'), 'erro', 6000);
      if (!(err instanceof ErroSaude)) console.error('[saude] erro ao assinar:', err);
    }
  });

  return form;
}

/** Cartão-resumo de uma declaração vigente (aluno vê no fluxo e na página). */
export function resumoDeclaracaoEl(decl, { aoBaixar } = {}) {
  const validade = new Date(decl.validaAte);
  const texto = t('saude.validaAte', {
    data: `${String(validade.getDate()).padStart(2, '0')}/${String(validade.getMonth() + 1).padStart(2, '0')}/${validade.getFullYear()}`,
  });
  return el('div', { class: 'alerta alerta-sucesso' }, [
    el('span', { class: 'cresce' }, [
      el('strong', { text: t('saude.declaracaoValida') }),
      el('br'),
      texto,
    ]),
    aoBaixar ? el('button', { type: 'button', class: 'btn btn-claro btn-peq', text: t('saude.baixarPdf'), onclick: aoBaixar }) : null,
  ]);
}
