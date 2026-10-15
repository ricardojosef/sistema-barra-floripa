/**
 * dashboard.js — painel do aluno.
 *
 * Mostra saldo de créditos, próximas aulas, créditos por origem e os
 * pacotes à venda. Exibe também os avisos publicados pelo administrador.
 */

import { exigirAuth, sair } from '../auth.js';
import { resumoAluno, creditosPorOrigem } from '../creditos.js';
import { proximasAulasDoAluno, cancelar, ErroAgenda } from '../agenda.js';
import { carregarContexto, obterPacotes, nomeProfessor, nomeLocal } from '../precos.js';
import { mostrarAvisosPendentes } from '../avisos.js';
import {
  qs, el, formatarBRL, formatarDataExtenso, faixaHorario, MESES_CURTO,
  dataDeISO, primeiroNome, montarShellPainel, toast, confirmar, paramUrl, vazio,
} from '../ui.js';

let usuario = null;
let contexto = null;

/* --------------------------------------------------------------------------
   Blocos da tela
   -------------------------------------------------------------------------- */

function itemAula(aula) {
  const data = dataDeISO(aula.data);
  const professor = nomeProfessor(contexto.mapaProfessores, aula.professorId, aula.professorNome);
  const local = nomeLocal(contexto.mapaLocais, aula.localId);
  const titulo = aula.tipo === 'individual'
    ? 'Aula Individual'
    : `Aula em Grupo — ${professor}`;

  const item = el('div', { class: 'item-aula' }, [
    el('div', { class: 'data-bloco' }, [
      el('span', { class: 'dia', text: String(data.getDate()).padStart(2, '0') }),
      el('span', { class: 'mes', text: MESES_CURTO[data.getMonth()] }),
    ]),
    el('div', { class: 'info' }, [
      el('div', { class: 'titulo', text: titulo }),
      el('div', {
        class: 'meta',
        text: `${faixaHorario(aula.horario, aula.duracaoMin)} · ${professor} · ${local}`,
      }),
    ]),
  ]);

  const acoes = el('div', { class: 'flex-col gap-4 itens-centro' });
  acoes.append(el('span', { class: 'badge badge-sucesso', text: 'Confirmada' }));
  acoes.append(el('button', {
    class: 'btn btn-fantasma btn-peq',
    text: 'Cancelar',
    onclick: () => cancelarAula(aula),
  }));
  item.append(acoes);

  return item;
}

async function cancelarAula(aula) {
  const quando = `${formatarDataExtenso(aula.data)} às ${aula.horario}`;
  const confirmou = await confirmar({
    titulo: 'Cancelar aula',
    mensagem: `Cancelar a aula de ${quando}? O crédito volta para a sua conta e você poderá agendar outro horário.`,
    textoOk: 'Sim, cancelar',
    textoCancelar: 'Voltar',
    perigo: true,
  });
  if (!confirmou) return;

  try {
    await cancelar(aula.id, { id: usuario.id, nome: usuario.nome, papel: usuario.papel });
    toast('Aula cancelada. Seu crédito foi devolvido.', 'sucesso');
    await carregarTudo();
  } catch (err) {
    const mensagem = err instanceof ErroAgenda ? err.message : 'Não foi possível cancelar a aula.';
    toast(mensagem, 'erro', 6000);
    console.error('[dashboard] erro ao cancelar:', err);
  }
}

async function montarProximas() {
  const alvo = qs('#lista-proximas');
  const aulas = await proximasAulasDoAluno(usuario.id);

  alvo.innerHTML = '';
  if (!aulas.length) {
    alvo.append(vazio(
      'Você ainda não tem aulas agendadas.',
      '🏄',
      { href: 'agendar.html', texto: 'Agendar agora' },
    ));
    return aulas;
  }

  aulas.forEach((aula) => alvo.append(itemAula(aula)));
  return aulas;
}

async function montarCreditos(saldo) {
  const alvo = qs('#lista-creditos');
  alvo.innerHTML = '';

  if (saldo <= 0) {
    alvo.append(vazio(
      'Você não tem créditos disponíveis.',
      '🎟️',
      { href: 'checkout.html', texto: 'Comprar pacote' },
    ));
    return;
  }

  const origens = await creditosPorOrigem(usuario.id);
  for (const origem of origens) {
    alvo.append(el('div', { class: 'cartao-credito' }, [
      el('div', { class: 'qtd', text: String(origem.quantidade) }),
      el('div', {
        class: 'rotulo',
        text: origem.quantidade === 1
          ? `Crédito ${origem.tipo === 'individual' ? 'Individual' : 'Grupo'}`
          : `Créditos ${origem.tipo === 'individual' ? 'Individuais' : 'Grupo'}`,
      }),
      el('div', { class: 'origem', text: origem.nomePacote }),
      el('a', { class: 'btn btn-primario btn-peq', href: 'agendar.html', text: 'Usar agora' }),
    ]));
  }
}

