/**
 * admin.js — painel administrativo (somente papel 'admin').
 *
 * Tudo que é editado aqui grava nas coleções `professores`, `pacotes`,
 * `locais`, `avisos` e `config`. Como as telas leem esses dados por
 * precos.js, qualquer alteração propaga sozinha.
 */

import { exigirAuth, sair } from '../auth.js';
import { listar, criar, atualizar, remover, obter, reiniciarDados } from '../store.js';
import { obterPacotes, obterLocais, obterConfig } from '../precos.js';
import {
  listarEquipe, adicionarProfessor, removerProfessor, aulasFuturasDoProfessor, ErroEquipe,
} from '../equipe.js';
import { listarAvisos, criarAviso, alternarAviso, removerAviso, contarLeituras, descreverJanela } from '../avisos.js';
import { recalcularVagas } from '../agenda.js';
import {
  qs, qsa, el, formatarBRL, escapar, hojeISO, montarShellPainel,
  toast, confirmar, botaoCarregando, vazio, iconeEl,
} from '../ui.js';

let usuario = null;

/* --------------------------------------------------------------------------
   Visão geral
   -------------------------------------------------------------------------- */

async function montarEstatisticas() {
  const [usuarios, agendamentos, compras, lancamentos] = await Promise.all([
    listar('usuarios'),
    listar('agendamentos'),
    listar('compras', { status: 'pago' }),
    listar('creditos'),
  ]);

  const hoje = hojeISO();
  const futuras = agendamentos.filter((a) => a.status === 'confirmado' && a.data >= hoje);
  const receita = compras.reduce((t, c) => t + (Number(c.valor) || 0), 0);
  const creditosAbertos = lancamentos.reduce((t, l) => t + (Number(l.delta) || 0), 0);

  qs('#stat-alunos').textContent = String(usuarios.filter((u) => u.papel === 'aluno').length);
  qs('#stat-aulas').textContent = String(futuras.length);
  qs('#stat-receita').textContent = formatarBRL(receita);
  qs('#stat-creditos').textContent = String(creditosAbertos);
}

/* --------------------------------------------------------------------------
   Professores
   -------------------------------------------------------------------------- */

async function montarProfessores() {
  const alvo = qs('#lista-professores');
  // Professores retirados não aparecem aqui; continuam só no histórico.
  const professores = await listarEquipe();

  alvo.innerHTML = '';
  if (!professores.length) {
    alvo.append(vazio('Nenhum professor no quadro.', 'prancha'));
    return;
  }

  for (const professor of professores) {
    const acoes = el('div', { class: 'flex gap-12 itens-centro quebra' }, [
      el('label', { class: 'checkbox-linha' }, [
        el('input', { type: 'checkbox', checked: professor.ativo !== false, dataset: { campo: 'ativo' } }),
        el('span', { text: 'Ativo' }),
      ]),
    ]);

    if (professor.ehAdmin) {
      acoes.append(el('span', { class: 'badge badge-laranja', text: 'Admin' }));
    } else {
      acoes.append(el('button', {
        type: 'button',
        class: 'btn btn-fantasma btn-peq texto-perigo',
        text: 'Retirar',
        onclick: () => retirarProfessor(professor),
      }));
    }

    alvo.append(el('div', { class: 'linha-editavel prof', dataset: { id: professor.id } }, [
      el('div', { class: 'campo' }, [
        el('label', { text: 'Nome do professor' }),
        el('input', { type: 'text', value: professor.nome, dataset: { campo: 'nome' } }),
        professor.email ? el('span', { class: 'dica', text: professor.email }) : null,
      ]),
      el('div', { class: 'campo' }, [
        el('label', { text: 'Ordem na grade' }),
        el('input', { type: 'number', min: '1', value: String(professor.ordem ?? 1), dataset: { campo: 'ordem' } }),
      ]),
      acoes,
    ]));
  }
}

