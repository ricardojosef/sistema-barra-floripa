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
import {
  turmasDoDia, cancelar, cancelarTurma, registrarPresenca, reatribuirProfessor, professoresDoHorario, ErroAgenda,
} from '../agenda.js';
import {
  documentoFormatado, rotuloDocumento, normalizarDocumento, nomeIdioma, bandeiraIdioma, nomePais,
} from '../documentos.js';
import {
  ultimaDeclaracao, declaracaoVigente, baixarPdfDeclaracao, PERGUNTAS,
} from '../saude.js';
import { resumoFinanceiro, registrarRepasse, removerRepasse } from '../financeiro.js';
import { carregarContexto, nomeLocal, obterConfig } from '../precos.js';
import { obter, listar } from '../store.js';
import { saldoCreditos } from '../creditos.js';
import {
  obterDisponibilidade, salvarDisponibilidade, aulasForaDaDisponibilidade, ErroDisponibilidade,
  horariosNoDia, bloqueiosComoDias,
} from '../disponibilidade.js';
import { enviarMensagem, enviosDaEquipe, ErroMensagem } from '../mensagens.js';
import {
  qs, qsa, el, isoDeData, dataDeISO, hojeISO, MESES, formatarData, formatarDataExtenso, faixaHorario, iniciais,
  SEMANA, SEMANA_CURTO, montarShellPainel, toast, abrirModal, confirmar, escapar, vazio,
  botaoCarregando, tempoRelativo, marcarItemMenu, iconeEl, avatarEl, formatarBRL,
} from '../ui.js';

