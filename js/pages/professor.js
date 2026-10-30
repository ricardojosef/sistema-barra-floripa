/**
 * professor.js — painel do professor.
 *
 * Três abas:
 *  - Turmas: lotação de cada horário do dia, lista de alunos com dados de
 *    contato, cancelamentos e mensagens para a turma ou para um aluno;
 *  - Disponibilidade: horários e local de cada dia da semana, e bloqueios
 *    em datas específicas;
 *  - Mensagens: o que já foi enviado e quantos alunos leram.
 *
 * O professor vê e edita só o que é dele. O administrador vê todos e
 * escolhe, no filtro, qual professor quer ver ou editar.
 */

import { exigirAuth, sair } from '../auth.js';
import { turmasDoDia, cancelar, cancelarTurma, ErroAgenda } from '../agenda.js';
import { carregarContexto, nomeLocal } from '../precos.js';
import { obter, listar } from '../store.js';
import { saldoCreditos } from '../creditos.js';
import {
  obterDisponibilidade, salvarDisponibilidade, aulasForaDaDisponibilidade, ErroDisponibilidade,
} from '../disponibilidade.js';
import { enviarMensagem, enviosDaEquipe, ErroMensagem } from '../mensagens.js';
import {
  qs, qsa, el, isoDeData, hojeISO, formatarData, formatarDataExtenso, faixaHorario, iniciais,
  SEMANA, SEMANA_CURTO, montarShellPainel, toast, abrirModal, confirmar, escapar, vazio,
  botaoCarregando, tempoRelativo, marcarItemMenu,
} from '../ui.js';

let usuario = null;
let contexto = null;
let diaAtual = hojeISO();
let professorFiltro = null;      // admin: professor escolhido no filtro
let abaAtual = 'turmas';
let rascunhoDisp = null;         // disponibilidade em edição

const ehAdmin = () => usuario.papel === 'admin';

/** Registro de professor do usuário logado (o admin também dá aula). */
function meuProfessorId() {
  return contexto.professores.find((p) => p.usuarioId === usuario.id)?.id || null;
}

/** Professor cuja agenda/disponibilidade está em foco agora. */
function professorEmFoco() {
  return ehAdmin() ? (professorFiltro || meuProfessorId()) : meuProfessorId();
}

const nomeDoProfessor = (id) => contexto.mapaProfessores.get(id)?.nome || 'Professor';

/* ==========================================================================
   ABAS
   ========================================================================== */

async function trocarAba(nome) {
  abaAtual = nome;
  qsa('#abas-professor .aba').forEach((b) => {
    const ativa = b.dataset.aba === nome;
    b.classList.toggle('ativa', ativa);
    b.setAttribute('aria-selected', String(ativa));
  });
  qsa('.painel-aba').forEach((p) => p.classList.toggle('ativo', p.dataset.painel === nome));
  history.replaceState(null, '', `professor.html#${nome}`);
  marcarItemMenu(nome);

  // No admin, o filtro "Todos" não faz sentido para editar disponibilidade.
  const opcaoTodos = qs('#filtro-professor option[value=""]');
  if (opcaoTodos) opcaoTodos.disabled = nome === 'disponibilidade';
  if (ehAdmin() && nome === 'disponibilidade' && !professorFiltro) {
    professorFiltro = meuProfessorId();
    qs('#filtro-professor').value = professorFiltro || '';
  }

  if (nome === 'turmas') await carregarTurmas();
  if (nome === 'disponibilidade') await carregarDisponibilidade();
  if (nome === 'mensagens') await carregarEnviadas();
}

/* ==========================================================================
   ABA TURMAS
   ========================================================================== */

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
  qsa('#faixa-dias .dia-pill').forEach((p) => p.classList.toggle('ativo', p.dataset.data === iso));
  await carregarTurmas();
}