async function adicionarProfessorUI(ev) {
  ev.preventDefault();
  const btn = qs('#btn-adicionar-professor');
  const nome = qs('#novo-prof-nome').value;
  const email = qs('#novo-prof-email').value;
  const senha = qs('#novo-prof-senha').value;

  const restaurar = botaoCarregando(btn, 'Cadastrando...');
  try {
    const professor = await adicionarProfessor({ nome, email, senha });
    qs('#form-professor').reset();
    toast(`${professor.nome} entrou no quadro de professores.`, 'sucesso', 4500);
    await Promise.all([montarProfessores(), montarEstatisticas()]);
  } catch (err) {
    toast(err instanceof ErroEquipe ? err.message : 'Não foi possível adicionar o professor.', 'erro', 6000);
    // Validação (e-mail repetido, senha curta) já virou mensagem na tela;
    // no console só vale registrar o que for inesperado.
    if (!(err instanceof ErroEquipe)) console.error('[admin] erro ao adicionar professor:', err);
  } finally {
    restaurar();
  }
}

async function retirarProfessor(professor) {
  // Mostra o impacto antes de confirmar: quantas aulas serão canceladas.
  const futuras = await aulasFuturasDoProfessor(professor.id);
  const impacto = futuras.length
    ? `${futuras.length} ${futuras.length === 1 ? 'aula futura será cancelada' : 'aulas futuras serão canceladas'} e o crédito volta para cada aluno.`
    : 'Ele não tem aulas futuras marcadas.';

  const confirmou = await confirmar({
    titulo: `Retirar ${professor.nome}?`,
    mensagem: `${professor.nome} perde o acesso ao sistema e sai da grade de agendamento. ${impacto} O histórico de aulas já dadas é preservado.`,
    textoOk: 'Retirar professor',
    perigo: true,
  });
  if (!confirmou) return;

  try {
    const { aulasCanceladas } = await removerProfessor(professor.id);
    toast(
      aulasCanceladas
        ? `${professor.nome} saiu do quadro. ${aulasCanceladas} aula(s) cancelada(s) com estorno.`
        : `${professor.nome} saiu do quadro de professores.`,
      'sucesso',
      5000,
    );
    await Promise.all([montarProfessores(), montarEstatisticas()]);
  } catch (err) {
    toast(err instanceof ErroEquipe ? err.message : 'Não foi possível retirar o professor.', 'erro', 6000);
    if (!(err instanceof ErroEquipe)) console.error('[admin] erro ao retirar professor:', err);
  }
}

async function salvarProfessores(btn) {
  const restaurar = botaoCarregando(btn, 'Salvando...');
  try {
    for (const linha of qsa('#lista-professores .linha-editavel')) {
      const id = linha.dataset.id;
      const nome = qs('[data-campo="nome"]', linha).value.trim();
      const ordem = Number(qs('[data-campo="ordem"]', linha).value) || 1;
      const ativo = qs('[data-campo="ativo"]', linha).checked;

      if (!nome) {
        toast('O nome do professor não pode ficar vazio.', 'erro');
        restaurar();
        return;
      }

      await atualizar('professores', id, { nome, ordem, ativo });

      // Mantém o nome do usuário em sincronia com o do professor.
      // Se o usuário correspondente não existir (dado inconsistente), o
      // professor já foi salvo — não vale abortar o restante por isso.
      const professor = await obter('professores', id);
      if (professor?.usuarioId) {
        try {
          await atualizar('usuarios', professor.usuarioId, { nome });
        } catch (err) {
          console.warn(`[admin] não foi possível sincronizar o nome do usuário ${professor.usuarioId}:`, err);
        }
      }
    }
    toast('Professores atualizados.', 'sucesso');
    await montarProfessores();
  } catch (err) {
    console.error('[admin] erro ao salvar professores:', err);
    toast('Não foi possível salvar os professores.', 'erro');
  } finally {
    restaurar();
  }
}

/* --------------------------------------------------------------------------
   Preços
   -------------------------------------------------------------------------- */

