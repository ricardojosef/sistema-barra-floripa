/**
 * professor.js — painel do professor.
 *
 * Mostra as turmas do dia com a lotação de cada horário, a lista de alunos e
 * permite cancelar um aluno ou a turma inteira. O administrador vê todos os
 * professores; o professor vê apenas a própria agenda.
 */

import { exigirAuth, sair } from '../auth.js';
import { turmasDoDia, cancelar, cancelarTurma, ErroAgenda } from '../agenda.js';
import { carregarContexto, nomeLocal } from '../precos.js';
import {
  qs, el, isoDeData, hojeISO, formatarDataExtenso, faixaHorario, iniciais,
  SEMANA_CURTO, montarShellPainel, toast, abrirModal, confirmar, escapar, vazio,
} from '../ui.js';

let usuario = null;
let contexto = null;
let diaAtual = hojeISO();
let professorFiltro = null;

/** Professor logado (admin não está vinculado a um registro de professor). */
function meuProfessorId() {
  const encontrado = contexto.professores.find((p) => p.usuarioId === usuario.id);
  return encontrado?.id || null;
}

/* --------------------------------------------------------------------------
   Faixa de dias
   -------------------------------------------------------------------------- */

function montarFaixaDias() {
  const alvo = qs('#faixa-dias');
  alvo.innerHTML = '';

  // Do dia anterior até 13 dias à frente — cobre duas semanas de agenda.
  for (let offset = -1; offset <= 13; offset += 1) {
    const data = new Date();
    data.setHours(0, 0, 0, 0);
    data.setDate(data.getDate() + offset);
    const iso = isoDeData(data);

    alvo.append(el('button', {
      type: 'button',
      class: `dia-pill ${iso === diaAtual ? 'ativo' : ''}`,
      dataset: { data: iso },
      onclick: () => selecionarDia(iso),
    }, [
      el('span', { class: 'semana', text: offset === 0 ? 'hoje' : SEMANA_CURTO[data.getDay()] }),
      el('span', { class: 'num', text: String(data.getDate()) }),
    ]));
  }
}

async function selecionarDia(iso) {
  diaAtual = iso;
  qs('#faixa-dias').querySelectorAll('.dia-pill').forEach((p) => {
    p.classList.toggle('ativo', p.dataset.data === iso);
  });
  await carregarTurmas();
}

/* --------------------------------------------------------------------------
   Turmas
   -------------------------------------------------------------------------- */

function cartaoTurma(slot) {
  const ocupacao = slot.ocupados / slot.capacidade;
  const classe = slot.ocupados === 0 ? 'vazia'
    : slot.cheio ? 'lotada'
      : ocupacao >= 0.8 ? 'quase' : '';

  const card = el('article', { class: `cartao-turma-prof ${classe}` });

  const badge = slot.ocupados === 0
    ? el('span', { class: 'badge badge-neutro', text: 'Sem alunos' })
    : slot.cheio
      ? el('span', { class: 'badge badge-perigo', text: `LOTADA ${slot.ocupados}/${slot.capacidade}` })
      : el('span', {
        class: `badge ${ocupacao >= 0.8 ? 'badge-aviso' : 'badge-sucesso'}`,
        text: `${slot.ocupados}/${slot.capacidade}`,
      });

  card.append(el('div', { class: 'turma-topo' }, [
    el('div', {}, [
      el('div', { class: 'turma-hora', text: slot.horario }),
      el('div', {
        class: 'turma-prof',
        text: `${faixaHorario(slot.horario, contexto.config.duracaoMin)} · Prof. ${slot.professorNome}`,
      }),
    ]),
    badge,
  ]));

  // Lista de alunos
  if (slot.alunos.length) {
    const lista = el('ul', { class: 'lista-alunos' });
    for (const aula of slot.alunos) {
      const item = el('li', {}, [
        el('span', { class: 'avatar', text: iniciais(aula.alunoNome) }),
        el('span', { class: 'cresce' }, [
          el('div', { text: aula.alunoNome }),
          aula.tipo === 'individual'
            ? el('span', { class: 'badge badge-info texto-min', text: 'Individual' })
            : null,
        ]),
      ]);
      item.append(el('button', {
        class: 'btn-remover',
        title: `Cancelar a aula de ${aula.alunoNome}`,
        'aria-label': `Cancelar a aula de ${aula.alunoNome}`,
        text: '✕',
        onclick: () => cancelarAluno(aula),
      }));
      lista.append(item);
    }
    card.append(lista);
  } else {
    card.append(el('p', { class: 'texto-peq texto-cinza mt-8 mb-8', text: 'Nenhum aluno inscrito neste horário.' }));
  }

  // Rodapé
  card.append(el('div', { class: 'flex entre itens-centro gap-8 mt-8' }, [
    el('span', {
      class: 'texto-min texto-cinza',
      text: nomeLocal(contexto.mapaLocais, slot.alunos[0]?.localId || contexto.config.localPadraoId),
    }),
    slot.alunos.length
      ? el('button', {
        class: 'btn btn-fantasma btn-peq',
        text: 'Cancelar turma',
        onclick: () => cancelarTurmaInteira(slot),
      })
      : null,
  ]));

  return card;
}

