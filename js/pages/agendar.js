/**
 * agendar.js — calendário e escolha de horário.
 *
 * O calendário é montado com Date nativo (sem biblioteca). A ocupação do mês
 * inteiro vem de uma única consulta (resumoDoPeriodo), e só o dia selecionado
 * carrega o detalhe por professor.
 */

import { exigirAuth, sair } from '../auth.js';
import { lotesVigentes, diasAteVencer } from '../creditos.js';
import { listar } from '../store.js';
import { horariosDoDia, resumoDoPeriodo, agendar, ErroAgenda } from '../agenda.js';
import { carregarContexto, nomeLocal } from '../precos.js';
import {
  qs, el, isoDeData, hojeISO, dataDeISO, formatarDataExtenso, faixaHorario,
  MESES, SEMANA_CURTO, montarShellPainel, toast, botaoCarregando, abrirModal, escapar,
  paramUrl,
} from '../ui.js';
import { executarTour, passosAgendamento, marcarTutorialConcluido } from '../tutorial.js';

let usuario = null;
let contexto = null;
let saldo = 0;
/** true quando todos os créditos do aluno são restritos a sábado/domingo. */
let soFimDeSemana = false;

let mesVisivel = new Date();
let diaSelecionado = null;
let slotSelecionado = null;
let tipoAula = 'grupo';
let resumosDoMes = new Map();

/* --------------------------------------------------------------------------
   Calendário
   -------------------------------------------------------------------------- */

async function montarCalendario() {
  const grade = qs('#calendario');
  const ano = mesVisivel.getFullYear();
  const mes = mesVisivel.getMonth();

  qs('#mes-atual').textContent = `${MESES[mes]} de ${ano}`;

  // Não deixa navegar para meses que já passaram.
  const hoje = new Date();
  const ehMesAtual = ano === hoje.getFullYear() && mes === hoje.getMonth();
  qs('#mes-anterior').disabled = ehMesAtual;

  grade.innerHTML = '';
  SEMANA_CURTO.forEach((dia) => {
    grade.append(el('div', { class: 'cab-dia', text: dia }));
  });

  const primeiroDia = new Date(ano, mes, 1);
  const ultimoDia = new Date(ano, mes + 1, 0);

  // Carrega a ocupação do mês de uma vez só.
  grade.append(el('div', {
    class: 'vazio',
    style: 'grid-column:1/-1',
    html: '<span class="spinner escuro"></span>',
  }));

  resumosDoMes = await resumoDoPeriodo(
    isoDeData(primeiroDia),
    isoDeData(ultimoDia),
    { tipo: tipoAula },
  );

  // Redesenha já com os dados.
  grade.innerHTML = '';
  SEMANA_CURTO.forEach((dia) => grade.append(el('div', { class: 'cab-dia', text: dia })));

  // Espaços vazios até o primeiro dia do mês cair no dia da semana certo.
  for (let i = 0; i < primeiroDia.getDay(); i += 1) {
    grade.append(el('div', { class: 'dia-cel vazio' }));
  }

  const hojeIso = hojeISO();

  for (let dia = 1; dia <= ultimoDia.getDate(); dia += 1) {
    const data = new Date(ano, mes, dia);
    const iso = isoDeData(data);
    const resumo = resumosDoMes.get(iso);

    const passou = iso < hojeIso;
    const semVagas = resumo ? !resumo.temVaga : true;
    // Créditos de plano mensal só valem sábado e domingo.
    const diaDaSemana = data.getDay();
    const bloqueadoPorPlano = soFimDeSemana && diaDaSemana !== 0 && diaDaSemana !== 6;
    const indisponivel = passou || semVagas || bloqueadoPorPlano;

    const cel = el('button', {
      type: 'button',
      class: [
        'dia-cel',
        indisponivel ? 'indisponivel' : 'disponivel',
        iso === hojeIso ? 'hoje' : '',
        iso === diaSelecionado ? 'selecionado' : '',
        !passou && semVagas ? 'lotado-total' : '',
      ].filter(Boolean).join(' '),
      disabled: indisponivel,
      title: bloqueadoPorPlano ? 'Seu plano é válido apenas aos sábados e domingos' : '',
      'aria-label': `${dia} de ${MESES[mes]}${
        bloqueadoPorPlano ? ' — indisponível: seu plano vale só no fim de semana'
          : indisponivel ? ' — indisponível'
            : `, ${resumo?.vagasTotais || 0} vagas`}`,
      dataset: { data: iso },
    }, [el('span', { text: String(dia) })]);

    if (!indisponivel) {
      cel.append(el('span', { class: 'ponto' }));
      cel.addEventListener('click', () => selecionarDia(iso));
    }

    grade.append(cel);
  }
}