async function montarPrecos() {
  const alvo = qs('#lista-precos');
  const pacotes = await obterPacotes({ incluirInativos: true });

  alvo.innerHTML = '';
  for (const pacote of pacotes) {
    alvo.append(el('div', { class: 'linha-editavel precos', dataset: { id: pacote.id } }, [
      el('div', { class: 'campo' }, [
        el('label', { text: 'Nome do plano' }),
        el('input', { type: 'text', value: pacote.nome, dataset: { campo: 'nome' } }),
      ]),
      el('div', { class: 'campo' }, [
        el('label', { text: 'Preço (R$)' }),
        el('input', {
          type: 'number', min: '0', step: '10',
          value: String(pacote.preco), dataset: { campo: 'preco' },
        }),
      ]),
      el('div', { class: 'campo' }, [
        el('label', { text: 'Créditos' }),
        el('input', {
          type: 'number', min: '1',
          value: String(pacote.creditos), dataset: { campo: 'creditos' },
        }),
      ]),
      el('div', { class: 'flex-col gap-4' }, [
        el('label', { class: 'checkbox-linha' }, [
          el('input', { type: 'checkbox', checked: pacote.destaque === true, dataset: { campo: 'destaque' } }),
          el('span', { text: 'Destaque' }),
        ]),
        el('label', { class: 'checkbox-linha' }, [
          el('input', { type: 'checkbox', checked: pacote.ativo !== false, dataset: { campo: 'ativo' } }),
          el('span', { text: 'Ativo' }),
        ]),
      ]),
    ]));
  }
}

async function salvarPrecos(btn) {
  const restaurar = botaoCarregando(btn, 'Salvando...');
  try {
    for (const linha of qsa('#lista-precos .linha-editavel')) {
      const id = linha.dataset.id;
      const nome = qs('[data-campo="nome"]', linha).value.trim();
      const preco = Number(qs('[data-campo="preco"]', linha).value);
      const creditos = Number(qs('[data-campo="creditos"]', linha).value);

      if (!nome || !Number.isFinite(preco) || preco < 0 || !Number.isFinite(creditos) || creditos < 1) {
        toast(`Confira os dados do plano "${nome || id}". Preço e créditos precisam ser válidos.`, 'erro', 5000);
        restaurar();
        return;
      }

      await atualizar('pacotes', id, {
        nome,
        preco,
        creditos,
        destaque: qs('[data-campo="destaque"]', linha).checked,
        ativo: qs('[data-campo="ativo"]', linha).checked,
      });
    }
    toast('Preços atualizados. A página inicial já mostra os novos valores.', 'sucesso', 4500);
    await montarPrecos();
  } catch (err) {
    console.error('[admin] erro ao salvar preços:', err);
    toast('Não foi possível salvar os preços.', 'erro');
  } finally {
    restaurar();
  }
}

/* --------------------------------------------------------------------------
   Locais
   -------------------------------------------------------------------------- */

async function montarLocais() {
  const [locais, config] = await Promise.all([
    obterLocais({ incluirInativos: true }),
    obterConfig(),
  ]);

  const alvo = qs('#lista-locais');
  alvo.innerHTML = '';

  for (const local of locais) {
    alvo.append(el('div', { class: 'linha-editavel', dataset: { id: local.id } }, [
      el('div', { class: 'campo' }, [
        el('label', { text: 'Nome' }),
        el('input', { type: 'text', value: local.nome, dataset: { campo: 'nome' } }),
      ]),
      el('div', { class: 'campo' }, [
        el('label', { text: 'Ponto de encontro' }),
        el('input', { type: 'text', value: local.descricao || '', dataset: { campo: 'descricao' } }),
      ]),
      el('div', { class: 'flex gap-12 itens-centro' }, [
        el('label', { class: 'checkbox-linha' }, [
          el('input', { type: 'checkbox', checked: local.ativo !== false, dataset: { campo: 'ativo' } }),
          el('span', { text: 'Ativo' }),
        ]),
        el('button', {
          class: 'btn btn-fantasma btn-peq',
          text: 'Excluir',
          type: 'button',
          onclick: () => excluirLocal(local),
        }),
      ]),
    ]));
  }

  // Seletor de local padrão
  const select = qs('#local-padrao');
  select.innerHTML = '';
  for (const local of locais.filter((l) => l.ativo !== false)) {
    select.append(el('option', {
      value: local.id,
      text: local.nome,
      selected: local.id === config.localPadraoId,
    }));
  }
}

async function excluirLocal(local) {
  const confirmou = await confirmar({
    titulo: 'Excluir local',
    mensagem: `Excluir "${local.nome}"? As aulas já marcadas neste local continuam registradas, mas ele deixa de aparecer nas opções.`,
    textoOk: 'Excluir',
    perigo: true,
  });
  if (!confirmou) return;

  try {
    await remover('locais', local.id);
    toast('Local excluído.', 'sucesso');
    await montarLocais();
  } catch (err) {
    console.error('[admin] erro ao excluir local:', err);
    toast('Não foi possível excluir o local.', 'erro');
  }
}