function cartaoTurma(slot) {
  const ocupacao = slot.ocupados / slot.capacidade;
  const classe = slot.ocupados === 0 ? 'vazia'
    : slot.cheio ? 'lotada'
      : ocupacao >= 0.8 ? 'quase' : '';

  const badge = slot.individual
    ? el('span', { class: 'badge badge-info', text: 'Particular' })
    : slot.ocupados === 0
      ? el('span', { class: 'badge badge-neutro', text: 'Sem alunos' })
      : slot.cheio
        ? el('span', { class: 'badge badge-perigo', text: `LOTADA ${slot.ocupados}/${slot.capacidade}` })
        : el('span', {
          class: `badge ${ocupacao >= 0.8 ? 'badge-aviso' : 'badge-sucesso'}`,
          text: `${slot.ocupados}/${slot.capacidade}`,
        });

  const card = el('article', { class: `cartao-turma-prof ${classe}` }, [
    el('div', { class: 'turma-topo' }, [
      el('div', {}, [
        el('div', { class: 'turma-hora', text: slot.horario }),
        el('div', {
          class: 'turma-prof',
          text: `${faixaHorario(slot.horario, contexto.config.duracaoMin)} · Prof. ${slot.professorNome}`,
        }),
      ]),
      badge,
    ]),
  ]);

  if (slot.foraDaDisponibilidade) {
    card.append(el('div', {
      class: 'aviso-fora',
      text: '⚠️ Fora da sua disponibilidade — aula marcada antes da mudança.',
    }));
  }

  if (slot.alunos.length) {
    const lista = el('ul', { class: 'lista-alunos' });
    for (const aula of slot.alunos) {
      lista.append(el('li', {}, [
        el('button', {
          type: 'button',
          class: 'aluno-link',
          title: `Ver dados de ${aula.alunoNome}`,
          onclick: () => abrirFichaAluno(aula),
        }, [
          el('span', { class: 'avatar', text: iniciais(aula.alunoNome) }),
          el('span', { class: 'cresce' }, [
            el('span', { class: 'aluno-nome', text: aula.alunoNome }),
            aula.tipo === 'individual' ? el('span', { class: 'badge badge-info texto-min', text: 'Particular' }) : null,
          ]),
        ]),
        el('button', {
          class: 'btn-remover',
          title: `Cancelar a aula de ${aula.alunoNome}`,
          'aria-label': `Cancelar a aula de ${aula.alunoNome}`,
          text: '✕',
          onclick: () => cancelarAluno(aula),
        }),
      ]));
    }
    card.append(lista);
  } else {
    card.append(el('p', { class: 'texto-peq texto-cinza mt-8 mb-8', text: 'Nenhum aluno inscrito neste horário.' }));
  }

  const acoes = el('div', { class: 'turma-acoes' }, [
    el('span', { class: 'texto-min texto-cinza', text: `📍 ${nomeLocal(contexto.mapaLocais, slot.localId)}` }),
  ]);
  if (slot.alunos.length) {
    acoes.append(
      el('button', {
        class: 'btn btn-claro btn-peq', type: 'button', text: '💬 Mensagem para a turma',
        onclick: () => escreverMensagem({
          destinatarios: slot.alunos.map((a) => ({ id: a.alunoId, nome: a.alunoNome })),
          turma: slot,
          titulo: `Mensagem para a turma das ${slot.horario}`,
        }),
      }),
      el('button', {
        class: 'btn btn-fantasma btn-peq texto-perigo', type: 'button', text: 'Cancelar turma',
        onclick: () => cancelarTurmaInteira(slot),
      }),
    );
  }
  card.append(acoes);
  return card;
}

