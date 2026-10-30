/**
 * agenda.js — disponibilidade de horários, agendamento e cancelamento.
 *
 * Regras de negócio:
 *  - cada professor atende no máximo 5 alunos por horário (aula em grupo);
 *  - aula particular ocupa o horário inteiro do professor;
 *  - só se agenda em horários da disponibilidade do professor;
 *  - o aluno não pode ter duas aulas no mesmo dia e horário;
 *  - agendar consome 1 crédito; cancelar devolve 1 crédito (uma vez só);
 *  - o aluno só cancela sozinho com antecedência mínima; a equipe sempre.
 *
 * LOTAÇÃO PÚBLICA, AGENDAMENTOS PRIVADOS
 * O aluno precisa ver quantas vagas restam em cada turma, mas não pode ler
 * os agendamentos dos colegas (nome, horários). Por isso a lotação vive num
 * documento à parte por turma — coleção `vagas`, id `data_professor_hora` —
 * que guarda só números. O calendário do aluno lê `vagas`; a lista de
 * alunos de cada turma (agendamentos) continua visível apenas à equipe.
 *
 * O documento de vaga é atualizado na mesma transação do agendamento ou do
 * cancelamento. No Firebase a transação é real: se dois alunos disputam a
 * última vaga, o Firestore refaz a operação de um deles com o valor novo.
 */

import { listar, transacao } from './store.js';
import { obterConfig, obterProfessores } from './precos.js';
import { lancarCredito, avaliarUsoNaData } from './creditos.js';
import { mapaDisponibilidades, horariosNoDia, normalizarDisponibilidade } from './disponibilidade.js';
import { dataHoraDe, hojeISO, isoDeData, dataDeISO } from './ui.js';

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
   Documento de vaga (lotação de uma turma)
   -------------------------------------------------------------------------- */

/** '2026-10-30', 'prof-igor', '08:00' -> '2026-10-30_prof-igor_0800' */
export const idVaga = (data, professorId, horario) =>
  `${data}_${professorId}_${String(horario).replace(':', '')}`;

/** Cria ou atualiza o documento de vaga dentro de uma transação. */
function gravarVaga(ops, existente, id, campos) {
  return existente
    ? ops.atualizar('vagas', id, campos)
    : ops.criar('vagas', { id, ...campos });
}

/* --------------------------------------------------------------------------
   Montagem dos horários (visão do aluno)
   -------------------------------------------------------------------------- */

/**
 * Estado de uma turma para quem vai agendar. Traz as duas leituras ao mesmo
 * tempo — em grupo e particular — para a tela mostrar o que o aluno pediu.
 */
function montarSlot({ data, professor, horario, localId, vaga, capacidade, agora }) {
  const ocupados = Number(vaga?.ocupados) || 0;
  const individual = vaga?.individual === true && ocupados > 0;
  const jaPassou = dataHoraDe(data, horario) <= agora;
  const grupoLotado = individual || ocupados >= capacidade;
  const particularLivre = ocupados === 0;

  return {
    data,
    horario,
    localId,
    professorId: professor.id,
    professorNome: professor.nome,
    ocupados,
    capacidade,
    vagas: individual ? 0 : Math.max(0, capacidade - ocupados),
    individual,
    jaPassou,
    grupoLotado,
    particularLivre,
    disponivelGrupo: !jaPassou && !grupoLotado,
    disponivelParticular: !jaPassou && particularLivre,
  };
}

/** Professores ativos, configuração e disponibilidades — tudo que é público. */
async function carregarBase() {
  const [config, professores] = await Promise.all([obterConfig(), obterProfessores()]);
  const disponibilidades = await mapaDisponibilidades(professores, config);
  return { config, professores, disponibilidades };
}

/** Documentos de vaga de um intervalo de datas: Map id -> vaga. */
async function vagasDoPeriodo(dataInicio, dataFim) {
  const docs = await listar('vagas', { data: { op: '>=', valor: dataInicio } });
  return new Map(docs.filter((v) => v.data <= dataFim).map((v) => [v.id, v]));
}

function slotsDaData(data, base, vagas, agora) {
  const slots = [];
  for (const professor of base.professores) {
    const disp = base.disponibilidades.get(professor.id);
    for (const { horario, localId } of horariosNoDia(disp, data, base.config)) {
      slots.push(montarSlot({
        data,
        professor,
        horario,
        localId,
        vaga: vagas.get(idVaga(data, professor.id, horario)),
        capacidade: base.config.capacidadeGrupo,
        agora,
      }));
    }
  }
  return slots.sort((a, b) => (a.horario === b.horario
    ? a.professorNome.localeCompare(b.professorNome)
    : a.horario.localeCompare(b.horario)));
}