async function adicionarLocal(ev) {
  ev.preventDefault();
  const nome = qs('#novo-local-nome').value.trim();
  const descricao = qs('#novo-local-desc').value.trim();

  if (!nome) {
    toast('Informe o nome do local.', 'aviso');
    return;
  }

  try {
    await criar('locais', { nome, descricao, ativo: true });
    qs('#novo-local-nome').value = '';
    qs('#novo-local-desc').value = '';
    toast('Local adicionado.', 'sucesso');
    await montarLocais();
  } catch (err) {
    console.error('[admin] erro ao adicionar local:', err);
    toast('Não foi possível adicionar o local.', 'erro');
  }
}

async function salvarLocais(btn) {
  const restaurar = botaoCarregando(btn, 'Salvando...');
  try {
    for (const linha of qsa('#lista-locais .linha-editavel')) {
      const nome = qs('[data-campo="nome"]', linha).value.trim();
      if (!nome) {
        toast('O nome do local não pode ficar vazio.', 'erro');
        restaurar();
        return;
      }
      await atualizar('locais', linha.dataset.id, {
        nome,
        descricao: qs('[data-campo="descricao"]', linha).value.trim(),
        ativo: qs('[data-campo="ativo"]', linha).checked,
      });
    }

    await salvarConfig({ localPadraoId: qs('#local-padrao').value });
    toast('Locais atualizados.', 'sucesso');
    await montarLocais();
  } catch (err) {
    console.error('[admin] erro ao salvar locais:', err);
    toast('Não foi possível salvar os locais.', 'erro');
  } finally {
    restaurar();
  }
}

/* --------------------------------------------------------------------------
   Avisos
   -------------------------------------------------------------------------- */

const ICONES_AVISO = { info: 'info', aviso: 'alerta', urgente: 'urgente' };

async function montarAvisos() {
  const alvo = qs('#lista-avisos');
  const avisos = await listarAvisos();

  alvo.innerHTML = '';
  if (!avisos.length) {
    alvo.append(vazio('Nenhum aviso publicado ainda.', 'megafone'));
    return;
  }

  for (const aviso of avisos) {
    const leituras = await contarLeituras(aviso.id);

    const card = el('div', { class: 'card mb-16', style: 'box-shadow:none' }, [
      el('div', { class: 'flex entre itens-centro gap-8 mb-8' }, [
        el('h4', { class: `com-icone aviso-${aviso.tipo}` }, [iconeEl(ICONES_AVISO[aviso.tipo] || 'info'), aviso.titulo]),
        el('span', {
          class: `badge ${aviso.vigente ? 'badge-sucesso' : 'badge-neutro'}`,
          text: aviso.vigente ? 'No ar' : 'Inativo',
        }),
      ]),
      el('p', { class: 'texto-peq texto-cinza', text: aviso.mensagem }),
      el('p', {
        class: 'texto-min texto-cinza mt-8',
        text: `${descreverJanela(aviso)} · ${leituras} ${leituras === 1 ? 'aluno confirmou' : 'alunos confirmaram'} a leitura`,
      }),
    ]);

    card.append(el('div', { class: 'flex gap-8 mt-8' }, [
      el('button', {
        class: 'btn btn-claro btn-peq',
        type: 'button',
        text: aviso.ativo === false ? 'Reativar' : 'Desativar',
        onclick: async () => {
          await alternarAviso(aviso.id, aviso.ativo === false);
          toast(aviso.ativo === false ? 'Aviso reativado.' : 'Aviso desativado.', 'sucesso');
          await montarAvisos();
        },
      }),
      el('button', {
        class: 'btn btn-fantasma btn-peq',
        type: 'button',
        text: 'Excluir',
        onclick: async () => {
          const confirmou = await confirmar({
            titulo: 'Excluir aviso',
            mensagem: `Excluir o aviso "${aviso.titulo}"?`,
            textoOk: 'Excluir',
            perigo: true,
          });
          if (!confirmou) return;
          await removerAviso(aviso.id);
          toast('Aviso excluído.', 'sucesso');
          await montarAvisos();
        },
      }),
    ]));

    alvo.append(card);
  }
}

