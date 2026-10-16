/**
 * agenda.js — disponibilidade de horários, agendamento e cancelamento.
 *
 * Regras de negócio implementadas aqui:
 *  - cada professor atende no máximo 5 alunos por horário (aula em grupo);
 *  - aula individual ocupa o slot inteiro do professor;
 *  - o aluno não pode ter duas aulas no mesmo dia e horário;
 *  - agendar consome 1 crédito; cancelar devolve 1 crédito (uma vez só);
 *  - o aluno só cancela sozinho com antecedência mínima; professor e
 *    administrador cancelam a qualquer momento.
 *
 * Toda escrita passa por `transacao()` para que a checagem de vaga e a
 * gravação não sejam separadas por uma janela onde outro aluno entre.
 */

import { listar, transacao } from './store.js';
import { obterConfig, obterProfessores } from './precos.js';
import { lancarCredito, avaliarUsoNaData } from './creditos.js';
import { dataHoraDe, hojeISO, isoDeData } from './ui.js';

/* --------------------------------------------------------------------------
   Erros de negócio
   -------------------------------------------------------------------------- */

export class ErroAgenda extends Error {
  constructor(codigo, mensagem) {
    super(mensagem);
    this.name = 'ErroAgenda';
    this.codigo = codigo;
  }
}

/* --------------------------------------------------------------------------
   Consulta de disponibilidade
   -------------------------------------------------------------------------- */

/** Agendamentos confirmados de um dia. */
export async function agendamentosDoDia(data) {
  const doDia = await listar('agendamentos', { data });
  return doDia.filter((a) => a.status === 'confirmado');
}

/**
 * Monta a grade de um dia: cada professor ativo × cada horário.
 * Devolve uma lista de slots com a ocupação já calculada.
 */
export async function horariosDoDia(data, { tipo = 'grupo' } = {}) {
  const [config, professores, ocupacao] = await Promise.all([
    obterConfig(),
    obterProfessores(),
    agendamentosDoDia(data),
  ]);

  const agora = new Date();
  const slots = [];

  for (const horario of config.horarios) {
    for (const professor of professores) {
      const noSlot = ocupacao.filter(
        (a) => a.professorId === professor.id && a.horario === horario,
      );
      const temIndividual = noSlot.some((a) => a.tipo === 'individual');
      const ocupados = noSlot.length;
      const capacidade = config.capacidadeGrupo;
      const jaPassou = dataHoraDe(data, horario) <= agora;

      // Um slot com aula individual está bloqueado para qualquer outra pessoa.
      // Para marcar individual, o slot precisa estar completamente livre.
      const cheio = temIndividual || (tipo === 'individual' ? ocupados > 0 : ocupados >= capacidade);

      slots.push({
        professorId: professor.id,
        professorNome: professor.nome,
        horario,
        data,
        ocupados,
        capacidade,
        vagas: Math.max(0, capacidade - ocupados),
        temIndividual,
        cheio,
        jaPassou,
        disponivel: !cheio && !jaPassou,
        alunos: noSlot,
      });
    }
  }

  return slots;
}

/** Resumo de um dia, para pintar a célula do calendário. */
export async function resumoDoDia(data, { tipo = 'grupo' } = {}) {
  const slots = await horariosDoDia(data, { tipo });
  const disponiveis = slots.filter((s) => s.disponivel);
  return {
    data,
    totalSlots: slots.length,
    slotsDisponiveis: disponiveis.length,
    vagasTotais: disponiveis.reduce((t, s) => t + s.vagas, 0),
    temVaga: disponiveis.length > 0,
    todosPassaram: slots.every((s) => s.jaPassou),
  };
}

/**
 * Resumo de vários dias de uma vez (usado ao pintar o mês inteiro).
 * Faz uma única leitura da coleção e distribui por data, em vez de
 * N consultas — o calendário renderiza bem mais rápido.
 */