async function montarMiniPacotes() {
  const alvo = qs('#mini-pacotes');
  const pacotes = await obterPacotes();

  // Mostra os mais procurados, com o destacado sempre presente.
  const selecionados = pacotes
    .filter((p) => ['pac-4', 'pac-9', 'pac-mensal-2x'].includes(p.id) || p.destaque)
    .slice(0, 4);

  alvo.innerHTML = '';
  for (const pacote of selecionados) {
    alvo.append(el('a', {
      class: 'mini-pacote',
      href: `checkout.html?pacote=${encodeURIComponent(pacote.id)}`,
    }, [
      el('span', { text: pacote.nome }),
      el('span', {
        class: 'preco',
        text: formatarBRL(pacote.preco) + (pacote.tipo === 'mensal' ? '/mês' : ''),
      }),
    ]));
  }
}

function montarEstatisticas(resumo, proximaAula) {
  qs('#stat-creditos').textContent = String(resumo.saldo);
  qs('#stat-mes').textContent = String(resumo.aulasNoMes);

  const chip = qs('#chip-creditos-valor');
  if (chip) chip.textContent = String(resumo.saldo);

  if (proximaAula) {
    const data = dataDeISO(proximaAula.data);
    qs('#stat-proxima').textContent = `${String(data.getDate()).padStart(2, '0')}/${String(data.getMonth() + 1).padStart(2, '0')}`;
    const professor = nomeProfessor(contexto.mapaProfessores, proximaAula.professorId, proximaAula.professorNome);
    qs('#stat-proxima-detalhe').textContent = `${proximaAula.horario}h · ${professor}`;
  } else {
    qs('#stat-proxima').textContent = '—';
    qs('#stat-proxima-detalhe').textContent = 'Nenhuma aula agendada';
  }

  // Aviso quando não há créditos nem aulas marcadas.
  const alerta = qs('#alerta-creditos');
  alerta.innerHTML = '';
  if (resumo.saldo === 0 && resumo.totalAgendadas === 0) {
    alerta.innerHTML = `
      <div class="alerta alerta-aviso">
        <span>🎟️</span>
        <span class="cresce">
          Você está sem créditos. Escolha um pacote para voltar a agendar.
        </span>
        <a href="checkout.html" class="negrito">Ver planos →</a>
      </div>`;
  }
}

/* --------------------------------------------------------------------------
   Carga
   -------------------------------------------------------------------------- */

async function carregarTudo() {
  contexto = await carregarContexto();
  const resumo = await resumoAluno(usuario.id);
  const aulas = await montarProximas();

  montarEstatisticas(resumo, aulas[0] || null);
  await Promise.all([montarCreditos(resumo.saldo), montarMiniPacotes()]);
}

async function iniciar() {
  usuario = await exigirAuth(['aluno']);

  montarShellPainel({
    usuario,
    paginaAtual: 'inicio',
    chipCreditos: true,
    aoSair: () => sair(),
  });

  qs('#saudacao-nome').textContent = primeiroNome(usuario.nome);
  const hoje = new Date();
  const dataFormatada = formatarDataExtenso(
    `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`,
    true,
  );
  qs('#saudacao-data').textContent = `${dataFormatada.charAt(0).toUpperCase()}${dataFormatada.slice(1)} · Florianópolis`;

  try {
    await carregarTudo();
  } catch (err) {
    console.error('[dashboard] falha ao carregar:', err);
    toast('Não foi possível carregar seus dados. Recarregue a página.', 'erro');
  }

  // Mensagens vindas de outras telas
  if (paramUrl('compra') === 'ok') {
    toast('Pagamento confirmado! Seus créditos já estão disponíveis. 🎉', 'sucesso', 5000);
    history.replaceState(null, '', 'dashboard.html');
  }
  if (paramUrl('agendado') === 'ok') {
    toast('Aula agendada com sucesso! 🏄', 'sucesso', 4000);
    history.replaceState(null, '', 'dashboard.html');
  }

  // Avisos do administrador, depois que a tela já está montada.
  try {
    await mostrarAvisosPendentes(usuario.id);
  } catch (err) {
    console.error('[dashboard] falha ao mostrar avisos:', err);
  }
}

iniciar();