/**
 * Horários de um dia, por professor, com a lotação de cada turma.
 * Seguro para o aluno: lê apenas `vagas`, nunca os agendamentos alheios.
 * `tipo` define o que conta como disponível em `disponivel`/`cheio`.
 */
export async function horariosDoDia(data, { tipo = 'grupo' } = {}) {
  const [base, vagas] = await Promise.all([carregarBase(), vagasDoPeriodo(data, data)]);
  return slotsDaData(data, base, vagas, new Date()).map((s) => ({
    ...s,
    disponivel: tipo === 'individual' ? s.disponivelParticular : s.disponivelGrupo,
    cheio: tipo === 'individual' ? !s.particularLivre : s.grupoLotado,
  }));
}

/**
 * Resumo de cada dia do intervalo, para pintar o calendário: se há vaga,
 * quantas, e quais horários e locais estão abertos.
 */
export async function resumoDoPeriodo(dataInicio, dataFim, { tipo = 'grupo' } = {}) {
  const [base, vagas] = await Promise.all([carregarBase(), vagasDoPeriodo(dataInicio, dataFim)]);
  const agora = new Date();
  const resumos = new Map();

  const cursor = dataDeISO(dataInicio);
  const fim = dataDeISO(dataFim);

  while (cursor <= fim) {
    const data = isoDeData(cursor);
    const slots = slotsDaData(data, base, vagas, agora);
    const abertos = slots.filter((s) => (tipo === 'individual' ? s.disponivelParticular : s.disponivelGrupo));

    resumos.set(data, {
      data,
      slotsDisponiveis: abertos.length,
      vagasTotais: abertos.reduce((t, s) => t + (tipo === 'individual' ? 1 : s.vagas), 0),
      temVaga: abertos.length > 0,
      todosPassaram: slots.length > 0 && slots.every((s) => s.jaPassou),
      horarios: [...new Set(abertos.map((s) => s.horario))],
      locais: [...new Set(abertos.map((s) => s.localId))],
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  return resumos;
}

/* --------------------------------------------------------------------------
   Agendamento
   -------------------------------------------------------------------------- */

/**
 * Marca uma aula numa transação: valida data, disponibilidade do professor,
 * lotação, duplicidade e saldo; só então grava a aula, atualiza a vaga e
 * debita o crédito. Todas as leituras vêm antes de qualquer escrita, como o
 * Firestore exige.
 */
export async function agendar({ alunoId, alunoNome, professorId, data, horario, tipo = 'grupo' }) {
  const config = await obterConfig();

  return transacao(async (ops) => {
    // 1. Data e horário
    if (!config.horarios.includes(horario)) {
      throw new ErroAgenda('HORARIO_INVALIDO', 'Este horário não está mais disponível na grade da escola.');
    }
    if (data < hojeISO()) {
      throw new ErroAgenda('DATA_PASSADA', 'Não é possível agendar em uma data que já passou.');
    }
    if (dataHoraDe(data, horario) <= new Date()) {
      throw new ErroAgenda('HORARIO_PASSADO', 'Este horário já passou. Escolha outro.');
    }

    // 2. Professor ativo e atendendo nesse dia e horário
    const professor = await ops.obter('professores', professorId);
    if (!professor || professor.ativo === false || professor.removido) {
      throw new ErroAgenda('PROFESSOR_INDISPONIVEL', 'Este professor não está atendendo no momento.');
    }
    const disp = normalizarDisponibilidade(await ops.obter('disponibilidade', professorId), professorId, config);
    const slot = horariosNoDia(disp, data, config).find((s) => s.horario === horario);
    if (!slot) {
      throw new ErroAgenda('FORA_DA_DISPONIBILIDADE', 'O professor não atende neste dia e horário. Escolha outro.');
    }

    // 3. Lotação — lida pela transação
    const idDaVaga = idVaga(data, professorId, horario);
    const vaga = await ops.obter('vagas', idDaVaga);
    const ocupados = Number(vaga?.ocupados) || 0;
    const temIndividual = vaga?.individual === true && ocupados > 0;

    if (temIndividual) {
      throw new ErroAgenda('SLOT_INDIVIDUAL', 'Este horário está reservado para uma aula particular.');
    }
    if (tipo === 'individual' && ocupados > 0) {
      throw new ErroAgenda('SLOT_OCUPADO', 'A aula particular exige o horário livre, e este já tem alunos. Escolha outro.');
    }
    if (tipo !== 'individual' && ocupados >= config.capacidadeGrupo) {
      throw new ErroAgenda('SLOT_LOTADO', `Esta turma já atingiu o limite de ${config.capacidadeGrupo} alunos. Escolha outro horário.`);
    }

    // 4. O aluno não pode estar em dois lugares ao mesmo tempo
    const minhasNoDia = await ops.listar('agendamentos', { alunoId, data });
    if (minhasNoDia.some((a) => a.status === 'confirmado' && a.horario === horario)) {
      throw new ErroAgenda('SLOT_DUPLICADO', 'Você já tem uma aula marcada neste dia e horário.');
    }

    // 5. Saldo e regras do crédito
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

    // 6. Escritas
    const agendamento = await ops.criar('agendamentos', {
      alunoId,
      alunoNome,
      professorId,
      data,
      horario,
      duracaoMin: config.duracaoMin,
      tipo,
      localId: slot.localId,
      status: 'confirmado',
      canceladoPor: null,
      motivoCancelamento: null,
      loteNomePacote: lote.nomePacote || null,
      lotePacoteId: lote.pacoteId || null,
      loteExpiraEm: lote.expiraEm || null,
      loteApenasFimDeSemana: lote.apenasFimDeSemana === true,
      criadoEm: new Date().toISOString(),
    });

    await gravarVaga(ops, vaga, idDaVaga, {
      data,
      professorId,
      horario,
      ocupados: ocupados + 1,
      individual: tipo === 'individual',
      // As regras do Firestore conferem este agendamento para aceitar a
      // alteração feita por um aluno (veja firestore.rules, coleção vagas).
      ultimoAgendamento: agendamento.id,
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
 * Cancela uma aula, libera a vaga e devolve o crédito.
 * Idempotente: aula já cancelada não gera um segundo estorno.
 * `porQuem` = { id, nome, papel }
 */
export async function cancelar(agendamentoId, porQuem, motivo = null) {
  const config = await obterConfig();

  return transacao(async (ops) => {
    const agendamento = await ops.obter('agendamentos', agendamentoId);
    if (!agendamento) throw new ErroAgenda('NAO_ENCONTRADO', 'Aula não encontrada.');
    if (agendamento.status !== 'confirmado') {
      throw new ErroAgenda('JA_CANCELADA', 'Esta aula já foi cancelada ou concluída.');
    }

    const ehDono = agendamento.alunoId === porQuem.id;
    const ehEquipe = porQuem.papel === 'professor' || porQuem.papel === 'admin';
    if (!ehDono && !ehEquipe) throw new ErroAgenda('SEM_PERMISSAO', 'Você não pode cancelar esta aula.');

    if (ehDono && !ehEquipe) {
      const horasAte = (dataHoraDe(agendamento.data, agendamento.horario) - Date.now()) / 3600000;
      if (horasAte < config.horasMinimasCancelamento) {
        throw new ErroAgenda(
          'PRAZO_EXPIRADO',
          `O cancelamento pelo site é permitido até ${config.horasMinimasCancelamento}h antes da aula. Fale com a escola pelo WhatsApp.`,
        );
      }
    }

    const idDaVaga = idVaga(agendamento.data, agendamento.professorId, agendamento.horario);
    const vaga = await ops.obter('vagas', idDaVaga);

    // --- escritas ---
    await ops.atualizar('agendamentos', agendamentoId, {
      status: 'cancelado',
      canceladoPor: porQuem.id,
      canceladoPorNome: porQuem.nome,
      canceladoPorPapel: porQuem.papel,
      motivoCancelamento: motivo,
      canceladoEm: new Date().toISOString(),
    });

    // Sem documento de vaga (aula anterior a este controle) não há o que
    // descontar; com contagem já zerada, também não.
    if (vaga && Number(vaga.ocupados) > 0) {
      const restantes = Number(vaga.ocupados) - 1;
      await gravarVaga(ops, vaga, idDaVaga, {
        ocupados: restantes,
        individual: restantes > 0 && vaga.individual === true && agendamento.tipo !== 'individual',
        ultimoAgendamento: agendamentoId,
      });
    }

    // O crédito volta com as MESMAS condições do lote usado (prazo e
    // restrição de dia): cancelar não pode virar um jeito de "renovar" crédito.
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

/** Cancela todas as aulas de uma turma (ex.: mar sem condições). Só a equipe. */
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

export async function proximasAulasDoAluno(alunoId, limite = null) {
  const todas = await listar('agendamentos', { alunoId, status: 'confirmado' });
  const hoje = hojeISO();
  const futuras = todas
    .filter((a) => a.data >= hoje)
    .sort((a, b) => (a.data === b.data ? a.horario.localeCompare(b.horario) : a.data.localeCompare(b.data)));
  return limite ? futuras.slice(0, limite) : futuras;
}

export async function historicoDoAluno(alunoId) {
  const todas = await listar('agendamentos', { alunoId });
  return todas.sort((a, b) => (a.data === b.data
    ? b.horario.localeCompare(a.horario)
    : b.data.localeCompare(a.data)));
}

/* --------------------------------------------------------------------------
   Visão da equipe
   -------------------------------------------------------------------------- */

/**
 * Turmas de um dia com a lista de alunos — só para a equipe (lê os
 * agendamentos). Inclui horários fora da disponibilidade que tenham aula
 * marcada, sinalizados, para nenhum aluno "sumir" da agenda do professor.
 * `professorId` null mostra todos (visão do administrador).
 */
export async function turmasDoDia(data, professorId = null) {
  const [base, doDia] = await Promise.all([carregarBase(), listar('agendamentos', { data })]);
  const confirmados = doDia.filter((a) => a.status === 'confirmado');
  const agora = new Date();
  const capacidade = base.config.capacidadeGrupo;
  const professores = professorId ? base.professores.filter((p) => p.id === professorId) : base.professores;

  const turmas = [];
  for (const professor of professores) {
    const disponiveis = horariosNoDia(base.disponibilidades.get(professor.id), data, base.config);
    const daAgenda = confirmados.filter((a) => a.professorId === professor.id);
    const horarios = new Set([...disponiveis.map((s) => s.horario), ...daAgenda.map((a) => a.horario)]);

    for (const horario of [...horarios].sort()) {
      const alunos = daAgenda.filter((a) => a.horario === horario);
      const noHorario = disponiveis.find((s) => s.horario === horario);
      const individual = alunos.some((a) => a.tipo === 'individual');
      turmas.push({
        data,
        horario,
        professorId: professor.id,
        professorNome: professor.nome,
        localId: noHorario?.localId || alunos[0]?.localId || base.config.localPadraoId,
        alunos,
        ocupados: alunos.length,
        capacidade,
        vagas: individual ? 0 : Math.max(0, capacidade - alunos.length),
        individual,
        cheio: individual || alunos.length >= capacidade,
        jaPassou: dataHoraDe(data, horario) <= agora,
        foraDaDisponibilidade: !noHorario,
      });
    }
  }

  return turmas.sort((a, b) => (a.horario === b.horario
    ? a.professorNome.localeCompare(b.professorNome)
    : a.horario.localeCompare(b.horario)));
}

/**
 * Recalcula a coleção `vagas` a partir dos agendamentos confirmados de hoje
 * em diante. Necessário uma vez no site já publicado (as aulas marcadas
 * antes deste controle não têm contagem) e útil se algo sair do lugar.
 * Só a equipe pode rodar — o aluno não lê os agendamentos alheios.
 */
export async function recalcularVagas() {
  const hoje = hojeISO();
  const [confirmados, existentes] = await Promise.all([
    listar('agendamentos', { status: 'confirmado' }),
    listar('vagas', { data: { op: '>=', valor: hoje } }),
  ]);

  const contagem = new Map();
  for (const a of confirmados) {
    if (a.data < hoje) continue;
    const id = idVaga(a.data, a.professorId, a.horario);
    const atual = contagem.get(id) || {
      data: a.data, professorId: a.professorId, horario: a.horario, ocupados: 0, individual: false,
    };
    atual.ocupados += 1;
    if (a.tipo === 'individual') atual.individual = true;
    contagem.set(id, atual);
  }

  const porId = new Map(existentes.map((v) => [v.id, v]));
  let corrigidas = 0;

  await transacao(async (ops) => {
    for (const [id, campos] of contagem) {
      const atual = porId.get(id);
      if (atual && atual.ocupados === campos.ocupados && atual.individual === campos.individual) continue;
      await gravarVaga(ops, atual, id, { ...campos, ultimoAgendamento: null });
      corrigidas += 1;
    }
    // Vagas que ainda marcam alunos, mas já não têm nenhuma aula confirmada.
    for (const [id, atual] of porId) {
      if (contagem.has(id) || !Number(atual.ocupados)) continue;
      await ops.atualizar('vagas', id, { ocupados: 0, individual: false, ultimoAgendamento: null });
      corrigidas += 1;
    }
  });

  return { turmas: contagem.size, corrigidas };
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