/* --------------------------------------------------------------------------
   Horários do dia
   -------------------------------------------------------------------------- */

async function selecionarDia(iso) {
  diaSelecionado = iso;
  slotSelecionado = null;
  qs('#area-confirmacao').classList.add('oculto');

  // Marca a célula sem redesenhar o mês inteiro.
  qs('#calendario').querySelectorAll('.dia-cel').forEach((cel) => {
    cel.classList.toggle('selecionado', cel.dataset.data === iso);
  });

  const texto = formatarDataExtenso(iso, true);
  qs('#dia-selecionado').textContent = texto.charAt(0).toUpperCase() + texto.slice(1);

  const alvo = qs('#lista-slots');
  alvo.innerHTML = '<div class="vazio"><span class="spinner escuro"></span></div>';

  try {
    const slots = await horariosDoDia(iso, { tipo: tipoAula });
    montarSlots(slots);
  } catch (err) {
    console.error('[agendar] falha ao carregar horários:', err);
    alvo.innerHTML = '<div class="vazio">Não foi possível carregar os horários.</div>';
  }
}

function montarSlots(slots) {
  const alvo = qs('#lista-slots');
  alvo.innerHTML = '';

  const utilizaveis = slots.filter((s) => !s.jaPassou);

  if (!utilizaveis.length) {
    alvo.innerHTML = '<div class="vazio"><span class="vazio-icone">🌙</span><p>Não há mais horários disponíveis neste dia.</p></div>';
    return;
  }

  // Agrupa por horário para a lista ficar cronológica.
  const porHorario = new Map();
  for (const slot of utilizaveis) {
    if (!porHorario.has(slot.horario)) porHorario.set(slot.horario, []);
    porHorario.get(slot.horario).push(slot);
  }

  for (const [horario, doHorario] of porHorario) {
    for (const slot of doHorario) {
      const local = nomeLocal(contexto.mapaLocais, contexto.config.localPadraoId);
      const percentual = (slot.ocupados / slot.capacidade) * 100;
      const classeBarra = slot.cheio ? 'cheio' : percentual >= 60 ? 'medio' : '';

      const botao = el('button', {
        type: 'button',
        class: `slot ${slot.cheio ? 'lotado' : ''}`,
        disabled: slot.cheio,
        dataset: { professor: slot.professorId, horario },
      }, [
        el('span', { class: 'hora', text: horario }),
        el('div', { class: 'detalhe' }, [
          el('div', { class: 'prof', text: `Prof. ${slot.professorNome}` }),
          el('div', {
            class: 'local',
            text: `${faixaHorario(horario, contexto.config.duracaoMin)} · ${local}`,
          }),
          el('div', { class: 'vagas-barra' }, [
            el('div', {
              class: `preenchido ${classeBarra}`,
              style: `width:${Math.min(100, percentual)}%`,
            }),
          ]),
        ]),
        el('span', {
          class: `badge ${slot.cheio ? 'badge-perigo' : slot.vagas <= 2 ? 'badge-aviso' : 'badge-sucesso'}`,
          text: slot.cheio
            ? 'LOTADO'
            : tipoAula === 'individual' ? 'LIVRE' : `${slot.ocupados}/${slot.capacidade}`,
        }),
      ]);

      if (!slot.cheio) {
        botao.addEventListener('click', () => selecionarSlot(slot, botao));
      }

      alvo.append(botao);
    }
  }
}

function selecionarSlot(slot, botao) {
  slotSelecionado = slot;
  qs('#lista-slots').querySelectorAll('.slot').forEach((s) => s.classList.remove('selecionado'));
  botao.classList.add('selecionado');
  qs('#area-confirmacao').classList.remove('oculto');
  qs('#btn-confirmar').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* --------------------------------------------------------------------------
   Confirmação
   -------------------------------------------------------------------------- */

async function confirmarAgendamento() {
  if (!slotSelecionado || !diaSelecionado) {
    toast('Escolha um dia e um horário.', 'aviso');
    return;
  }

  if (saldo < 1) {
    mostrarSemCreditos();
    return;
  }

  const btn = qs('#btn-confirmar');
  const restaurar = botaoCarregando(btn, 'Agendando...');

  try {
    await agendar({
      alunoId: usuario.id,
      alunoNome: usuario.nome,
      professorId: slotSelecionado.professorId,
      data: diaSelecionado,
      horario: slotSelecionado.horario,
      tipo: tipoAula,
      localId: contexto.config.localPadraoId,
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
          {
            texto: 'Ver planos',
            classe: 'btn-primario',
            onClick: () => { location.href = 'checkout.html'; },
          },
        ],
      });
      return;
    }

    toast(err instanceof ErroAgenda ? err.message : 'Não foi possível agendar.', 'erro', 6000);
    console.error('[agendar] erro ao agendar:', err);

    // Estado pode ter mudado (alguém pegou a última vaga): recarrega o dia.
    await selecionarDia(diaSelecionado);
    await atualizarSaldo();
  }
}

