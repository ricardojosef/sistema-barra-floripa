/**
 * agenda.js — disponibilidade de horários, agendamento, cancelamento,
 * atribuição de professor e presença.
 *
 * Regras de negócio:
 *  - cada professor atende no máximo N alunos por horário (config.capacidadeGrupo);
 *  - aula particular ocupa o horário inteiro do professor;
 *  - O ALUNO NÃO ESCOLHE PROFESSOR: escolhe dia, horário e praia. A vaga do
 *    horário é a soma das vagas dos professores que atendem ali, e o sistema
 *    atribui um deles internamente. O administrador pode trocar o professor
 *    de qualquer aula depois (reatribuirProfessor) — o aluno nunca vê quem é;
 *  - o aluno não pode ter duas aulas no mesmo dia e horário;
 *  - agendar consome 1 crédito; cancelar devolve 1 crédito (uma vez só);
 *  - o aluno só cancela sozinho com antecedência mínima; a equipe sempre;
 *  - datas marcadas como "sem aula" por um aviso (tempestade...) não aceitam
 *    agendamento (config.diasSemAula).
 *
 * LOTAÇÃO PÚBLICA, AGENDAMENTOS PRIVADOS
 * A lotação vive num documento por turma de professor — coleção `vagas`, id
 * `data_professor_hora` — que guarda só números. O calendário (inclusive o
 * público, antes do login) lê `vagas` e soma por horário; a lista de alunos
 * de cada turma (agendamentos) continua visível apenas à equipe.
 *
 * O documento de vaga é atualizado na mesma transação do agendamento ou do
 * cancelamento. No Firebase a transação é real: se dois alunos disputam a
 * última vaga, o Firestore refaz a operação de um deles com o valor novo.
 */

import { listar, transacao } from './store.js';
import { obterConfig, obterProfessores, bloqueioDoDia } from './precos.js';
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
   Documento de vaga (lotação de uma turma de professor)
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

/** Chave pública de um horário: o que o aluno escolhe (sem professor). */
export const chaveHorario = (horario, localId) => `${horario}|${localId || ''}`;

/* --------------------------------------------------------------------------
   Base pública: professores, configuração e disponibilidades
   -------------------------------------------------------------------------- */

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

/** Estado de UMA turma de professor (uso interno e da equipe). */
function montarTurmaProfessor({ data, professor, horario, localId, vaga, capacidade, agora }) {
  const ocupados = Number(vaga?.ocupados) || 0;
  const individual = vaga?.individual === true && ocupados > 0;
  return {
    data,
    horario,
    localId,
    professorId: professor.id,
    professorNome: professor.nome,
    ordem: professor.ordem ?? 99,
    ocupados,
    capacidade,
    individual,
    vagas: individual ? 0 : Math.max(0, capacidade - ocupados),
    particularLivre: ocupados === 0,
    jaPassou: dataHoraDe(data, horario) <= agora,
  };
}