async function cancelarAluno(aula) {
  const confirmou = await confirmar({
    titulo: 'Cancelar aula do aluno',
    mensagem: `Cancelar a aula de ${aula.alunoNome} em ${formatarDataExtenso(aula.data)} às ${aula.horario}? O crédito será devolvido para o aluno.`,
    textoOk: 'Cancelar aula',
    perigo: true,
  });
  if (!confirmou) return;

  try {
    await cancelar(aula.id, { id: usuario.id, nome: usuario.nome, papel: usuario.papel });
    toast(`Aula de ${aula.alunoNome} cancelada. Crédito devolvido.`, 'sucesso');
    await carregarTurmas();
  } catch (err) {
    toast(err instanceof ErroAgenda ? err.message : 'Não foi possível cancelar.', 'erro', 6000);
    console.error('[professor] erro ao cancelar aluno:', err);
  }
}

async function cancelarTurmaInteira(slot) {
  const corpo = el('div');
  corpo.innerHTML = `
    <p>
      Cancelar a turma das <strong>${escapar(slot.horario)}</strong> do
      <strong>Prof. ${escapar(slot.professorNome)}</strong>?
    </p>
    <p class="texto-peq texto-cinza mt-8">
      ${slot.alunos.length} ${slot.alunos.length === 1 ? 'aluno terá a aula cancelada e o crédito devolvido' : 'alunos terão a aula cancelada e o crédito devolvido'}.
    </p>
    <div class="campo mt-16">
      <label for="motivo-cancel">Motivo (aparece para o aluno)</label>
      <select id="motivo-cancel">
        <option value="Mar sem condições de surf">Mar sem condições de surf</option>
        <option value="Condições climáticas adversas">Condições climáticas adversas</option>
        <option value="Professor indisponível">Professor indisponível</option>
        <option value="outro">Outro motivo...</option>
      </select>
    </div>
    <div class="campo oculto" id="campo-motivo-livre">
      <label for="motivo-livre">Descreva o motivo</label>
      <input type="text" id="motivo-livre" placeholder="Ex.: manutenção no equipamento">
    </div>`;

  const { promessa, fechar, caixa } = abrirModal({
    titulo: 'Cancelar turma inteira',
    corpo,
    botoes: [
      { texto: 'Voltar', classe: 'btn-claro', valor: null },
      {
        texto: 'Cancelar turma',
        classe: 'btn-perigo',
        autoFechar: false,
        onClick: () => {
          const select = qs('#motivo-cancel', caixa);
          const livre = qs('#motivo-livre', caixa).value.trim();
          const motivo = select.value === 'outro' ? livre : select.value;
          if (select.value === 'outro' && !livre) {
            toast('Descreva o motivo do cancelamento.', 'aviso');
            return;
          }
          fechar(motivo);
        },
      },
    ],
  });

  qs('#motivo-cancel', caixa).addEventListener('change', (ev) => {
    qs('#campo-motivo-livre', caixa).classList.toggle('oculto', ev.target.value !== 'outro');
  });

  const motivo = await promessa;
  if (!motivo) return;

  try {
    const resultados = await cancelarTurma(
      { professorId: slot.professorId, data: slot.data, horario: slot.horario },
      { id: usuario.id, nome: usuario.nome, papel: usuario.papel },
      motivo,
    );
    const ok = resultados.filter((r) => r.ok).length;
    const falhas = resultados.length - ok;

    if (falhas) {
      toast(`${ok} aula(s) cancelada(s), ${falhas} falhou(ram). Recarregue e tente de novo.`, 'aviso', 6000);
    } else {
      toast(`Turma cancelada. ${ok} crédito(s) devolvido(s) aos alunos.`, 'sucesso');
    }
    await carregarTurmas();
  } catch (err) {
    toast('Não foi possível cancelar a turma.', 'erro');
    console.error('[professor] erro ao cancelar turma:', err);
  }
}