function mostrarSemCreditos() {
  abrirModal({
    titulo: 'Você está sem créditos',
    corpo: `
      <p>Para agendar uma aula é preciso ter pelo menos 1 crédito disponível.</p>
      <p class="mt-16 texto-cinza texto-peq">
        Escolha um pacote — o crédito entra na sua conta assim que o pagamento
        for confirmado.
      </p>`,
    botoes: [
      { texto: 'Agora não', classe: 'btn-claro' },
      {
        texto: 'Ver planos',
        classe: 'btn-primario',
        onClick: () => { location.href = 'checkout.html'; },
      },
    ],
  });
}

/* --------------------------------------------------------------------------
   Saldo
   -------------------------------------------------------------------------- */

async function atualizarSaldo() {
  const lancamentos = await listar('creditos', { alunoId: usuario.id });
  const lotes = lotesVigentes(lancamentos);
  saldo = lotes.reduce((t, l) => t + l.restante, 0);

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
        <span>🎟️</span>
        <span class="cresce">
          Você não tem créditos disponíveis. É possível ver os horários, mas
          para confirmar o agendamento é preciso comprar um pacote.
        </span>
        <a href="checkout.html" class="negrito">Comprar →</a>
      </div>`;
    return;
  }

  if (soFimDeSemana) {
    alerta.innerHTML = `
      <div class="alerta alerta-info">
        <span>📅</span>
        <span class="cresce">
          Seus créditos são do <strong>plano mensalista</strong>, válido
          apenas para <strong>sábado e domingo</strong>. Os demais dias
          aparecem indisponíveis no calendário.
        </span>
      </div>`;
  }

  // Avisa quando há crédito perto de vencer.
  const proximo = lotes
    .filter((l) => l.expiraEm)
    .sort((a, b) => String(a.expiraEm).localeCompare(String(b.expiraEm)))[0];

  if (proximo) {
    const dias = diasAteVencer(proximo.expiraEm);
    if (dias !== null && dias <= 7) {
      alerta.insertAdjacentHTML('beforeend', `
        <div class="alerta alerta-aviso">
          <span>⏳</span>
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

  contexto = await carregarContexto();
  await atualizarSaldo();

  qs('#mes-anterior').addEventListener('click', async () => {
    mesVisivel = new Date(mesVisivel.getFullYear(), mesVisivel.getMonth() - 1, 1);
    await montarCalendario();
  });

  qs('#mes-proximo').addEventListener('click', async () => {
    mesVisivel = new Date(mesVisivel.getFullYear(), mesVisivel.getMonth() + 1, 1);
    await montarCalendario();
  });

  qs('#tipo-aula').addEventListener('change', async (ev) => {
    tipoAula = ev.target.value;
    slotSelecionado = null;
    qs('#area-confirmacao').classList.add('oculto');
    await montarCalendario();
    if (diaSelecionado) await selecionarDia(diaSelecionado);
  });

  qs('#btn-confirmar').addEventListener('click', confirmarAgendamento);

  await montarCalendario();

  // Já abre no primeiro dia com vaga, para poupar um clique.
  const primeiroComVaga = Array.from(resumosDoMes.values())
    .find((r) => r.temVaga && r.data >= hojeISO());
  if (primeiroComVaga) await selecionarDia(primeiroComVaga.data);

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
    slotSelecionado = null;
    qs('#lista-slots').querySelectorAll('.slot.selecionado')
      .forEach((s) => s.classList.remove('selecionado'));
    qs('#area-confirmacao').classList.add('oculto');
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
  // Se o aluno saiu no meio, a seleção de exemplo não pode ficar para trás.
  limparSelecao();
  await marcarTutorialConcluido(usuario);
}

iniciar();