function turmasDaData(data, base, vagas, agora) {
  const turmas = [];
  for (const professor of base.professores) {
    const disp = base.disponibilidades.get(professor.id);
    for (const { horario, localId } of horariosNoDia(disp, data, base.config)) {
      turmas.push(montarTurmaProfessor({
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
  return turmas;
}

/**
 * Junta as turmas dos professores em horários públicos (horário + praia).
 * É isto que o aluno vê: "10:00 · Praia da Barra · 7 vagas", sem nomes.
 */
function agregarHorarios(turmas, data, config) {
  const semAula = !!bloqueioDoDia(config, data);
  const mapa = new Map();
  for (const t of turmas) {
    const chave = chaveHorario(t.horario, t.localId);
    const h = mapa.get(chave) || {
      chave,
      data,
      horario: t.horario,
      localId: t.localId,
      capacidade: 0,
      ocupados: 0,
      vagas: 0,
      professores: 0,
      particularLivre: false,
      jaPassou: t.jaPassou,
      semAula,
    };
    h.professores += 1;
    h.ocupados += t.ocupados;
    if (!t.individual) h.capacidade += t.capacidade;
    h.vagas += t.vagas;
    if (t.particularLivre) h.particularLivre = true;
    mapa.set(chave, h);
  }

  return [...mapa.values()]
    .map((h) => ({
      ...h,
      grupoLotado: h.vagas <= 0,
      disponivelGrupo: !h.jaPassou && !h.semAula && h.vagas > 0,
      disponivelParticular: !h.jaPassou && !h.semAula && h.particularLivre,
    }))
    .sort((a, b) => (a.horario === b.horario
      ? String(a.localId).localeCompare(String(b.localId))
      : a.horario.localeCompare(b.horario)));
}

/**
 * Horários de um dia, já agregados (sem professor), com a lotação.
 * Seguro para qualquer visitante: lê apenas `vagas` e a disponibilidade.
 */
export async function horariosDoDia(data, { tipo = 'grupo' } = {}) {
  const [base, vagas] = await Promise.all([carregarBase(), vagasDoPeriodo(data, data)]);
  const turmas = turmasDaData(data, base, vagas, new Date());
  return agregarHorarios(turmas, data, base.config).map((h) => ({
    ...h,
    disponivel: tipo === 'individual' ? h.disponivelParticular : h.disponivelGrupo,
    cheio: tipo === 'individual' ? !h.particularLivre : h.grupoLotado,
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
    const horarios = agregarHorarios(turmasDaData(data, base, vagas, agora), data, base.config);
    const abertos = horarios.filter((h) => (tipo === 'individual' ? h.disponivelParticular : h.disponivelGrupo));
    const bloqueio = bloqueioDoDia(base.config, data);

    resumos.set(data, {
      data,
      slotsDisponiveis: abertos.length,
      vagasTotais: abertos.reduce((t, h) => t + (tipo === 'individual' ? 1 : h.vagas), 0),
      temVaga: abertos.length > 0,
      semAula: !!bloqueio,
      motivoSemAula: bloqueio?.motivo || null,
      todosPassaram: horarios.length > 0 && horarios.every((h) => h.jaPassou),
      horarios: [...new Set(abertos.map((h) => h.horario))],
      locais: [...new Set(abertos.map((h) => h.localId))],
    });
    cursor.setDate(cursor.getDate() + 1);
  }

  return resumos;
}

/* --------------------------------------------------------------------------
   Escolha interna do professor
   -------------------------------------------------------------------------- */

/**
 * Entre as turmas candidatas (mesmo dia, horário e praia), escolhe a que
 * recebe o aluno:
 *  - em grupo: completa primeiro a turma que já tem alunos (o aluno não cai
 *    sozinho com um professor enquanto outro tem turma pela metade); empate
 *    vai para a ordem da grade;
 *  - particular: o primeiro professor livre, pela ordem da grade.
 * O administrador pode reatribuir depois, manualmente.
 */
function escolherTurma(candidatas, tipo, capacidade) {
  if (tipo === 'individual') {
    return candidatas
      .filter((c) => c.ocupados === 0)
      .sort((a, b) => a.ordem - b.ordem)[0] || null;
  }
  return candidatas
    .filter((c) => !c.individual && c.ocupados < capacidade)
    .sort((a, b) => (b.ocupados - a.ocupados) || (a.ordem - b.ordem))[0] || null;
}

/* --------------------------------------------------------------------------
   Agendamento
   -------------------------------------------------------------------------- */

/**
 * Marca uma aula numa transação: valida data, bloqueios, lotação,
 * duplicidade e saldo; escolhe o professor; só então grava a aula, atualiza
 * a vaga e debita o crédito. Todas as leituras vêm antes de qualquer
 * escrita, como o Firestore exige.
 *
 * `localId` restringe a praia (o aluno escolheu "10:00 · Praia Mole").
 * `professorId` só é usado pela equipe para forçar um professor.
 */
export async function agendar({
  alunoId, alunoNome, data, horario, localId = null, tipo = 'grupo', professorId = null,
}) {
  const base = await carregarBase();
  const { config } = base;

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
  const bloqueio = bloqueioDoDia(config, data);
  if (bloqueio) {
    throw new ErroAgenda('DIA_SEM_AULA', `Não haverá aulas nesta data${bloqueio.motivo ? ` (${bloqueio.motivo})` : ''}. Escolha outro dia.`);
  }

  // 2. Professores que atendem nesse dia, horário (e praia, se escolhida)
  const candidatosBase = base.professores
    .filter((p) => !professorId || p.id === professorId)
    .map((p) => {
      const slot = horariosNoDia(base.disponibilidades.get(p.id), data, config)
        .find((s) => s.horario === horario && (!localId || s.localId === localId));
      return slot ? { professor: p, localId: slot.localId } : null;
    })
    .filter(Boolean);

  if (!candidatosBase.length) {
    throw new ErroAgenda('FORA_DA_DISPONIBILIDADE', 'Não há aula neste dia e horário. Escolha outro.');
  }

  return transacao(async (ops) => {
    // 3. Lotação de cada turma candidata — lida pela transação
    const candidatas = [];
    for (const c of candidatosBase) {
      const id = idVaga(data, c.professor.id, horario);
      const vaga = await ops.obter('vagas', id);
      const ocupados = Number(vaga?.ocupados) || 0;
      candidatas.push({
        professorId: c.professor.id,
        ordem: c.professor.ordem ?? 99,
        localId: c.localId,
        idVaga: id,
        vaga,
        ocupados,
        individual: vaga?.individual === true && ocupados > 0,
      });
    }

    const escolhida = escolherTurma(candidatas, tipo, config.capacidadeGrupo);
    if (!escolhida) {
      throw tipo === 'individual'
        ? new ErroAgenda('SLOT_OCUPADO', 'Não há professor livre para aula particular neste horário. Escolha outro.')
        : new ErroAgenda('SLOT_LOTADO', 'Este horário acabou de lotar. Escolha outro horário.');
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
      professorId: escolhida.professorId,
      atribuicao: professorId ? 'manual' : 'automatica',
      data,
      horario,
      duracaoMin: config.duracaoMin,
      tipo,
      localId: escolhida.localId,
      status: 'confirmado',
      presenca: null,
      canceladoPor: null,
      motivoCancelamento: null,
      loteNomePacote: lote.nomePacote || null,
      lotePacoteId: lote.pacoteId || null,
      loteExpiraEm: lote.expiraEm || null,
      loteApenasFimDeSemana: lote.apenasFimDeSemana === true,
      criadoEm: new Date().toISOString(),
    });

    await gravarVaga(ops, escolhida.vaga, escolhida.idVaga, {
      data,
      professorId: escolhida.professorId,
      horario,
      ocupados: escolhida.ocupados + 1,
      individual: tipo === 'individual',
      // As regras do Firestore conferem este agendamento para aceitar a
      // alteração feita por um aluno (veja firestore.rules, coleção vagas).
      ultimoAgendamento: agendamento.id,
    });

    await lancarCredito(ops, {
      id: `debito_${agendamento.id}`,
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

/** Horas que faltam para a aula começar. */
export const horasAteAula = (aula) => (dataHoraDe(aula.data, aula.horario) - Date.now()) / 3600000;

/** O aluno ainda pode cancelar sozinho pelo site? */
export function alunoPodeCancelar(aula, config) {
  return aula.status === 'confirmado' && horasAteAula(aula) >= config.horasMinimasCancelamento;
}

/**
 * Cancela uma aula, libera a vaga e devolve o crédito.
 * Idempotente: aula já cancelada não gera um segundo estorno (e o id
 * `estorno_<aula>` não pode ser gravado duas vezes).
 *
 * `porQuem` = { id, nome, papel }
 * `opcoes.permitirRealizada` (admin): estorna aula que já passou — usado ao
 *   aprovar a justificativa de uma falta.
 * `opcoes.extras`: campos a mais no agendamento (ex.: canceladoPorAviso).
 */
export async function cancelar(agendamentoId, porQuem, motivo = null, opcoes = {}) {
  const config = await obterConfig();
  const { permitirRealizada = false, extras = {} } = opcoes;

  return transacao(async (ops) => {
    const agendamento = await ops.obter('agendamentos', agendamentoId);
    if (!agendamento) throw new ErroAgenda('NAO_ENCONTRADO', 'Aula não encontrada.');

    const ehDono = agendamento.alunoId === porQuem.id;
    const ehEquipe = porQuem.papel === 'professor' || porQuem.papel === 'admin';
    if (!ehDono && !ehEquipe) throw new ErroAgenda('SEM_PERMISSAO', 'Você não pode cancelar esta aula.');

    const statusAceitos = permitirRealizada && porQuem.papel === 'admin'
      ? ['confirmado', 'realizado']
      : ['confirmado'];
    if (!statusAceitos.includes(agendamento.status)) {
      throw new ErroAgenda('JA_CANCELADA', 'Esta aula já foi cancelada ou concluída.');
    }

    if (ehDono && !ehEquipe) {
      if (horasAteAula(agendamento) < config.horasMinimasCancelamento) {
        throw new ErroAgenda(
          'PRAZO_EXPIRADO',
          `O cancelamento pelo site é permitido até ${config.horasMinimasCancelamento}h antes da aula. `
          + 'Depois disso, só a escola cancela: envie uma justificativa pelo seu painel.',
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
      ...extras,
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
      id: `estorno_${agendamentoId}`,
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

/**
 * Cancela TODAS as aulas confirmadas das datas informadas (aviso de
 * tempestade, indisponibilidade). Cada aluno recebe o crédito de volta.
 * Devolve as aulas canceladas, para a tela avisar cada aluno.
 */
export async function cancelarDatas(datas, porQuem, motivo, extras = {}) {
  const canceladas = [];
  const falhas = [];
  for (const data of datas) {
    const doDia = await listar('agendamentos', { data });
    for (const aula of doDia.filter((a) => a.status === 'confirmado')) {
      try {
        await cancelar(aula.id, porQuem, motivo, { extras });
        canceladas.push(aula);
      } catch (err) {
        falhas.push({ aula, erro: err.message });
      }
    }
  }
  return { canceladas, falhas };
}

/* --------------------------------------------------------------------------
   Atribuição manual de professor (administrador)
   -------------------------------------------------------------------------- */

/**
 * Passa a aula para outro professor: atualiza a aula e as duas contagens de
 * vaga numa transação. A capacidade do professor de destino é respeitada,
 * a menos que o administrador force (`forcar`).
 */
export async function reatribuirProfessor(agendamentoId, novoProfessorId, porQuem, { forcar = false } = {}) {
  if (porQuem?.papel !== 'admin') {
    throw new ErroAgenda('SEM_PERMISSAO', 'Só o administrador define o professor das aulas.');
  }
  const base = await carregarBase();
  const novo = base.professores.find((p) => p.id === novoProfessorId);
  if (!novo) throw new ErroAgenda('PROFESSOR_INDISPONIVEL', 'Professor não encontrado ou inativo.');

  return transacao(async (ops) => {
    const aula = await ops.obter('agendamentos', agendamentoId);
    if (!aula || aula.status !== 'confirmado') {
      throw new ErroAgenda('NAO_ENCONTRADO', 'Só aulas confirmadas podem mudar de professor.');
    }
    if (aula.professorId === novoProfessorId) return aula;

    const idAntiga = idVaga(aula.data, aula.professorId, aula.horario);
    const idNova = idVaga(aula.data, novoProfessorId, aula.horario);
    const [vagaAntiga, vagaNova] = [await ops.obter('vagas', idAntiga), await ops.obter('vagas', idNova)];
    const ocupadosNova = Number(vagaNova?.ocupados) || 0;

    if (!forcar) {
      if (vagaNova?.individual && ocupadosNova > 0) {
        throw new ErroAgenda('SLOT_INDIVIDUAL', `${novo.nome} já tem aula particular neste horário.`);
      }
      if (aula.tipo === 'individual' && ocupadosNova > 0) {
        throw new ErroAgenda('SLOT_OCUPADO', `${novo.nome} já tem alunos neste horário — não cabe a particular.`);
      }
      if (ocupadosNova >= base.config.capacidadeGrupo) {
        throw new ErroAgenda('SLOT_LOTADO', `A turma de ${novo.nome} já está com ${ocupadosNova} alunos.`);
      }
    }

    const slotNovo = horariosNoDia(base.disponibilidades.get(novoProfessorId), aula.data, base.config)
      .find((s) => s.horario === aula.horario);

    await ops.atualizar('agendamentos', agendamentoId, {
      professorId: novoProfessorId,
      localId: slotNovo?.localId || aula.localId,
      atribuicao: 'manual',
      atribuidoPor: porQuem.id,
      atribuidoEm: new Date().toISOString(),
      professorAnteriorId: aula.professorId,
    });

    if (vagaAntiga && Number(vagaAntiga.ocupados) > 0) {
      const restantes = Number(vagaAntiga.ocupados) - 1;
      await ops.atualizar('vagas', idAntiga, {
        ocupados: restantes,
        individual: restantes > 0 && vagaAntiga.individual === true && aula.tipo !== 'individual',
        ultimoAgendamento: agendamentoId,
      });
    }
    await gravarVaga(ops, vagaNova, idNova, {
      data: aula.data,
      professorId: novoProfessorId,
      horario: aula.horario,
      ocupados: ocupadosNova + 1,
      individual: aula.tipo === 'individual' || (vagaNova?.individual === true && ocupadosNova > 0),
      ultimoAgendamento: agendamentoId,
    });

    return { ...aula, professorId: novoProfessorId };
  });
}

/** Professores que atendem no dia e horário da aula (para o seletor do admin). */
export async function professoresDoHorario(data, horario) {
  const base = await carregarBase();
  return base.professores.map((p) => ({
    ...p,
    atende: horariosNoDia(base.disponibilidades.get(p.id), data, base.config).some((s) => s.horario === horario),
  }));
}

/* --------------------------------------------------------------------------
   Presença (baixa na praia, conferindo o documento)
   -------------------------------------------------------------------------- */

/**
 * Registra a presença do aluno. `presenca`: 'presente' | 'ausente' | null
 * (desfaz). Falta sem justificativa não devolve o crédito; a justificativa
 * aprovada pelo administrador devolve.
 */
export async function registrarPresenca(agendamentoId, presenca, porQuem) {
  if (porQuem?.papel !== 'professor' && porQuem?.papel !== 'admin') {
    throw new ErroAgenda('SEM_PERMISSAO', 'Só a equipe registra presença.');
  }
  if (![null, 'presente', 'ausente'].includes(presenca)) {
    throw new ErroAgenda('PRESENCA_INVALIDA', 'Situação de presença inválida.');
  }
  return transacao(async (ops) => {
    const aula = await ops.obter('agendamentos', agendamentoId);
    if (!aula || aula.status === 'cancelado') {
      throw new ErroAgenda('NAO_ENCONTRADO', 'Aula não encontrada ou cancelada.');
    }
    return ops.atualizar('agendamentos', agendamentoId, {
      presenca,
      presencaEm: presenca ? new Date().toISOString() : null,
      presencaPor: presenca ? porQuem.id : null,
      presencaPorNome: presenca ? porQuem.nome : null,
    });
  });
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
  const confirmados = doDia.filter((a) => a.status === 'confirmado' || a.status === 'realizado');
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
 * em diante. Útil se algo sair do lugar. Só a equipe pode rodar.
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

/** Disponibilidade normalizada (reexportada para quem só importa agenda.js). */
export { normalizarDisponibilidade };