let usuario = null;
let contexto = null;
let diaAtual = hojeISO();
let professorFiltro = null;      // admin: professor escolhido no filtro
let abaAtual = 'turmas';
let rascunhoDisp = null;         // disponibilidade em edição
const dadosAlunos = new Map();    // alunoId -> usuário (foto, documento, idioma)
const declaracoesAlunos = new Map(); // alunoId -> última declaração de saúde
let turmasEmTela = [];            // turmas do dia mostradas (para a baixa por CPF)

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

  const subtitulos = {
    disponibilidade: 'Quando e onde você atende — os alunos só agendam no que estiver marcado.',
    mensagens: 'Recados enviados aos alunos e quantos já leram.',
    saldo: 'Quanto você tem a receber pelas aulas dadas.',
    declaracoes: 'Questionários de saúde e termos assinados pelos alunos.',
  };
  if (subtitulos[nome]) qs('#subtitulo-painel').textContent = subtitulos[nome];

  if (nome === 'turmas') await carregarTurmas();
  if (nome === 'saldo') await carregarSaldo();
  if (nome === 'declaracoes') await carregarDeclaracoes();
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
        ? el('span', { class: 'badge badge-perigo', text: `Lotada ${slot.ocupados}/${slot.capacidade}` })
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
      text: 'Fora da sua disponibilidade — aula marcada antes da mudança.',
    }));
  }

  if (slot.alunos.length) {
    const lista = el('ul', { class: 'lista-alunos' });
    for (const aula of slot.alunos) {
      const aluno = dadosAlunos.get(aula.alunoId) || {};
      const decl = declaracoesAlunos.get(aula.alunoId);
      const marcadores = [
        aula.tipo === 'individual' ? el('span', { class: 'badge badge-info texto-min', text: 'Particular' }) : null,
        aluno.idioma && aluno.idioma !== 'pt'
          ? el('span', { class: 'badge badge-neutro texto-min', title: `Prefere aula em ${nomeIdioma(aluno.idioma)}`, text: `${bandeiraIdioma(aluno.idioma)} ${aluno.idioma.toUpperCase()}` })
          : null,
        !declaracaoVigente(decl)
          ? el('span', { class: 'badge badge-aviso texto-min', title: 'Questionário de saúde vencido ou não respondido', text: 'Sem PAR-Q' })
          : decl.algumSim
            ? el('span', { class: 'badge badge-perigo texto-min', title: 'Respondeu SIM a alguma pergunta do PAR-Q — veja a declaração', text: 'PAR-Q: atenção' })
            : null,
      ];

      const presenca = el('span', { class: 'presenca-acoes' });
      if (aula.presenca === 'presente') {
        presenca.append(el('button', { type: 'button', class: 'badge badge-sucesso', title: 'Desfazer baixa', text: '✓ Presente', onclick: () => marcarPresenca(aula, null) }));
      } else if (aula.presenca === 'ausente') {
        presenca.append(el('button', { type: 'button', class: 'badge badge-perigo', title: 'Desfazer falta', text: 'Falta', onclick: () => marcarPresenca(aula, null) }));
      } else {
        presenca.append(
          el('button', { type: 'button', class: 'btn-presenca ok', title: 'Dar baixa (presente) conferindo o documento', text: '✓', onclick: () => confirmarPresencaComDocumento(aula) }),
          el('button', { type: 'button', class: 'btn-presenca falta', title: 'Registrar falta', text: 'F', onclick: () => marcarPresenca(aula, 'ausente') }),
        );
      }

      lista.append(el('li', {}, [
        el('button', {
          type: 'button',
          class: 'aluno-link',
          title: `Ver dados de ${aula.alunoNome}`,
          onclick: () => abrirFichaAluno(aula),
        }, [
          avatarEl({ nome: aula.alunoNome, fotoUrl: aluno.fotoUrl }),
          el('span', { class: 'cresce' }, [
            el('span', { class: 'aluno-nome', text: aula.alunoNome }),
            el('span', { class: 'texto-min texto-cinza aluno-doc', text: documentoFormatado(aluno) ? `${rotuloDocumento(aluno)} ${documentoFormatado(aluno)}` : 'Sem documento' }),
            ...marcadores,
          ]),
        ]),
        presenca,
        ehAdmin() && aula.status === 'confirmado'
          ? el('button', {
            class: 'btn-remover', title: `Trocar o professor de ${aula.alunoNome}`, 'aria-label': `Trocar o professor de ${aula.alunoNome}`,
            text: '⇄', onclick: () => trocarProfessor(aula),
          })
          : null,
        aula.status === 'confirmado'
          ? el('button', {
            class: 'btn-remover',
            title: `Cancelar a aula de ${aula.alunoNome}`,
            'aria-label': `Cancelar a aula de ${aula.alunoNome}`,
            text: '✕',
            onclick: () => cancelarAluno(aula),
          })
          : null,
      ]));
    }
    card.append(lista);
  } else {
    card.append(el('p', { class: 'texto-peq texto-cinza mt-8 mb-8', text: 'Nenhum aluno inscrito neste horário.' }));
  }

  const acoes = el('div', { class: 'turma-acoes' }, [
    el('span', { class: 'texto-min texto-cinza com-icone' }, [iconeEl('local'), nomeLocal(contexto.mapaLocais, slot.localId)]),
  ]);
  if (slot.alunos.length) {
    acoes.append(
      el('button', {
        class: 'btn btn-claro btn-peq', type: 'button', text: 'Mensagem para a turma',
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

/**
 * Busca os dados dos alunos (foto, documento, idioma) e a última declaração
 * de saúde de cada um, só para quem ainda não está no cache. Falha sem travar.
 */
async function carregarDadosAlunos(ids) {
  const faltam = [...new Set(ids)].filter((id) => !dadosAlunos.has(id));
  await Promise.all(faltam.map(async (id) => {
    try {
      dadosAlunos.set(id, (await obter('usuarios', id)) || {});
    } catch {
      dadosAlunos.set(id, {});
    }
    try {
      declaracoesAlunos.set(id, await ultimaDeclaracao(id));
    } catch {
      declaracoesAlunos.set(id, null);
    }
  }));
}

/* --- Presença (baixa na praia) ---------------------------------------- */

async function marcarPresenca(aula, presenca) {
  try {
    await registrarPresenca(aula.id, presenca, { id: usuario.id, nome: usuario.nome, papel: usuario.papel });
    toast(presenca === 'presente' ? `Presença de ${aula.alunoNome} registrada.`
      : presenca === 'ausente' ? `Falta de ${aula.alunoNome} registrada.` : 'Baixa desfeita.', 'sucesso');
    await carregarTurmas();
  } catch (err) {
    toast(err instanceof ErroAgenda ? err.message : 'Não foi possível registrar a presença.', 'erro', 6000);
  }
}

/** Mostra o documento do cadastro para o professor conferir com o que o aluno trouxe. */
async function confirmarPresencaComDocumento(aula) {
  const aluno = dadosAlunos.get(aula.alunoId) || {};
  const doc = documentoFormatado(aluno);
  const confirmou = await confirmar({
    titulo: `Presença de ${aula.alunoNome}`,
    mensagem: doc
      ? `Confira o documento do aluno: ${rotuloDocumento(aluno)} ${doc}. Confere com o que ele apresentou?`
      : 'Este aluno não tem documento cadastrado. Confira a identidade pessoalmente antes de dar baixa.',
    textoOk: 'Confere — dar baixa',
  });
  if (confirmou) await marcarPresenca(aula, 'presente');
}

/** Baixa pelo número digitado: procura o aluno nas turmas do dia em foco. */
async function checkinPorDocumento(ev) {
  ev.preventDefault();
  const resultado = qs('#checkin-resultado');
  const digitado = normalizarDocumento(qs('#checkin-documento').value);
  resultado.innerHTML = '';
  if (digitado.length < 5) {
    resultado.append(el('span', { class: 'texto-peq texto-perigo', text: 'Digite o CPF ou passaporte completo.' }));
    return;
  }

  const aulas = turmasEmTela.flatMap((s) => s.alunos).filter((a) => a.status === 'confirmado');
  const encontrada = aulas.find((a) => {
    const aluno = dadosAlunos.get(a.alunoId) || {};
    return [aluno.cpf, aluno.documento].filter(Boolean).map(normalizarDocumento).includes(digitado);
  });

  if (!encontrada) {
    resultado.append(el('div', { class: 'alerta alerta-perigo' }, [
      iconeEl('alerta'),
      el('span', { text: 'Nenhum aluno com este documento tem aula neste dia (nas turmas mostradas). Confira o número e o dia selecionado.' }),
    ]));
    return;
  }
  if (encontrada.presenca === 'presente') {
    resultado.append(el('div', { class: 'alerta alerta-info' }, [iconeEl('info'), el('span', { text: `${encontrada.alunoNome} já está com presença registrada (${encontrada.horario}).` })]));
    return;
  }
  await marcarPresenca(encontrada, 'presente');
  qs('#checkin-documento').value = '';
  qs('#checkin-resultado').append(el('div', { class: 'alerta alerta-sucesso' }, [
    iconeEl('check'),
    el('span', { text: `${encontrada.alunoNome} — turma das ${encontrada.horario} com ${nomeDoProfessor(encontrada.professorId)}. Presença registrada.` }),
  ]));
}

/* --- Troca de professor (só administrador) ---------------------------- */

async function trocarProfessor(aula) {
  const opcoes = await professoresDoHorario(aula.data, aula.horario);
  const corpo = el('div');
  corpo.innerHTML = `
    <p class="texto-peq mb-16">Aula de <strong>${escapar(aula.alunoNome)}</strong> em
      ${escapar(formatarData(aula.data))} às ${escapar(aula.horario)}. Hoje com
      <strong>${escapar(nomeDoProfessor(aula.professorId))}</strong>. O aluno não vê essa troca.</p>
    <div class="campo">
      <label for="novo-professor">Passar para</label>
      <select id="novo-professor">
        ${opcoes.filter((p) => p.id !== aula.professorId).map((p) => `
          <option value="${escapar(p.id)}">${escapar(p.nome)}${p.atende ? '' : ' (fora da disponibilidade)'}</option>`).join('')}
      </select>
    </div>
    <label class="checkbox-linha"><input type="checkbox" id="forcar-troca">
      <span>Mesmo se a turma do professor estiver cheia</span></label>`;

  const { caixa, fechar } = abrirModal({
    titulo: 'Trocar professor',
    corpo,
    botoes: [
      { texto: 'Cancelar', classe: 'btn-claro' },
      {
        texto: 'Trocar',
        classe: 'btn-primario',
        autoFechar: false,
        onClick: async () => {
          const novoId = qs('#novo-professor', caixa).value;
          if (!novoId) return;
          try {
            await reatribuirProfessor(aula.id, novoId, usuario, { forcar: qs('#forcar-troca', caixa).checked });
            fechar();
            toast(`${aula.alunoNome} agora está com ${nomeDoProfessor(novoId)}.`, 'sucesso');
            await carregarTurmas();
          } catch (err) {
            toast(err instanceof ErroAgenda ? err.message : 'Não foi possível trocar o professor.', 'erro', 6000);
          }
        },
      },
    ],
  });
}

async function carregarTurmas() {
  const alvo = qs('#grade-turmas');
  alvo.innerHTML = '<div class="vazio" style="grid-column:1/-1"><span class="spinner escuro"></span></div>';

  const texto = formatarDataExtenso(diaAtual, true);
  qs('#subtitulo-painel').textContent = texto.charAt(0).toUpperCase() + texto.slice(1);

  try {
    const filtro = ehAdmin() ? professorFiltro : meuProfessorId();
    const slots = await turmasDoDia(diaAtual, filtro);
    await carregarDadosAlunos(slots.flatMap((s) => s.alunos.map((a) => a.alunoId)));
    turmasEmTela = slots;

    const comAlunos = slots.filter((s) => s.ocupados > 0);
    qs('#stat-alunos').textContent = String(comAlunos.reduce((t, s) => t + s.ocupados, 0));
    qs('#stat-turmas').textContent = String(comAlunos.length);
    qs('#stat-lotadas').textContent = String(slots.filter((s) => s.cheio && !s.individual).length);
    qs('#stat-vagas').textContent = String(
      slots.filter((s) => !s.jaPassou && !s.cheio && !s.foraDaDisponibilidade).reduce((t, s) => t + s.vagas, 0),
    );

    alvo.innerHTML = '';
    if (!slots.length) {
      alvo.append(vazio('Sem horários neste dia. Confira a aba Disponibilidade.', 'agenda'));
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
    alvo.append(vazio('Não foi possível carregar as turmas. Recarregue a página.', 'alerta'));
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
        avatarEl({ nome, fotoUrl: aluno?.fotoUrl }, 'avatar-g'),
        el('div', {}, [
          el('div', { class: 'negrito', text: nome }),
          el('div', {
            class: 'texto-peq texto-cinza',
            text: aluno?.criadoEm ? `Aluno desde ${formatarData(String(aluno.criadoEm).slice(0, 10))}` : '',
          }),
        ]),
      ]),

      el('h4', { class: 'ficha-secao', text: 'Documento e idioma' }),
      el('div', { class: 'ficha-contatos' }, [
        linhaContato('documento', rotuloDocumento(aluno), documentoFormatado(aluno), null),
        linhaContato('globo', 'Nacionalidade', nomePais(aluno?.nacionalidade), null),
        linhaContato('mensagens', 'Idioma da aula', aluno?.idioma ? `${bandeiraIdioma(aluno.idioma)} ${nomeIdioma(aluno.idioma)}` : '', null),
      ]),
      fichaDeclaracao(aula.alunoId),

      el('h4', { class: 'ficha-secao', text: 'Contato' }),
      el('div', { class: 'ficha-contatos' }, [
        linhaContato('email', 'E-mail', email, email ? `mailto:${email}` : null),
        linhaContato('telefone', 'Telefone', telefone, telefone ? `tel:${String(telefone).replace(/[^\d+]/g, '')}` : null),
        zap ? el('a', {
          class: 'btn btn-secundario btn-peq', href: `https://wa.me/${zap}`, target: '_blank', rel: 'noopener',
          text: 'Abrir no WhatsApp',
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
          text: `${formatarData(a.data)} · ${a.horario} · ${nomeDoProfessor(a.professorId)}`
            + `${a.tipo === 'individual' ? ' · particular' : ''}`,
        })))
        : null,
    );

    corpo.append(el('div', { class: 'ficha-rodape' }, [
      el('button', {
        type: 'button', class: 'btn btn-primario btn-peq', text: 'Enviar mensagem',
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
    corpo.append(vazio('Não foi possível carregar os dados deste aluno.', 'alerta'));
  }
}

function linhaContato(icone, rotulo, valor, href) {
  return el('div', { class: 'linha-contato' }, [
    el('span', { class: 'texto-min texto-cinza com-icone' }, [iconeEl(icone), rotulo]),
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
      alvo.append(vazio('Você ainda não enviou mensagens.', 'mensagens'));
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
    alvo.append(vazio('Não foi possível carregar as mensagens.', 'alerta'));
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

let mesDisp = null;              // 1º dia do mês mostrado no calendário
let diaDisp = null;              // data aberta no editor do dia
let aulasDoProfessor = [];       // aulas futuras confirmadas (para avisos)
let rascunhoAlterado = false;

const capitalizar = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const diaDaSemanaDe = (iso) => String(dataDeISO(iso).getDay());

async function carregarDisponibilidade() {
  const professorId = professorEmFoco();
  const grade = qs('#grade-semana');

  if (!professorId) {
    grade.innerHTML = '';
    grade.append(vazio('Escolha um professor no filtro acima para editar a disponibilidade.', 'filtro'));
    return;
  }

  // Só precisa dizer de quem é quando o admin está editando outro professor.
  const titulo = qs('#titulo-disponibilidade');
  titulo.textContent = professorId === meuProfessorId() ? '' : `Editando a disponibilidade do Prof. ${nomeDoProfessor(professorId)}.`;
  titulo.classList.toggle('oculto', professorId === meuProfessorId());

  grade.innerHTML = '<div class="vazio"><span class="spinner escuro"></span></div>';
  try {
    const [disp, aulas] = await Promise.all([
      obterDisponibilidade(professorId, contexto.config),
      listar('agendamentos', { professorId, status: 'confirmado' }),
    ]);
    const hoje = hojeISO();
    aulasDoProfessor = aulas.filter((a) => a.data >= hoje);
    rascunhoDisp = {
      professorId,
      semana: structuredClone(disp.semana),
      locais: { ...disp.locais },
      // Folgas no formato antigo viram ajustes de dia: um formato só na tela.
      dias: bloqueiosComoDias(disp, contexto.config),
      bloqueios: [],
    };
    if (!mesDisp) {
      const agora = new Date();
      mesDisp = new Date(agora.getFullYear(), agora.getMonth(), 1);
    }
    marcarAlterado(false);
    montarGradeSemana();
    montarCalendarioDisp();
    montarEditorDia();
  } catch (err) {
    console.error('[professor] falha ao carregar disponibilidade:', err);
    grade.innerHTML = '';
    grade.append(vazio('Não foi possível carregar a disponibilidade.', 'alerta'));
  }
}

function marcarAlterado(alterado = true) {
  rascunhoAlterado = alterado;
  const status = qs('#status-rascunho');
  status.textContent = alterado ? 'Alterações ainda não salvas.' : 'Tudo salvo.';
  status.classList.toggle('texto-laranja', alterado);
}

/** Algo mudou no rascunho: redesenha o que depende dele. */
function aposMudanca() {
  marcarAlterado();
  montarCalendarioDisp();
  montarEditorDia();
}

/* --- Calendário do mês ------------------------------------------------ */

function montarCalendarioDisp() {
  const ano = mesDisp.getFullYear();
  const mes = mesDisp.getMonth();
  const primeiro = new Date(ano, mes, 1);
  const ultimo = new Date(ano, mes + 1, 0);
  const hoje = hojeISO();
  const agora = new Date();

  qs('#disp-mes-atual').textContent = capitalizar(`${MESES[mes]} de ${ano}`);
  qs('#disp-mes-anterior').disabled = ano === agora.getFullYear() && mes === agora.getMonth();

  const grade = qs('#disp-calendario');
  grade.innerHTML = '';
  SEMANA_CURTO.forEach((d) => grade.append(el('div', { class: 'cab-dia', text: d })));
  for (let i = 0; i < primeiro.getDay(); i += 1) grade.append(el('div', { class: 'dia-cel vazio' }));

  for (let dia = 1; dia <= ultimo.getDate(); dia += 1) {
    const iso = isoDeData(new Date(ano, mes, dia));
    const passou = iso < hoje;
    const efetivos = horariosNoDia(rascunhoDisp, iso, contexto.config);
    const ajustado = Boolean(rascunhoDisp.dias[iso]);
    const folga = efetivos.length === 0;
    const aulas = aulasDoProfessor.filter((a) => a.data === iso).length;

    const titulo = folga
      ? `Folga${rascunhoDisp.dias[iso]?.motivo ? ` — ${rascunhoDisp.dias[iso].motivo}` : ''}`
      : `${efetivos.map((s) => s.horario).join(' · ')} — ${nomeLocal(contexto.mapaLocais, efetivos[0].localId)}`;

    const cel = el('button', {
      type: 'button',
      class: [
        'dia-cel',
        passou ? 'indisponivel' : 'disponivel',
        iso === hoje ? 'hoje' : '',
        iso === diaDisp ? 'selecionado' : '',
        !passou && folga ? 'cal-folga' : '',
        !passou && ajustado && !folga ? 'cal-ajustado' : '',
      ].filter(Boolean).join(' '),
      disabled: passou,
      title: passou ? '' : `${titulo}${aulas ? ` · ${aulas} aluno(s) marcado(s)` : ''}`,
      'aria-label': `${dia} de ${MESES[mes]}: ${passou ? 'passou' : titulo}`,
      dataset: { data: iso },
      onclick: passou ? null : () => { diaDisp = iso; montarCalendarioDisp(); montarEditorDia(); },
    }, [
      el('span', { text: String(dia) }),
      passou ? null : el('span', { class: 'cal-qtd', text: folga ? 'folga' : `${efetivos.length}h` }),
      !passou && aulas ? el('span', { class: 'cal-aulas', title: `${aulas} aluno(s) marcado(s)`, text: String(aulas) }) : null,
    ]);
    grade.append(cel);
  }
}

function trocarMesDisp(delta) {
  mesDisp = new Date(mesDisp.getFullYear(), mesDisp.getMonth() + delta, 1);
  montarCalendarioDisp();
}

/* --- Editor do dia ---------------------------------------------------- */

/** Garante um ajuste para a data, partindo do que vale hoje nela. */
function ajusteDoDia(iso) {
  if (!rascunhoDisp.dias[iso]) {
    const efetivos = horariosNoDia(rascunhoDisp, iso, contexto.config);
    rascunhoDisp.dias[iso] = {
      horarios: efetivos.map((s) => s.horario),
      localId: rascunhoDisp.locais[diaDaSemanaDe(iso)],
      motivo: '',
    };
  }
  return rascunhoDisp.dias[iso];
}

function montarEditorDia() {
  const corpo = qs('#editor-dia-corpo');
  corpo.innerHTML = '';
  if (!diaDisp) {
    qs('#editor-dia-titulo').textContent = 'Escolha um dia';
    corpo.append(el('p', {
      class: 'texto-peq texto-cinza',
      text: 'Selecione uma data no calendário para ver e mudar os horários dela.',
    }));
    return;
  }

  const iso = diaDisp;
  const { horarios } = contexto.config;
  const ajuste = rascunhoDisp.dias[iso];
  const efetivos = horariosNoDia(rascunhoDisp, iso, contexto.config);
  const ativos = new Set(efetivos.map((s) => s.horario));
  const nomeDia = SEMANA[Number(diaDaSemanaDe(iso))];
  const localAtual = ajuste?.localId || rascunhoDisp.locais[diaDaSemanaDe(iso)];
  const aulasNoDia = aulasDoProfessor.filter((a) => a.data === iso);

  qs('#editor-dia-titulo').textContent = capitalizar(formatarDataExtenso(iso, true));

  corpo.append(el('p', {
    class: `chip-estado ${ajuste ? 'ajustado' : ''}`,
    text: ajuste
      ? 'Ajustado só para esta data'
      : `Seguindo a semana padrão de ${nomeDia}`,
  }));

  // Horários: um botão por horário da escola, liga/desliga.
  corpo.append(el('label', { class: 'rotulo-editor', text: 'Horários em que você atende' }));
  const linha = el('div', { class: 'horarios-dia' });
  for (const h of horarios) {
    const ligado = ativos.has(h);
    linha.append(el('button', {
      type: 'button',
      class: `chip-horario ${ligado ? 'ativo' : ''}`,
      'aria-pressed': String(ligado),
      text: h,
      onclick: () => {
        const a = ajusteDoDia(iso);
        const lista = new Set(a.horarios);
        if (lista.has(h)) lista.delete(h); else lista.add(h);
        a.horarios = horarios.filter((x) => lista.has(x));
        aposMudanca();
      },
    }));
  }
  corpo.append(linha);

  const select = el('select', {
    id: 'editor-dia-local',
    onchange: (ev) => { ajusteDoDia(iso).localId = ev.target.value; aposMudanca(); },
  });
  for (const local of contexto.locais) {
    select.append(el('option', { value: local.id, text: local.nome, selected: local.id === localAtual }));
  }
  corpo.append(el('div', { class: 'campo mt-16' }, [
    el('label', { for: 'editor-dia-local', text: 'Local' }), select,
  ]));

  const motivo = el('input', {
    id: 'editor-dia-motivo',
    type: 'text',
    maxlength: '120',
    placeholder: 'Ex.: campeonato, viagem',
    value: ajuste?.motivo || '',
    onchange: (ev) => { ajusteDoDia(iso).motivo = ev.target.value; aposMudanca(); },
  });
  corpo.append(el('div', { class: 'campo' }, [
    el('label', { for: 'editor-dia-motivo', text: 'Observação (opcional)' }), motivo,
  ]));

  const acoes = el('div', { class: 'flex quebra gap-8' }, [
    el('button', {
      type: 'button', class: 'btn btn-claro btn-peq', text: 'Folga neste dia',
      onclick: () => { ajusteDoDia(iso).horarios = []; aposMudanca(); },
    }),
    el('button', {
      type: 'button', class: 'btn btn-claro btn-peq', text: 'Todos os horários',
      onclick: () => { ajusteDoDia(iso).horarios = [...horarios]; aposMudanca(); },
    }),
    ajuste ? el('button', {
      type: 'button', class: 'btn btn-fantasma btn-peq', text: 'Voltar à semana padrão',
      onclick: () => { delete rascunhoDisp.dias[iso]; aposMudanca(); },
    }) : null,
  ]);
  corpo.append(acoes);

  // Aulas já marcadas nesta data — e se alguma ficou fora do que foi marcado.
  if (aulasNoDia.length) {
    const porHorario = new Map();
    aulasNoDia.forEach((a) => porHorario.set(a.horario, (porHorario.get(a.horario) || 0) + 1));
    const lista = el('ul', { class: 'aulas-do-dia' });
    for (const [h, qtd] of [...porHorario].sort()) {
      const fora = !ativos.has(h);
      lista.append(el('li', { class: fora ? 'fora' : '' }, [
        el('strong', { text: h }),
        el('span', { text: ` · ${qtd} ${qtd === 1 ? 'aluno marcado' : 'alunos marcados'}` }),
        fora ? el('span', { class: 'texto-min', text: ' — fora dos horários marcados; a aula continua valendo' }) : null,
      ]));
    }
    corpo.append(el('label', { class: 'rotulo-editor mt-16', text: 'Aulas já marcadas' }), lista);
  }
}

/* --- Semana padrão ---------------------------------------------------- */

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
          aposMudanca();
        },
      });
      linha.append(el('td', { class: 'texto-centro' }, [caixa]));
    }

    const select = el('select', {
      'aria-label': `Local de ${SEMANA[Number(dia)]}`,
      onchange: (ev) => { rascunhoDisp.locais[dia] = ev.target.value; aposMudanca(); },
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

  const preencher = (valor) => {
    ordemDias.forEach((d) => { rascunhoDisp.semana[d] = [...valor]; });
    montarGradeSemana();
    aposMudanca();
  };
  const atalhos = el('div', { class: 'flex quebra gap-8 mt-16' }, [
    el('button', { type: 'button', class: 'btn btn-claro btn-peq', text: 'Marcar tudo', onclick: () => preencher(horarios) }),
    el('button', { type: 'button', class: 'btn btn-claro btn-peq', text: 'Desmarcar tudo', onclick: () => preencher([]) }),
  ]);

  const alvo = qs('#grade-semana');
  alvo.innerHTML = '';
  alvo.append(tabela, atalhos);
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
    marcarAlterado(false);
    await carregarDisponibilidade();
  } catch (err) {
    toast(err instanceof ErroDisponibilidade ? err.message : 'Não foi possível salvar a disponibilidade.', 'erro', 6000);
    if (!(err instanceof ErroDisponibilidade)) console.error('[professor] erro ao salvar disponibilidade:', err);
  } finally {
    restaurar();
  }
}

/* ==========================================================================
   DECLARAÇÃO NA FICHA DO ALUNO
   ========================================================================== */

function fichaDeclaracao(alunoId) {
  const decl = declaracoesAlunos.get(alunoId);
  if (!decl) {
    return el('div', { class: 'alerta alerta-aviso mt-8' }, [iconeEl('saude'), el('span', { text: 'Ainda não respondeu o questionário de saúde.' })]);
  }
  const vigente = declaracaoVigente(decl);
  const sins = (decl.respostas || []).map((r, i) => (r === 'sim' ? i : -1)).filter((i) => i >= 0);
  return el('div', { class: `alerta ${!vigente ? 'alerta-aviso' : decl.algumSim ? 'alerta-perigo' : 'alerta-sucesso'} mt-8` }, [
    iconeEl('saude'),
    el('span', { class: 'cresce' }, [
      el('strong', { text: vigente ? `PAR-Q válido até ${formatarData(String(decl.validaAte).slice(0, 10))}` : 'PAR-Q vencido' }),
      sins.length ? el('br') : null,
      sins.length ? `Respondeu SIM: ${sins.map((i) => `${i + 1}) ${PERGUNTAS.pt[i]}`).join(' · ')}` : null,
      decl.observacoes ? el('br') : null,
      decl.observacoes ? `Observações: ${decl.observacoes}` : null,
    ]),
    el('button', {
      type: 'button', class: 'btn btn-claro btn-peq', text: 'PDF',
      onclick: () => baixarPdfDeclaracao(decl).catch((e) => toast(e.message, 'erro')),
    }),
  ]);
}

/* ==========================================================================
   ABA SALDO (valor a receber pelas aulas dadas)
   ========================================================================== */

async function carregarSaldo() {
  const professorId = professorEmFoco();
  const alvoTurmas = qs('#fin-turmas');
  const alvoRepasses = qs('#fin-repasses');
  if (!professorId) {
    alvoTurmas.innerHTML = '';
    alvoTurmas.append(vazio('Escolha um professor no filtro acima.', 'grupo'));
    alvoRepasses.innerHTML = '';
    return;
  }
  alvoTurmas.innerHTML = '<div class="vazio"><span class="spinner escuro"></span></div>';
  qs('#form-repasse').classList.toggle('oculto', !ehAdmin());

  try {
    const r = await resumoFinanceiro(professorId);
    qs('#fin-saldo').textContent = formatarBRL(r.saldo);
    qs('#fin-mes').textContent = formatarBRL(r.ganhoMes);
    qs('#fin-mes-extra').textContent = `${r.aulasMes} ${r.aulasMes === 1 ? 'turma' : 'turmas'} · ${r.alunosMes} ${r.alunosMes === 1 ? 'aluno' : 'alunos'}`;
    qs('#fin-ganho').textContent = formatarBRL(r.ganho);
    qs('#fin-pago').textContent = formatarBRL(r.pago);
    qs('#fin-regra').textContent = `${nomeDoProfessor(professorId)}: ${formatarBRL(r.tabela.porAlunoGrupo)} por aluno em turma de grupo · `
      + `${formatarBRL(r.tabela.porAulaParticular)} por aula particular. Conta só aula que já aconteceu e não foi cancelada`
      + `${r.tabela.contarAusentes ? ' (falta sem justificativa conta)' : ' (falta não conta)'}. Valores definidos pela administração.`;

    alvoTurmas.innerHTML = '';
    if (!r.turmas.length) {
      alvoTurmas.append(vazio('Nenhuma aula dada ainda.', 'prancha'));
    } else {
      const tabela = el('table', { class: 'tabela' });
      tabela.innerHTML = `<thead><tr><th>Data</th><th>Horário</th><th>Alunos</th><th>Presença</th><th class="texto-direita">Valor</th></tr></thead>`;
      const corpo = el('tbody');
      for (const turma of r.turmas) {
        corpo.append(el('tr', {}, [
          el('td', { text: formatarData(turma.data) }),
          el('td', { text: `${turma.horario}${turma.particular ? ' · particular' : ''}` }),
          el('td', { text: String(turma.quantidade), title: turma.alunos.map((a) => a.alunoNome).join(', ') }),
          el('td', { class: 'texto-min', text: `${turma.presentes} ✓ · ${turma.ausentes} F` }),
          el('td', { class: 'texto-direita negrito', text: formatarBRL(turma.valor) }),
        ]));
      }
      tabela.append(corpo);
      alvoTurmas.append(tabela);
    }

    alvoRepasses.innerHTML = '';
    if (!r.repasses.length) {
      alvoRepasses.append(el('p', { class: 'texto-peq texto-cinza', text: 'Nenhum pagamento registrado ainda.' }));
    }
    for (const rep of r.repasses) {
      alvoRepasses.append(el('div', { class: 'linha-declaracao' }, [
        el('div', { class: 'cresce' }, [
          el('div', { class: 'negrito', text: formatarBRL(rep.valor) }),
          el('div', { class: 'texto-min texto-cinza', text: `${formatarData(rep.data)}${rep.observacao ? ` · ${rep.observacao}` : ''}` }),
        ]),
        ehAdmin() ? el('button', {
          type: 'button', class: 'btn btn-fantasma btn-peq', text: 'Excluir',
          onclick: async () => {
            if (!(await confirmar({ titulo: 'Excluir pagamento', mensagem: `Excluir o registro de ${formatarBRL(rep.valor)}?`, perigo: true, textoOk: 'Excluir' }))) return;
            await removerRepasse(rep.id);
            await carregarSaldo();
          },
        }) : null,
      ]));
    }
  } catch (err) {
    console.error('[professor] falha ao carregar saldo:', err);
    alvoTurmas.innerHTML = '';
    alvoTurmas.append(vazio('Não foi possível carregar o saldo.', 'alerta'));
  }
}

async function registrarRepasseUI(ev) {
  ev.preventDefault();
  const btn = qs('#form-repasse button[type=submit]');
  const restaurar = botaoCarregando(btn, 'Registrando...');
  try {
    await registrarRepasse({
      professorId: professorEmFoco(),
      valor: qs('#repasse-valor').value,
      data: qs('#repasse-data').value || hojeISO(),
      observacao: qs('#repasse-obs').value,
    }, usuario);
    qs('#form-repasse').reset();
    toast('Pagamento registrado.', 'sucesso');
    await carregarSaldo();
  } catch (err) {
    toast(err.message || 'Não foi possível registrar.', 'erro', 6000);
  } finally {
    restaurar();
  }
}

/* ==========================================================================
   ABA DECLARAÇÕES (hall dos questionários assinados)
   ========================================================================== */

let declaracoesHall = [];

async function carregarDeclaracoes() {
  const alvo = qs('#lista-declaracoes');
  alvo.innerHTML = '<div class="vazio"><span class="spinner escuro"></span></div>';
  try {
    const todas = await listar('declaracoes', {}, { ordenarPor: 'assinadoEm', direcao: 'desc' });
    // Uma linha por aluno: a declaração mais recente (as antigas ficam no histórico dele).
    const porAluno = new Map();
    for (const d of todas) if (!porAluno.has(d.alunoId)) porAluno.set(d.alunoId, { ...d, anteriores: 0 });
    for (const d of todas) {
      const atual = porAluno.get(d.alunoId);
      if (atual.id !== d.id) atual.anteriores += 1;
    }
    declaracoesHall = [...porAluno.values()].sort((a, b) => String(a.nomeCompleto).localeCompare(String(b.nomeCompleto)));
    renderizarDeclaracoes();
  } catch (err) {
    console.error('[professor] falha ao carregar declarações:', err);
    alvo.innerHTML = '';
    alvo.append(vazio('Não foi possível carregar as declarações. Confira se as regras novas do Firestore foram publicadas.', 'alerta'));
  }
}

function renderizarDeclaracoes() {
  const alvo = qs('#lista-declaracoes');
  const busca = normalizarTexto(qs('#busca-declaracao').value);
  const filtro = qs('#filtro-declaracao').value;
  const lista = declaracoesHall.filter((d) => {
    const vigente = declaracaoVigente(d);
    if (filtro === 'vigentes' && !vigente) return false;
    if (filtro === 'vencidas' && vigente) return false;
    if (filtro === 'atencao' && !d.algumSim) return false;
    if (!busca) return true;
    return normalizarTexto(`${d.nomeCompleto} ${d.alunoNome} ${d.email} ${d.documento}`).includes(busca)
      || normalizarDocumento(d.documento).includes(normalizarDocumento(busca));
  });

  alvo.innerHTML = '';
  if (!lista.length) {
    alvo.append(vazio(declaracoesHall.length ? 'Nenhuma declaração com esse filtro.' : 'Nenhum aluno respondeu o questionário ainda.', 'saude'));
    return;
  }

  const tabela = el('table', { class: 'tabela' });
  tabela.innerHTML = '<thead><tr><th>Aluno</th><th>Documento</th><th>Assinada</th><th>Situação</th><th>PAR-Q</th><th></th></tr></thead>';
  const corpo = el('tbody');
  for (const d of lista) {
    const vigente = declaracaoVigente(d);
    corpo.append(el('tr', {}, [
      el('td', {}, [
        el('div', { class: 'negrito', text: d.nomeCompleto || d.alunoNome }),
        el('div', { class: 'texto-min texto-cinza', text: d.email || '' }),
      ]),
      el('td', { class: 'texto-peq', text: d.documento ? `${d.tipoDocumento || 'CPF'} ${d.documento}` : '—' }),
      el('td', { class: 'texto-peq', text: `${formatarData(d.assinadoEm.slice(0, 10))}${d.anteriores ? ` (+${d.anteriores})` : ''}` }),
      el('td', {}, [el('span', { class: `badge ${vigente ? 'badge-sucesso' : 'badge-neutro'}`, text: vigente ? `Até ${formatarData(String(d.validaAte).slice(0, 10))}` : 'Vencida' })]),
      el('td', {}, [el('span', { class: `badge ${d.algumSim ? 'badge-perigo' : 'badge-sucesso'}`, text: d.algumSim ? 'Atenção: SIM' : 'Tudo NÃO' })]),
      el('td', { class: 'texto-direita' }, [el('button', {
        type: 'button', class: 'btn btn-claro btn-peq com-icone',
        onclick: () => baixarPdfDeclaracao(d).catch((e) => toast(e.message, 'erro')),
      }, [iconeEl('download'), 'PDF'])]),
    ]));
  }
  tabela.append(corpo);
  alvo.append(tabela);
}

const normalizarTexto = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

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
    qs('#titulo-painel').textContent = 'Turmas da escola';
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
  qs('#btn-salvar-disponibilidade').addEventListener('click', (ev) => salvarDisponibilidadeUI(ev.currentTarget));
  qs('#disp-mes-anterior').addEventListener('click', () => trocarMesDisp(-1));
  qs('#form-checkin').addEventListener('submit', checkinPorDocumento);
  qs('#form-repasse').addEventListener('submit', registrarRepasseUI);
  qs('#busca-declaracao').addEventListener('input', renderizarDeclaracoes);
  qs('#filtro-declaracao').addEventListener('change', renderizarDeclaracoes);
  qs('#disp-mes-proximo').addEventListener('click', () => trocarMesDisp(1));
  window.addEventListener('beforeunload', (ev) => {
    if (rascunhoAlterado) { ev.preventDefault(); ev.returnValue = ''; }
  });

  montarFaixaDias();

  // O menu lateral abre direto numa aba: professor.html#disponibilidade
  const inicial = location.hash.replace('#', '');
  await trocarAba(['turmas', 'saldo', 'declaracoes', 'disponibilidade', 'mensagens'].includes(inicial) ? inicial : 'turmas');

  window.addEventListener('hashchange', () => {
    const aba = location.hash.replace('#', '');
    if (aba !== abaAtual && ['turmas', 'saldo', 'declaracoes', 'disponibilidade', 'mensagens'].includes(aba)) trocarAba(aba);
  });
}

iniciar();