async function publicarAviso(ev) {
  ev.preventDefault();

  const titulo = qs('#aviso-titulo').value.trim();
  const mensagem = qs('#aviso-mensagem').value.trim();
  const tipo = qs('#aviso-tipo').value;
  const inicio = qs('#aviso-inicio').value;
  const fim = qs('#aviso-fim').value;

  if (!titulo || !mensagem) {
    toast('Preencha o título e a mensagem do aviso.', 'aviso');
    return;
  }
  if (inicio && fim && fim < inicio) {
    toast('A data final não pode ser anterior à inicial.', 'erro');
    return;
  }

  try {
    await criarAviso({
      titulo,
      mensagem,
      tipo,
      // Fim do dia, para o aviso valer durante toda a data escolhida.
      inicioEm: inicio ? new Date(`${inicio}T00:00:00`).toISOString() : null,
      fimEm: fim ? new Date(`${fim}T23:59:59`).toISOString() : null,
      criadoPor: usuario.id,
    });

    qs('#form-aviso').reset();
    toast('Aviso publicado! Os alunos verão no próximo acesso.', 'sucesso', 4500);
    await montarAvisos();
  } catch (err) {
    console.error('[admin] erro ao publicar aviso:', err);
    toast(err.message || 'Não foi possível publicar o aviso.', 'erro');
  }
}

/* --------------------------------------------------------------------------
   Horários e configuração
   -------------------------------------------------------------------------- */

let horariosEditaveis = [];

function renderizarHorarios() {
  const alvo = qs('#lista-horarios');
  alvo.innerHTML = '';

  if (!horariosEditaveis.length) {
    alvo.append(el('span', { class: 'texto-peq texto-cinza', text: 'Nenhum horário configurado.' }));
    return;
  }

  for (const horario of horariosEditaveis) {
    alvo.append(el('span', { class: 'badge badge-laranja', style: 'padding:8px 12px' }, [
      el('span', { text: horario }),
      el('button', {
        type: 'button',
        style: 'background:none;border:none;color:inherit;font-size:1rem;padding:0 0 0 6px',
        'aria-label': `Remover horário ${horario}`,
        text: '✕',
        onclick: () => {
          horariosEditaveis = horariosEditaveis.filter((h) => h !== horario);
          renderizarHorarios();
        },
      }),
    ]));
  }
}

async function montarHorarios() {
  const config = await obterConfig();
  horariosEditaveis = [...config.horarios];
  renderizarHorarios();

  qs('#cfg-capacidade').value = String(config.capacidadeGrupo);
  qs('#cfg-duracao').value = String(config.duracaoMin);
  qs('#cfg-cancelamento').value = String(config.horasMinimasCancelamento);
}

/** Grava campos no documento `config/app`, criando-o se ainda não existir. */
async function salvarConfig(campos) {
  const existente = await obter('config', 'app');
  const dados = { ...campos, atualizadoEm: new Date().toISOString() };

  if (existente) await atualizar('config', 'app', dados);
  else await criar('config', { id: 'app', ...dados });
}

async function salvarHorarios(btn) {
  const capacidade = Number(qs('#cfg-capacidade').value);
  const duracao = Number(qs('#cfg-duracao').value);
  const cancelamento = Number(qs('#cfg-cancelamento').value);

  if (!horariosEditaveis.length) {
    toast('Configure pelo menos um horário de aula.', 'erro');
    return;
  }
  if (!Number.isFinite(capacidade) || capacidade < 1) {
    toast('A capacidade precisa ser de pelo menos 1 aluno.', 'erro');
    return;
  }
  if (!Number.isFinite(duracao) || duracao < 30) {
    toast('A duração precisa ser de pelo menos 30 minutos.', 'erro');
    return;
  }

  const restaurar = botaoCarregando(btn, 'Salvando...');
  try {
    await salvarConfig({
      horarios: [...horariosEditaveis].sort(),
      capacidadeGrupo: capacidade,
      duracaoMin: duracao,
      horasMinimasCancelamento: Number.isFinite(cancelamento) ? cancelamento : 12,
    });
    toast('Configurações salvas.', 'sucesso');
    await montarHorarios();
  } catch (err) {
    console.error('[admin] erro ao salvar configurações:', err);
    toast('Não foi possível salvar as configurações.', 'erro');
  } finally {
    restaurar();
  }
}