async function carregarTurmas() {
  const alvo = qs('#grade-turmas');
  alvo.innerHTML = '<div class="vazio" style="grid-column:1/-1"><span class="spinner escuro"></span></div>';

  const texto = formatarDataExtenso(diaAtual, true);
  qs('#subtitulo-painel').textContent = texto.charAt(0).toUpperCase() + texto.slice(1);

  try {
    const filtro = ehAdmin() ? professorFiltro : meuProfessorId();
    const slots = await turmasDoDia(diaAtual, filtro);

    const comAlunos = slots.filter((s) => s.ocupados > 0);
    qs('#stat-alunos').textContent = String(comAlunos.reduce((t, s) => t + s.ocupados, 0));
    qs('#stat-turmas').textContent = String(comAlunos.length);
    qs('#stat-lotadas').textContent = String(slots.filter((s) => s.cheio && !s.individual).length);
    qs('#stat-vagas').textContent = String(
      slots.filter((s) => !s.jaPassou && !s.cheio && !s.foraDaDisponibilidade).reduce((t, s) => t + s.vagas, 0),
    );

    alvo.innerHTML = '';
    if (!slots.length) {
      alvo.append(vazio('Sem horários neste dia. Confira a aba Disponibilidade.', '📅'));
      return;
    }

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

/* --- Ficha do aluno --------------------------------------------------- */

/** Só dígitos com DDI 55, para o link do WhatsApp. */
function telefoneWhatsApp(telefone) {
  const digitos = String(telefone || '').replace(/\D/g, '');
  if (digitos.length < 10) return null;
  return digitos.startsWith('55') ? digitos : `55${digitos}`;
}

async function abrirFichaAluno(aula) {
  const corpo = el('div', { class: 'ficha-aluno' }, [
    el('div', { class: 'vazio' }, [el('span', { class: 'spinner escuro' })]),
  ]);
  const { fechar } = abrirModal({ titulo: 'Dados do aluno', corpo, largo: true });

  try {
    const [aluno, aulas, saldo] = await Promise.all([
      obter('usuarios', aula.alunoId),
      listar('agendamentos', { alunoId: aula.alunoId }),
      saldoCreditos(aula.alunoId),
    ]);

    const nome = aluno?.nome || aula.alunoNome;
    const email = aluno?.email || '';
    const telefone = aluno?.telefone || '';
    const zap = telefoneWhatsApp(telefone);
    const hoje = hojeISO();

    const realizadas = aulas.filter((a) => a.status === 'realizado'
      || (a.status === 'confirmado' && a.data < hoje)).length;
    const proximas = aulas
      .filter((a) => a.status === 'confirmado' && a.data >= hoje)
      .sort((a, b) => (a.data + a.horario).localeCompare(b.data + b.horario));

    corpo.innerHTML = '';
    corpo.append(
      el('div', { class: 'ficha-topo' }, [
        el('span', { class: 'avatar avatar-g', text: iniciais(nome) }),
        el('div', {}, [
          el('div', { class: 'negrito', text: nome }),
          el('div', {
            class: 'texto-peq texto-cinza',
            text: aluno?.criadoEm ? `Aluno desde ${formatarData(String(aluno.criadoEm).slice(0, 10))}` : '',
          }),
        ]),
      ]),

      el('h4', { class: 'ficha-secao', text: 'Contato' }),
      el('div', { class: 'ficha-contatos' }, [
        linhaContato('✉️', 'E-mail', email, email ? `mailto:${email}` : null),
        linhaContato('📞', 'Telefone', telefone, telefone ? `tel:${String(telefone).replace(/[^\d+]/g, '')}` : null),
        zap ? el('a', {
          class: 'btn btn-secundario btn-peq', href: `https://wa.me/${zap}`, target: '_blank', rel: 'noopener',
          text: '🟢 Abrir no WhatsApp',
        }) : null,
      ]),

      el('h4', { class: 'ficha-secao', text: 'Aulas' }),
      el('div', { class: 'ficha-numeros' }, [
        numeroFicha(String(realizadas), 'realizadas'),
        numeroFicha(String(proximas.length), 'agendadas'),
        numeroFicha(String(saldo), saldo === 1 ? 'crédito' : 'créditos'),
      ]),
      proximas.length
        ? el('ul', { class: 'ficha-proximas' }, proximas.slice(0, 5).map((a) => el('li', {
          text: `${formatarData(a.data)} · ${a.horario} · Prof. ${nomeDoProfessor(a.professorId)}`
            + `${a.tipo === 'individual' ? ' · particular' : ''}`,
        })))
        : null,
    );

    corpo.append(el('div', { class: 'ficha-rodape' }, [
      el('button', {
        type: 'button', class: 'btn btn-primario btn-peq', text: '💬 Enviar mensagem',
        onclick: () => {
          fechar();
          escreverMensagem({
            destinatarios: [{ id: aula.alunoId, nome }],
            turma: { data: aula.data, horario: aula.horario, professorId: aula.professorId },
            titulo: `Mensagem para ${nome}`,
          });
        },
      }),
    ]));
  } catch (err) {
    console.error('[professor] falha ao carregar dados do aluno:', err);
    corpo.innerHTML = '';
    corpo.append(vazio('Não foi possível carregar os dados deste aluno.', '⚠️'));
  }
}

function linhaContato(icone, rotulo, valor, href) {
  return el('div', { class: 'linha-contato' }, [
    el('span', { class: 'texto-min texto-cinza', text: `${icone} ${rotulo}` }),
    valor
      ? (href ? el('a', { href, text: valor }) : el('span', { text: valor }))
      : el('span', { class: 'texto-cinza', text: 'não informado' }),
  ]);
}

const numeroFicha = (valor, rotulo) => el('div', { class: 'ficha-numero' }, [
  el('strong', { text: valor }),
  el('span', { text: rotulo }),
]);

/* --- Mensagens -------------------------------------------------------- */

function escreverMensagem({ destinatarios, turma, titulo }) {
  const corpo = el('div');
  const nomes = destinatarios.map((d) => d.nome).join(', ');
  corpo.innerHTML = `
    <p class="texto-peq texto-cinza mb-8">
      Para: <strong>${escapar(nomes)}</strong>
      ${turma?.data ? `<br>Aula de ${escapar(formatarData(turma.data))} às ${escapar(turma.horario)}` : ''}
    </p>
    <div class="campo">
      <label for="texto-mensagem">Mensagem</label>
      <textarea id="texto-mensagem" maxlength="2000" rows="5"
        placeholder="Ex.: Mar com ondulação forte amanhã — encontro às 7h45 no posto 2."></textarea>
      <span class="dica"><span id="contador-msg">0</span>/2000</span>
    </div>`;

  const { caixa, fechar } = abrirModal({
    titulo,
    corpo,
    botoes: [
      { texto: 'Cancelar', classe: 'btn-claro' },
      {
        texto: 'Enviar',
        classe: 'btn-primario',
        autoFechar: false,
        onClick: async () => {
          const texto = qs('#texto-mensagem', caixa).value;
          const btn = caixa.querySelector('.modal-rodape .btn-primario');
          const restaurar = botaoCarregando(btn, 'Enviando...');
          try {
            const { enviadas } = await enviarMensagem({ destinatarios, texto, turma });
            fechar();
            toast(enviadas === 1 ? 'Mensagem enviada.' : `Mensagem enviada para ${enviadas} alunos.`, 'sucesso');
            if (abaAtual === 'mensagens') await carregarEnviadas();
          } catch (err) {
            restaurar();
            toast(err instanceof ErroMensagem ? err.message : 'Não foi possível enviar a mensagem.', 'erro', 6000);
            if (!(err instanceof ErroMensagem)) console.error('[professor] erro ao enviar mensagem:', err);
          }
        },
      },
    ],
  });

  const area = qs('#texto-mensagem', caixa);
  area.addEventListener('input', () => { qs('#contador-msg', caixa).textContent = String(area.value.length); });
  area.focus();
}

async function carregarEnviadas() {
  const alvo = qs('#lista-enviadas');
  alvo.innerHTML = '<div class="vazio"><span class="spinner escuro"></span></div>';
  try {
    const envios = await enviosDaEquipe(usuario.id);
    alvo.innerHTML = '';
    if (!envios.length) {
      alvo.append(vazio('Você ainda não enviou mensagens.', '💬'));
      return;
    }
    for (const e of envios) {
      alvo.append(el('article', { class: 'mensagem-enviada' }, [
        el('div', { class: 'flex entre itens-centro gap-8 quebra' }, [
          el('span', { class: 'texto-min texto-cinza', text: tempoRelativo(e.criadoEm) }),
          el('span', {
            class: `badge ${e.lidas === e.destinatarios.length ? 'badge-sucesso' : 'badge-neutro'}`,
            text: `${e.lidas}/${e.destinatarios.length} leram`,
          }),
        ]),
        el('p', { class: 'mensagem-texto', text: e.texto }),
        el('div', {
          class: 'texto-min texto-cinza',
          text: `Para: ${e.destinatarios.join(', ')}`
            + `${e.turma?.data ? ` · aula de ${formatarData(e.turma.data)} às ${e.turma.horario}` : ''}`,
        }),
      ]));
    }
  } catch (err) {
    console.error('[professor] falha ao carregar mensagens enviadas:', err);
    alvo.innerHTML = '';
    alvo.append(vazio('Não foi possível carregar as mensagens.', '⚠️'));
  }
}

/* --- Cancelamentos ---------------------------------------------------- */

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
    if (!(err instanceof ErroAgenda)) console.error('[professor] erro ao cancelar aluno:', err);
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
    </div>
    <label class="checkbox-linha mt-8">
      <input type="checkbox" id="avisar-turma" checked>
      <span>Enviar o motivo como mensagem para os alunos</span>
    </label>`;

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
          fechar({ motivo, avisar: qs('#avisar-turma', caixa).checked });
        },
      },
    ],
  });

  qs('#motivo-cancel', caixa).addEventListener('change', (ev) => {
    qs('#campo-motivo-livre', caixa).classList.toggle('oculto', ev.target.value !== 'outro');
  });

  const escolha = await promessa;
  if (!escolha) return;

  try {
    const resultados = await cancelarTurma(
      { professorId: slot.professorId, data: slot.data, horario: slot.horario },
      { id: usuario.id, nome: usuario.nome, papel: usuario.papel },
      escolha.motivo,
    );
    const ok = resultados.filter((r) => r.ok).length;
    const falhas = resultados.length - ok;

    if (escolha.avisar && ok) {
      try {
        await enviarMensagem({
          destinatarios: slot.alunos.map((a) => ({ id: a.alunoId, nome: a.alunoNome })),
          texto: `Sua aula de ${formatarData(slot.data)} às ${slot.horario} foi cancelada: ${escolha.motivo}. `
            + 'O crédito já voltou para a sua conta.',
          turma: slot,
        });
      } catch (err) {
        console.warn('[professor] turma cancelada, mas o aviso não foi enviado:', err);
      }
    }

    toast(
      falhas
        ? `${ok} aula(s) cancelada(s), ${falhas} falhou(ram). Recarregue e tente de novo.`
        : `Turma cancelada. ${ok} crédito(s) devolvido(s) aos alunos.`,
      falhas ? 'aviso' : 'sucesso',
      6000,
    );
    await carregarTurmas();
  } catch (err) {
    toast('Não foi possível cancelar a turma.', 'erro');
    console.error('[professor] erro ao cancelar turma:', err);
  }
}

/* ==========================================================================
   ABA DISPONIBILIDADE
   ========================================================================== */

async function carregarDisponibilidade() {
  const professorId = professorEmFoco();
  const grade = qs('#grade-semana');

  if (!professorId) {
    grade.innerHTML = '';
    grade.append(vazio('Escolha um professor no filtro acima para editar a disponibilidade.', '👆'));
    return;
  }

  qs('#titulo-disponibilidade').textContent = professorId === meuProfessorId()
    ? 'Minha semana'
    : `Semana do Prof. ${nomeDoProfessor(professorId)}`;

  grade.innerHTML = '<div class="vazio"><span class="spinner escuro"></span></div>';
  try {
    const disp = await obterDisponibilidade(professorId, contexto.config);
    rascunhoDisp = {
      professorId,
      semana: structuredClone(disp.semana),
      locais: { ...disp.locais },
      bloqueios: disp.bloqueios.map((b) => ({ ...b, horarios: [...(b.horarios || [])] })),
    };
    montarGradeSemana();
    montarBloqueios();
  } catch (err) {
    console.error('[professor] falha ao carregar disponibilidade:', err);
    grade.innerHTML = '';
    grade.append(vazio('Não foi possível carregar a disponibilidade.', '⚠️'));
  }
}

/** Tabela dia da semana × horário, com o local de cada dia. */
function montarGradeSemana() {
  const { horarios } = contexto.config;
  const ordemDias = ['1', '2', '3', '4', '5', '6', '0']; // segunda primeiro
  const tabela = el('table', { class: 'tabela tabela-semana' });

  tabela.append(el('thead', {}, [el('tr', {}, [
    el('th', { text: 'Dia' }),
    ...horarios.map((h) => el('th', { class: 'texto-centro', text: h })),
    el('th', { text: 'Local' }),
  ])]));

  const corpo = el('tbody');
  for (const dia of ordemDias) {
    const linha = el('tr', {}, [el('th', { scope: 'row', text: SEMANA[Number(dia)] })]);

    for (const horario of horarios) {
      const marcado = rascunhoDisp.semana[dia].includes(horario);
      const caixa = el('input', {
        type: 'checkbox',
        checked: marcado,
        'aria-label': `${SEMANA[Number(dia)]}, ${horario}`,
        onchange: (ev) => {
          const lista = new Set(rascunhoDisp.semana[dia]);
          if (ev.target.checked) lista.add(horario); else lista.delete(horario);
          rascunhoDisp.semana[dia] = horarios.filter((h) => lista.has(h));
        },
      });
      linha.append(el('td', { class: 'texto-centro' }, [caixa]));
    }

    const select = el('select', {
      'aria-label': `Local de ${SEMANA[Number(dia)]}`,
      onchange: (ev) => { rascunhoDisp.locais[dia] = ev.target.value; },
    });
    for (const local of contexto.locais) {
      select.append(el('option', {
        value: local.id, text: local.nome, selected: rascunhoDisp.locais[dia] === local.id,
      }));
    }
    linha.append(el('td', {}, [select]));
    corpo.append(linha);
  }
  tabela.append(corpo);

  const atalhos = el('div', { class: 'flex quebra gap-8 mt-16' }, [
    el('button', {
      type: 'button', class: 'btn btn-claro btn-peq', text: 'Marcar tudo',
      onclick: () => { ordemDias.forEach((d) => { rascunhoDisp.semana[d] = [...horarios]; }); montarGradeSemana(); },
    }),
    el('button', {
      type: 'button', class: 'btn btn-claro btn-peq', text: 'Desmarcar tudo',
      onclick: () => { ordemDias.forEach((d) => { rascunhoDisp.semana[d] = []; }); montarGradeSemana(); },
    }),
  ]);

  const alvo = qs('#grade-semana');
  alvo.innerHTML = '';
  alvo.append(tabela, atalhos);
}

function montarBloqueios() {
  // Horários do formulário
  const alvoHorarios = qs('#bloqueio-horarios');
  alvoHorarios.innerHTML = '';
  for (const h of contexto.config.horarios) {
    alvoHorarios.append(el('label', { class: 'checkbox-linha' }, [
      el('input', { type: 'checkbox', value: h, class: 'bloqueio-horario' }),
      el('span', { text: h }),
    ]));
  }
  qs('#bloqueio-data').min = hojeISO();

  const lista = qs('#lista-bloqueios');
  lista.innerHTML = '';
  if (!rascunhoDisp.bloqueios.length) {
    lista.append(el('p', { class: 'texto-peq texto-cinza', text: 'Nenhum bloqueio marcado.' }));
    return;
  }
  rascunhoDisp.bloqueios.forEach((b, i) => {
    lista.append(el('div', { class: 'linha-bloqueio' }, [
      el('div', {}, [
        el('strong', { text: formatarDataExtenso(b.data) }),
        el('span', {
          class: 'texto-peq texto-cinza',
          text: ` · ${b.horarios?.length ? b.horarios.join(', ') : 'dia todo'}${b.motivo ? ` · ${b.motivo}` : ''}`,
        }),
      ]),
      el('button', {
        type: 'button', class: 'btn btn-fantasma btn-peq', text: 'Remover',
        onclick: () => { rascunhoDisp.bloqueios.splice(i, 1); montarBloqueios(); },
      }),
    ]));
  });
}

function adicionarBloqueio(ev) {
  ev.preventDefault();
  const data = qs('#bloqueio-data').value;
  if (!data) { toast('Escolha a data do bloqueio.', 'aviso'); return; }
  if (data < hojeISO()) { toast('Escolha uma data a partir de hoje.', 'aviso'); return; }

  const horarios = qsa('.bloqueio-horario').filter((c) => c.checked).map((c) => c.value);
  rascunhoDisp.bloqueios = rascunhoDisp.bloqueios.filter((b) => b.data !== data);
  rascunhoDisp.bloqueios.push({ data, horarios, motivo: qs('#bloqueio-motivo').value.trim() });
  rascunhoDisp.bloqueios.sort((a, b) => a.data.localeCompare(b.data));

  qs('#form-bloqueio').reset();
  montarBloqueios();
  toast('Bloqueio adicionado. Clique em Salvar disponibilidade para valer.', 'info');
}

async function salvarDisponibilidadeUI(btn) {
  if (!rascunhoDisp) return;
  const { professorId } = rascunhoDisp;

  // Avisa quantas aulas já marcadas ficariam fora — sem cancelar nenhuma.
  const fora = await aulasForaDaDisponibilidade(professorId, rascunhoDisp, contexto.config);
  if (fora.length) {
    const confirmou = await confirmar({
      titulo: 'Há aulas marcadas nesses horários',
      mensagem: `${fora.length} ${fora.length === 1 ? 'aula já agendada fica' : 'aulas já agendadas ficam'} fora da nova disponibilidade. `
        + 'Elas continuam valendo — se não for dar essas aulas, cancele-as na aba Turmas para devolver o crédito aos alunos. Salvar mesmo assim?',
      textoOk: 'Salvar',
    });
    if (!confirmou) return;
  }

  const restaurar = botaoCarregando(btn, 'Salvando...');
  try {
    await salvarDisponibilidade(professorId, rascunhoDisp, contexto.config, contexto.locais);
    toast('Disponibilidade salva. Os alunos já veem os novos horários.', 'sucesso', 4500);
    await carregarDisponibilidade();
  } catch (err) {
    toast(err instanceof ErroDisponibilidade ? err.message : 'Não foi possível salvar a disponibilidade.', 'erro', 6000);
    if (!(err instanceof ErroDisponibilidade)) console.error('[professor] erro ao salvar disponibilidade:', err);
  } finally {
    restaurar();
  }
}

/* ==========================================================================
   INICIALIZAÇÃO
   ========================================================================== */

async function iniciar() {
  usuario = await exigirAuth(['professor', 'admin']);

  montarShellPainel({
    usuario,
    paginaAtual: 'turmas',
    aoSair: () => sair(),
  });

  contexto = await carregarContexto();

  if (ehAdmin()) {
    qs('#titulo-painel').textContent = 'Turmas da Escola';
    qs('#filtro-professor-area').classList.remove('oculto');
    const select = qs('#filtro-professor');
    for (const professor of contexto.professores) {
      select.append(el('option', { value: professor.id, text: professor.nome }));
    }
    select.addEventListener('change', async (ev) => {
      professorFiltro = ev.target.value || null;
      await trocarAba(abaAtual);
    });
  } else {
    qs('#titulo-painel').textContent = `Painel do Prof. ${nomeDoProfessor(meuProfessorId())}`;
  }

  qsa('#abas-professor .aba').forEach((b) => b.addEventListener('click', () => trocarAba(b.dataset.aba)));
  qs('#form-bloqueio').addEventListener('submit', adicionarBloqueio);
  qs('#btn-salvar-disponibilidade').addEventListener('click', (ev) => salvarDisponibilidadeUI(ev.currentTarget));

  montarFaixaDias();

  // O menu lateral abre direto numa aba: professor.html#disponibilidade
  const inicial = location.hash.replace('#', '');
  await trocarAba(['turmas', 'disponibilidade', 'mensagens'].includes(inicial) ? inicial : 'turmas');

  window.addEventListener('hashchange', () => {
    const aba = location.hash.replace('#', '');
    if (aba !== abaAtual && ['turmas', 'disponibilidade', 'mensagens'].includes(aba)) trocarAba(aba);
  });
}

iniciar();
