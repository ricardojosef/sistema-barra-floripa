/**
 * agendar.js — calendário e escolha de horário (aluno logado, com créditos).
 *
 * O aluno escolhe dia, horário e praia; o professor é atribuído pela escola
 * e não aparece aqui. Antes de confirmar, o sistema exige cadastro completo
 * (documento) e questionário de saúde vigente.
 */

import { exigirAuth, sair } from '../auth.js';
import { lotesVigentes, diasAteVencer } from '../creditos.js';
import { listar } from '../store.js';
import { agendar, ErroAgenda } from '../agenda.js';
import { carregarContexto, nomeLocal } from '../precos.js';
import { declaracaoValida } from '../saude.js';
import { perfilCompleto } from '../documentos.js';
import { criarSeletorAula, dataPorExtenso } from '../seletor-aula.js';
import { t } from '../i18n.js';
import {
  qs, montarShellPainel, toast, botaoCarregando, abrirModal, escapar,
  paramUrl, icone, faixaHorario,
} from '../ui.js';
import { executarTour, passosAgendamento, marcarTutorialConcluido } from '../tutorial.js';

let usuario = null;
let contexto = null;
let saldo = 0;
/** true quando todos os créditos do aluno são restritos a sábado/domingo. */
let soFimDeSemana = false;
let tipoAula = 'grupo';
let seletor = null;
let slotSelecionado = null;

/* --------------------------------------------------------------------------
   Confirmação
   -------------------------------------------------------------------------- */