async function recalcularVagasUI(btn) {
  const restaurar = botaoCarregando(btn, 'Recontando...');
  try {
    const { turmas, corrigidas } = await recalcularVagas();
    toast(
      corrigidas
        ? `Lotação recontada: ${corrigidas} de ${turmas} turma(s) futura(s) corrigida(s).`
        : `Tudo certo: as ${turmas} turma(s) futura(s) já estavam com a lotação correta.`,
      'sucesso',
      6000,
    );
  } catch (err) {
    console.error('[admin] erro ao recalcular vagas:', err);
    toast('Não foi possível recalcular as vagas. Confira se as regras novas do Firestore foram publicadas.', 'erro', 7000);
  } finally {
    restaurar();
  }
}

async function reiniciarDemo() {
  const confirmou = await confirmar({
    titulo: 'Reiniciar dados de demonstração',
    mensagem: 'Todos os cadastros, agendamentos e compras feitos neste navegador serão apagados e substituídos pelos dados de exemplo. Esta ação não pode ser desfeita.',
    textoOk: 'Sim, reiniciar',
    perigo: true,
  });
  if (!confirmou) return;

  try {
    await reiniciarDados();
    toast('Dados reiniciados. Recarregando...', 'sucesso', 1500);
    setTimeout(() => location.reload(), 1200);
  } catch (err) {
    console.error('[admin] erro ao reiniciar:', err);
    toast('Não foi possível reiniciar os dados.', 'erro');
  }
}

/* --------------------------------------------------------------------------
   Inicialização
   -------------------------------------------------------------------------- */

async function iniciar() {
  usuario = await exigirAuth(['admin']);

  montarShellPainel({
    usuario,
    paginaAtual: 'admin',
    aoSair: () => sair(),
  });

  // Abas
  qsa('#abas-admin .aba').forEach((btn) => {
    btn.addEventListener('click', () => {
      qsa('#abas-admin .aba').forEach((b) => b.classList.toggle('ativa', b === btn));
      qsa('.painel-aba').forEach((p) => p.classList.toggle('ativo', p.dataset.painel === btn.dataset.aba));
    });
  });

  // Ações
  qs('#btn-salvar-professores').addEventListener('click', (ev) => salvarProfessores(ev.currentTarget));
  qs('#btn-salvar-precos').addEventListener('click', (ev) => salvarPrecos(ev.currentTarget));
  qs('#btn-salvar-locais').addEventListener('click', (ev) => salvarLocais(ev.currentTarget));
  qs('#btn-salvar-horarios').addEventListener('click', (ev) => salvarHorarios(ev.currentTarget));
  qs('#form-professor').addEventListener('submit', adicionarProfessorUI);
  qs('#form-local').addEventListener('submit', adicionarLocal);
  qs('#form-aviso').addEventListener('submit', publicarAviso);
  qs('#btn-reiniciar').addEventListener('click', reiniciarDemo);
  qs('#btn-recalcular-vagas').addEventListener('click', (ev) => recalcularVagasUI(ev.currentTarget));

  qs('#btn-add-horario').addEventListener('click', () => {
    const input = qs('#novo-horario');
    const valor = input.value;
    if (!valor) {
      toast('Escolha um horário para adicionar.', 'aviso');
      return;
    }
    if (horariosEditaveis.includes(valor)) {
      toast('Este horário já está na grade.', 'aviso');
      return;
    }
    horariosEditaveis = [...horariosEditaveis, valor].sort();
    renderizarHorarios();
    input.value = '';
  });

  try {
    await Promise.all([
      montarEstatisticas(),
      montarProfessores(),
      montarPrecos(),
      montarLocais(),
      montarAvisos(),
      montarHorarios(),
    ]);
  } catch (err) {
    console.error('[admin] falha ao carregar o painel:', err);
    toast('Alguns dados não carregaram. Recarregue a página.', 'erro');
  }
}

iniciar();