export async function resumoDoPeriodo(dataInicio, dataFim, { tipo = 'grupo' } = {}) {
  const [config, professores, todos] = await Promise.all([
    obterConfig(),
    obterProfessores(),
    listar('agendamentos', { data: { op: '>=', valor: dataInicio } }),
  ]);

  const confirmados = todos.filter((a) => a.status === 'confirmado' && a.data <= dataFim);

  // Índice: 'data|professorId|horario' -> agendamentos
  const indice = new Map();
  for (const ag of confirmados) {
    const chave = `${ag.data}|${ag.professorId}|${ag.horario}`;
    if (!indice.has(chave)) indice.set(chave, []);
    indice.get(chave).push(ag);
  }

  const agora = new Date();
  const resumos = new Map();

  const cursor = new Date(dataInicio.slice(0, 4), Number(dataInicio.slice(5, 7)) - 1, dataInicio.slice(8, 10));
  const fim = new Date(dataFim.slice(0, 4), Number(dataFim.slice(5, 7)) - 1, dataFim.slice(8, 10));

  while (cursor <= fim) {
    const data = isoDeData(cursor);
    let slotsDisponiveis = 0;
    let vagasTotais = 0;
    let slotsFuturos = 0;

    for (const horario of config.horarios) {
      const passou = dataHoraDe(data, horario) <= agora;
      if (!passou) slotsFuturos += 1;
      for (const professor of professores) {
        const noSlot = indice.get(`${data}|${professor.id}|${horario}`) || [];
        const temIndividual = noSlot.some((a) => a.tipo === 'individual');
        const cheio = temIndividual
          || (tipo === 'individual' ? noSlot.length > 0 : noSlot.length >= config.capacidadeGrupo);
        if (!cheio && !passou) {
          slotsDisponiveis += 1;
          vagasTotais += Math.max(0, config.capacidadeGrupo - noSlot.length);
        }
      }
    }

    resumos.set(data, {
      data,
      slotsDisponiveis,
      vagasTotais,
      temVaga: slotsDisponiveis > 0,
      todosPassaram: slotsFuturos === 0,
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  return resumos;
}

/* --------------------------------------------------------------------------
   Agendamento
   -------------------------------------------------------------------------- */

/**
 * Marca uma aula. Roda inteiramente dentro de uma transação:
 * valida data, capacidade, duplicidade e saldo; só então grava o
 * agendamento e debita o crédito.
 */
export async function agendar({ alunoId, alunoNome, professorId, data, horario, tipo = 'grupo', localId = null }) {
  const config = await obterConfig();

  return transacao(async (ops) => {
    // 1. Validações de entrada
    if (!config.horarios.includes(horario)) {
      throw new ErroAgenda('HORARIO_INVALIDO', 'Este horário não está mais disponível na grade da escola.');
    }
    if (data < hojeISO()) {
      throw new ErroAgenda('DATA_PASSADA', 'Não é possível agendar em uma data que já passou.');
    }
    if (dataHoraDe(data, horario) <= new Date()) {
      throw new ErroAgenda('HORARIO_PASSADO', 'Este horário já passou. Escolha outro.');
    }

    // 2. Capacidade do slot
    const doDia = await ops.listar('agendamentos', { data });
    const noSlot = doDia.filter(
      (a) => a.status === 'confirmado' && a.professorId === professorId && a.horario === horario,
    );

    if (noSlot.some((a) => a.tipo === 'individual')) {
      throw new ErroAgenda('SLOT_INDIVIDUAL', 'Este horário está reservado para uma aula particular.');
    }
    if (tipo === 'individual' && noSlot.length > 0) {
      throw new ErroAgenda('SLOT_OCUPADO', 'A aula individual exige o horário livre, e este já tem alunos. Escolha outro.');
    }
    if (tipo !== 'individual' && noSlot.length >= config.capacidadeGrupo) {
      throw new ErroAgenda('SLOT_LOTADO', `Esta turma já atingiu o limite de ${config.capacidadeGrupo} alunos. Escolha outro horário.`);
    }

    // 3. O aluno não pode estar em dois lugares ao mesmo tempo
    const conflito = doDia.find(
      (a) => a.status === 'confirmado' && a.alunoId === alunoId && a.horario === horario,
    );
    if (conflito) {
      throw new ErroAgenda('SLOT_DUPLICADO', 'Você já tem uma aula marcada neste dia e horário.');
    }

    // 4. Saldo e regras do crédito disponível
    const lancamentos = await ops.listar('creditos', { alunoId });
    const avaliacao = avaliarUsoNaData(lancamentos, data);

    if (!avaliacao.pode) {
      if (avaliacao.motivo === 'APENAS_FIM_DE_SEMANA') {
        throw new ErroAgenda(
          'APENAS_FIM_DE_SEMANA',
          'Seus créditos são do plano mensalista, válido apenas para sábado e domingo. Escolha um desses dias ou compre uma aula avulsa.',
        );
      }
      throw new ErroAgenda('SEM_CREDITOS', 'Você não tem créditos disponíveis. Compre um pacote para agendar.');
    }

    const lote = avaliacao.lote;

    // 5. Grava o agendamento e debita o crédito.
    // As condições do lote ficam registradas na aula para que um eventual
    // cancelamento devolva o crédito exatamente como estava.
    const agendamento = await ops.criar('agendamentos', {
      alunoId,
      alunoNome,
      professorId,
      data,
      horario,
      duracaoMin: config.duracaoMin,
      tipo,
      localId: localId || config.localPadraoId,
      status: 'confirmado',
      canceladoPor: null,
      motivoCancelamento: null,
      loteNomePacote: lote.nomePacote || null,
      lotePacoteId: lote.pacoteId || null,
      loteExpiraEm: lote.expiraEm || null,
      loteApenasFimDeSemana: lote.apenasFimDeSemana === true,
      criadoEm: new Date().toISOString(),
    });

    await lancarCredito(ops, {
      alunoId,
      delta: -1,
      motivo: 'agendamento',
      agendamentoId: agendamento.id,
    });

    return agendamento;
  });
}

/* --------------------------------------------------------------------------
   Cancelamento
   -------------------------------------------------------------------------- */

/**
 * Cancela uma aula e devolve o crédito.
 *
 * É idempotente: se a aula já estiver cancelada, não estorna de novo —
 * evita que dois cliques (ou duas abas) gerem crédito duplicado.
 *
 * `porQuem` = { id, nome, papel }
 */
export async function cancelar(agendamentoId, porQuem, motivo = null) {
  const config = await obterConfig();

  return transacao(async (ops) => {
    const agendamento = await ops.obter('agendamentos', agendamentoId);
    if (!agendamento) {
      throw new ErroAgenda('NAO_ENCONTRADO', 'Aula não encontrada.');
    }
    if (agendamento.status !== 'confirmado') {
      throw new ErroAgenda('JA_CANCELADA', 'Esta aula já foi cancelada ou concluída.');
    }

    const ehDono = agendamento.alunoId === porQuem.id;
    const ehEquipe = porQuem.papel === 'professor' || porQuem.papel === 'admin';
    if (!ehDono && !ehEquipe) {
      throw new ErroAgenda('SEM_PERMISSAO', 'Você não pode cancelar esta aula.');
    }

    // O aluno precisa respeitar a antecedência mínima; a equipe não.
    if (ehDono && !ehEquipe) {
      const horasAte = (dataHoraDe(agendamento.data, agendamento.horario) - Date.now()) / 3600000;
      if (horasAte < config.horasMinimasCancelamento) {
        throw new ErroAgenda(
          'PRAZO_EXPIRADO',
          `O cancelamento pelo site é permitido até ${config.horasMinimasCancelamento}h antes da aula. Fale com a escola pelo WhatsApp.`,
        );
      }
    }

    await ops.atualizar('agendamentos', agendamentoId, {
      status: 'cancelado',
      canceladoPor: porQuem.id,
      canceladoPorNome: porQuem.nome,
      canceladoPorPapel: porQuem.papel,
      motivoCancelamento: motivo,
      canceladoEm: new Date().toISOString(),
    });

    // O crédito volta com as MESMAS condições do lote que foi usado: se o
    // pacote tinha prazo ou era restrito a fim de semana, o estorno mantém
    // isso. Sem esse cuidado, cancelar viraria uma forma de converter um
    // crédito com validade em um crédito eterno e irrestrito.
    await lancarCredito(ops, {
      alunoId: agendamento.alunoId,
      delta: 1,
      motivo: 'cancelamento',
      agendamentoId,
      observacao: motivo,
      nomePacote: agendamento.loteNomePacote || null,
      pacoteId: agendamento.lotePacoteId || null,
      tipoPacote: agendamento.tipo === 'individual' ? 'individual' : 'grupo',
      apenasFimDeSemana: agendamento.loteApenasFimDeSemana === true,
      expiraEm: agendamento.loteExpiraEm || null,
    });

    return { ...agendamento, status: 'cancelado' };
  });
}

/**
 * Cancela todas as aulas confirmadas de um slot (professor + data + horário).
 * Usado quando o professor cancela a turma inteira por condição do mar.
 */
export async function cancelarTurma({ professorId, data, horario }, porQuem, motivo = null) {
  const doDia = await listar('agendamentos', { data });
  const doSlot = doDia.filter(
    (a) => a.status === 'confirmado' && a.professorId === professorId && a.horario === horario,
  );

  const resultados = [];
  for (const aula of doSlot) {
    try {
      await cancelar(aula.id, porQuem, motivo);
      resultados.push({ id: aula.id, ok: true });
    } catch (err) {
      resultados.push({ id: aula.id, ok: false, erro: err.message });
    }
  }
  return resultados;
}

/* --------------------------------------------------------------------------
   Consultas por pessoa
   -------------------------------------------------------------------------- */

/** Próximas aulas confirmadas do aluno, da mais próxima para a mais distante. */
export async function proximasAulasDoAluno(alunoId, limite = null) {
  const todas = await listar('agendamentos', { alunoId, status: 'confirmado' });
  const hoje = hojeISO();
  const futuras = todas
    .filter((a) => a.data >= hoje)
    .sort((a, b) => (a.data === b.data ? a.horario.localeCompare(b.horario) : a.data.localeCompare(b.data)));
  return limite ? futuras.slice(0, limite) : futuras;
}

/** Histórico completo do aluno, do mais recente para o mais antigo. */
export async function historicoDoAluno(alunoId) {
  const todas = await listar('agendamentos', { alunoId });
  return todas.sort((a, b) => (a.data === b.data
    ? b.horario.localeCompare(a.horario)
    : b.data.localeCompare(a.data)));
}

/**
 * Turmas de um dia agrupadas por horário e professor — a visão que o
 * painel do professor usa.
 * `professorId` null mostra todos (visão do administrador).
 */
export async function turmasDoDia(data, professorId = null) {
  const slots = await horariosDoDia(data);
  const filtrados = professorId ? slots.filter((s) => s.professorId === professorId) : slots;
  return filtrados.sort((a, b) => (a.horario === b.horario
    ? a.professorNome.localeCompare(b.professorNome)
    : a.horario.localeCompare(b.horario)));
}

/** Marca como realizadas as aulas confirmadas cujo horário já passou. */
export async function fecharAulasPassadas() {
  const todas = await listar('agendamentos', { status: 'confirmado' });
  const agora = new Date();
  let fechadas = 0;
  for (const aula of todas) {
    const fim = dataHoraDe(aula.data, aula.horario);
    fim.setMinutes(fim.getMinutes() + (aula.duracaoMin || 90));
    if (fim < agora) {
      await transacao((ops) => ops.atualizar('agendamentos', aula.id, { status: 'realizado' }));
      fechadas += 1;
    }
  }
  return fechadas;
}