function aoSelecionar(slot) {
  slotSelecionado = slot;
  qs('#area-confirmacao').classList.toggle('oculto', !slot);
  if (slot) {
    qs('#confirmacao-texto').textContent = `${dataPorExtenso(slot.data)} · ${faixaHorario(slot.horario, contexto.config.duracaoMin)} · ${nomeLocal(contexto.mapaLocais, slot.localId)}`;
    qs('#btn-confirmar').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

async function confirmarAgendamento() {
  if (!slotSelecionado) {
    toast('Escolha um dia e um horário.', 'aviso');
    return;
  }
  if (saldo < 1) {
    mostrarSemCreditos();
    return;
  }

  // Questionário de saúde: obrigatório, renovado a cada 6 meses.
  if (!(await declaracaoValida(usuario.id))) {
    abrirModal({
      titulo: t('saude.titulo'),
      corpo: `<p>${escapar(t('agendar.saudePendente'))}</p>`,
      botoes: [
        { texto: t('comum.agoraNao'), classe: 'btn-claro' },
        { texto: t('agendar.responderAgora'), classe: 'btn-primario', onClick: () => { location.href = 'saude.html?voltar=agendar.html'; } },
      ],
    });
    return;
  }

  const btn = qs('#btn-confirmar');
  const restaurar = botaoCarregando(btn, 'Agendando...');

  try {
    await agendar({
      alunoId: usuario.id,
      alunoNome: usuario.nome,
      data: slotSelecionado.data,
      horario: slotSelecionado.horario,
      localId: slotSelecionado.localId,
      tipo: tipoAula,
    });
    location.href = 'dashboard.html?agendado=ok';
  } catch (err) {
    restaurar();

    if (err instanceof ErroAgenda && err.codigo === 'SEM_CREDITOS') {
      mostrarSemCreditos();
      return;
    }

    if (err instanceof ErroAgenda && err.codigo === 'APENAS_FIM_DE_SEMANA') {
      abrirModal({
        titulo: 'Plano válido só no fim de semana',
        corpo: `
          <p>${escapar(err.message)}</p>
          <p class="mt-16 texto-cinza texto-peq">
            Escolha um sábado ou domingo no calendário, ou compre uma aula
            avulsa para treinar durante a semana.
          </p>`,
        botoes: [
          { texto: 'Escolher outro dia', classe: 'btn-claro' },
          { texto: 'Ver planos', classe: 'btn-primario', onClick: () => { location.href = 'checkout.html'; } },
        ],
      });
      return;
    }

    toast(err instanceof ErroAgenda ? err.message : 'Não foi possível agendar.', 'erro', 6000);
    console.error('[agendar] erro ao agendar:', err);

    // Estado pode ter mudado (alguém pegou a última vaga): recarrega o dia.
    await seletor.recarregar();
    await atualizarSaldo();
  }
}

function mostrarSemCreditos() {
  abrirModal({
    titulo: 'Você está sem créditos',
    corpo: `
      <p>Para agendar uma aula é preciso ter pelo menos 1 crédito disponível.</p>
      <p class="mt-16 texto-cinza texto-peq">
        Escolha um pacote — você já pode escolher a aula junto com a compra.
      </p>`,
    botoes: [
      { texto: 'Agora não', classe: 'btn-claro' },
      { texto: 'Comprar e agendar', classe: 'btn-primario', onClick: () => { location.href = 'reservar.html'; } },
    ],
  });
}

/* --------------------------------------------------------------------------
   Saldo
   -------------------------------------------------------------------------- */

async function atualizarSaldo() {
  const lancamentos = await listar('creditos', { alunoId: usuario.id });
  const lotes = lotesVigentes(lancamentos);
  saldo = lotes.reduce((total, l) => total + l.restante, 0);

  // Se TODOS os créditos forem de plano mensal, o aluno só pode agendar
  // no fim de semana — o calendário precisa refletir isso.
  soFimDeSemana = lotes.length > 0 && lotes.every((l) => l.apenasFimDeSemana);

  qs('#badge-creditos').textContent = saldo === 1 ? '1 crédito' : `${saldo} créditos`;
  const chip = qs('#chip-creditos-valor');
  if (chip) chip.textContent = String(saldo);

  const alerta = qs('#alerta-area');
  alerta.innerHTML = '';

  if (saldo < 1) {
    alerta.innerHTML = `
      <div class="alerta alerta-aviso">
        ${icone('creditos')}
        <span class="cresce">
          Você não tem créditos disponíveis. É possível ver os horários, mas
          para confirmar é preciso comprar um pacote — dá para escolher a aula
          junto com a compra.
        </span>
        <a href="reservar.html" class="negrito">Comprar e agendar →</a>
      </div>`;
    return;
  }

  if (soFimDeSemana) {
    alerta.innerHTML = `
      <div class="alerta alerta-info">
        ${icone('agenda')}
        <span class="cresce">
          Seus créditos são do <strong>plano mensalista</strong>, válido
          apenas para <strong>sábado e domingo</strong>. Os demais dias
          aparecem indisponíveis no calendário.
        </span>
      </div>`;
  }

  const proximo = lotes
    .filter((l) => l.expiraEm)
    .sort((a, b) => String(a.expiraEm).localeCompare(String(b.expiraEm)))[0];

  if (proximo) {
    const dias = diasAteVencer(proximo.expiraEm);
    if (dias !== null && dias <= 7) {
      alerta.insertAdjacentHTML('beforeend', `
        <div class="alerta alerta-aviso">
          ${icone('ampulheta')}
          <span class="cresce">
            ${proximo.restante} ${proximo.restante === 1 ? 'crédito vence' : 'créditos vencem'}
            em ${dias <= 0 ? 'breve' : `${dias} ${dias === 1 ? 'dia' : 'dias'}`}.
            Agende para não perder.
          </span>
        </div>`);
    }
  }
}

/* --------------------------------------------------------------------------
   Inicialização
   -------------------------------------------------------------------------- */

async function iniciar() {
  usuario = await exigirAuth(['aluno']);

  montarShellPainel({
    usuario,
    paginaAtual: 'agendar',
    chipCreditos: true,
    aoSair: () => sair(),
  });

  if (!perfilCompleto(usuario)) {
    location.replace('perfil.html?completar=1&voltar=agendar.html');
    return;
  }

  contexto = await carregarContexto();
  await atualizarSaldo();
  qs('#nota-cancelamento').textContent = t('agendar.notaCancelamento', { horas: contexto.config.horasMinimasCancelamento });

  seletor = criarSeletorAula({
    grade: qs('#calendario'),
    rotuloMes: qs('#mes-atual'),
    btnAnterior: qs('#mes-anterior'),
    btnProximo: qs('#mes-proximo'),
    lista: qs('#lista-slots'),
    rotuloDia: qs('#dia-selecionado'),
    resumoDia: qs('#resumo-dia'),
    contexto,
    tipo: () => tipoAula,
    soFimDeSemana: () => soFimDeSemana,
    aoSelecionar,
  });

  // O tipo pode ser trocado pelo campo "Tipo de aula" ou pelo seletor ao
  // lado dos horários — os dois ficam sempre em sincronia.
  const trocarTipo = async (novo) => {
    if (novo === tipoAula) return;
    tipoAula = novo;
    qs('#tipo-aula').value = novo;
    document.querySelectorAll('.segmento-opcao').forEach((b) => {
      b.classList.toggle('ativo', b.dataset.tipo === novo);
      b.setAttribute('aria-pressed', String(b.dataset.tipo === novo));
    });
    aoSelecionar(null);
    await seletor.recarregar();
  };

  qs('#tipo-aula').addEventListener('change', (ev) => trocarTipo(ev.target.value));
  document.querySelectorAll('.segmento-opcao').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.tipo === tipoAula));
    b.addEventListener('click', () => trocarTipo(b.dataset.tipo));
  });

  qs('#btn-confirmar').addEventListener('click', confirmarAgendamento);

  await seletor.iniciar();

  // Parte 2 do tutorial: chega aqui a partir do painel.
  if (paramUrl('tutorial') === '1') {
    history.replaceState(null, '', 'agendar.html');
    await rodarTutorialAgendamento();
  }
}

/**
 * Mostra o agendamento sobre a tela real. Para revelar o botão de
 * confirmação, o tour seleciona um horário de exemplo — e desfaz isso no
 * fim. Nada é agendado: a reserva só acontece no clique em "Confirmar".
 */
async function rodarTutorialAgendamento() {
  let selecionouExemplo = false;

  const limparSelecao = () => {
    if (!selecionouExemplo) return;
    selecionouExemplo = false;
    seletor.limparSelecao();
  };

  const ganchos = {
    selecionarHorarioExemplo: () => {
      const livre = qs('#lista-slots .slot:not(.lotado)');
      if (livre && !slotSelecionado) {
        livre.click();
        selecionouExemplo = true;
      }
    },
    limparSelecao,
  };

  await executarTour(passosAgendamento(ganchos), { rotuloEtapa: 'Agendamento' });
  limparSelecao();
  await marcarTutorialConcluido(usuario);
}

iniciar();