/* --------------------------------------------------------------------------
   Carga
   -------------------------------------------------------------------------- */

async function carregarTurmas() {
  const alvo = qs('#grade-turmas');
  alvo.innerHTML = '<div class="vazio" style="grid-column:1/-1"><span class="spinner escuro"></span></div>';

  const texto = formatarDataExtenso(diaAtual, true);
  qs('#subtitulo-painel').textContent = texto.charAt(0).toUpperCase() + texto.slice(1);

  try {
    // Admin sem filtro vê todos; professor vê só as próprias turmas.
    const idParaFiltrar = usuario.papel === 'admin' ? professorFiltro : meuProfessorId();
    const slots = await turmasDoDia(diaAtual, idParaFiltrar);

    const comAlunos = slots.filter((s) => s.ocupados > 0);
    const totalAlunos = comAlunos.reduce((t, s) => t + s.ocupados, 0);
    const lotadas = slots.filter((s) => s.cheio).length;
    const vagas = slots.filter((s) => !s.jaPassou && !s.cheio).reduce((t, s) => t + s.vagas, 0);

    qs('#stat-alunos').textContent = String(totalAlunos);
    qs('#stat-turmas').textContent = String(comAlunos.length);
    qs('#stat-lotadas').textContent = String(lotadas);
    qs('#stat-vagas').textContent = String(vagas);

    alvo.innerHTML = '';
    if (!slots.length) {
      alvo.append(vazio('Nenhum horário configurado para este dia.', '📅'));
      return;
    }

    // Turmas com alunos primeiro; horários vazios ficam no fim.
    const ordenados = [...slots].sort((a, b) => {
      if ((a.ocupados > 0) !== (b.ocupados > 0)) return b.ocupados - a.ocupados;
      return a.horario.localeCompare(b.horario);
    });

    ordenados.forEach((slot) => alvo.append(cartaoTurma(slot)));
  } catch (err) {
    console.error('[professor] falha ao carregar turmas:', err);
    alvo.innerHTML = '';
    alvo.append(vazio('Não foi possível carregar as turmas. Recarregue a página.', '⚠️'));
  }
}

/* --------------------------------------------------------------------------
   Inicialização
   -------------------------------------------------------------------------- */

async function iniciar() {
  usuario = await exigirAuth(['professor', 'admin']);

  montarShellPainel({
    usuario,
    paginaAtual: 'turmas',
    aoSair: () => sair(),
  });

  contexto = await carregarContexto();

  // O administrador enxerga a escola inteira e pode filtrar por professor.
  if (usuario.papel === 'admin') {
    qs('#titulo-painel').textContent = 'Turmas da Escola';
    qs('#filtro-professor-area').classList.remove('oculto');

    const select = qs('#filtro-professor');
    for (const professor of contexto.professores) {
      select.append(el('option', { value: professor.id, text: professor.nome }));
    }
    select.addEventListener('change', async (ev) => {
      professorFiltro = ev.target.value || null;
      await carregarTurmas();
    });
  } else {
    const meuId = meuProfessorId();
    const meuNome = contexto.mapaProfessores.get(meuId)?.nome || usuario.nome;
    qs('#titulo-painel').textContent = `Turmas do Prof. ${meuNome}`;
  }

  montarFaixaDias();
  await carregarTurmas();
}

iniciar();
