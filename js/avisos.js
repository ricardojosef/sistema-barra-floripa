/**
 * avisos.js — avisos pop-up que o administrador publica para os alunos.
 *
 * O aviso aparece no dashboard do aluno enquanto estiver ativo, dentro da
 * janela de datas e ainda não confirmado por ele. A confirmação é gravada
 * em `avisosLidos` com id determinístico `<alunoId>_<avisoId>`, o que evita
 * registros duplicados se o aluno clicar duas vezes.
 */

import { listar, criar, obter, atualizar, remover } from './store.js';
import {
  abrirModal, escapar, formatarData, icone as svgIcone, dataDeISO, isoDeData,
} from './ui.js';

/** Id determinístico da confirmação de leitura. */
const idLeitura = (alunoId, avisoId) => `${alunoId}_${avisoId}`;

/** Um aviso está no ar se está ativo e dentro da janela de datas. */
export function avisoVigente(aviso, agora = new Date()) {
  if (!aviso || aviso.ativo === false) return false;
  if (aviso.inicioEm && new Date(aviso.inicioEm) > agora) return false;
  if (aviso.fimEm && new Date(aviso.fimEm) < agora) return false;
  return true;
}

/** Avisos que este aluno ainda precisa ver. */
export async function avisosPendentes(alunoId) {
  const [todos, lidos] = await Promise.all([
    listar('avisos'),
    listar('avisosLidos', { alunoId }),
  ]);

  const jaLidos = new Set(lidos.map((l) => l.avisoId));
  const agora = new Date();

  return todos
    .filter((a) => avisoVigente(a, agora) && !jaLidos.has(a.id))
    .sort((a, b) => String(a.criadoEm).localeCompare(String(b.criadoEm)));
}

/** Marca o aviso como lido. Idempotente. */
export async function marcarComoLido(alunoId, avisoId) {
  const id = idLeitura(alunoId, avisoId);
  const existente = await obter('avisosLidos', id);
  if (existente) return existente;

  return criar('avisosLidos', {
    id,
    alunoId,
    avisoId,
    lidoEm: new Date().toISOString(),
  });
}

const ICONES = { info: 'info', aviso: 'alerta', urgente: 'urgente' };

/**
 * Mostra os avisos pendentes, um de cada vez. Cada "Entendi" grava a leitura
 * e abre o próximo. Fechar sem confirmar (Esc) não grava — o aviso volta no
 * próximo acesso, que é o comportamento desejado para algo importante.
 */
export async function mostrarAvisosPendentes(alunoId) {
  const pendentes = await avisosPendentes(alunoId);
  if (!pendentes.length) return 0;

  let confirmados = 0;

  for (let i = 0; i < pendentes.length; i += 1) {
    const aviso = pendentes[i];
    const icone = svgIcone(ICONES[aviso.tipo] || ICONES.info);
    const contador = pendentes.length > 1
      ? `<p class="contador">Aviso ${i + 1} de ${pendentes.length}</p>`
      : '';

    const { promessa } = abrirModal({
      titulo: null,
      classe: 'modal-aviso',
      fecharFora: false,
      corpo: `
        <div class="icone-aviso">${icone}</div>
        <h3 class="texto-centro mb-8">${escapar(aviso.titulo)}</h3>
        <p class="texto-centro texto-cinza">${escapar(aviso.mensagem)}</p>
        ${aviso.datasSemAula?.length ? `
        <div class="alerta alerta-perigo mt-16">
          <span class="cresce"><strong>Não haverá aulas em ${escapar(aviso.datasSemAula.map(formatarData).join(', '))}.</strong>
          Quem tinha aula marcada recebeu o crédito de volta — reagende em <a href="agendar.html">Agendar aula</a>.</span>
        </div>` : ''}
        ${contador}`,
      botoes: [
        { texto: 'Entendi', classe: 'btn-primario', valor: 'lido' },
      ],
    });

    const resultado = await promessa;
    if (resultado === 'lido') {
      await marcarComoLido(alunoId, aviso.id);
      confirmados += 1;
    } else {
      // Fechou sem confirmar: para a fila e deixa os demais para depois.
      break;
    }
  }

  return confirmados;
}

/* --------------------------------------------------------------------------
   Administração
   -------------------------------------------------------------------------- */

/** Todos os avisos, do mais novo para o mais antigo. */
export async function listarAvisos() {
  const todos = await listar('avisos', {}, { ordenarPor: 'criadoEm', direcao: 'desc' });
  const agora = new Date();
  return todos.map((a) => ({ ...a, vigente: avisoVigente(a, agora) }));
}

export function criarAviso({
  titulo, mensagem, tipo = 'info', inicioEm = null, fimEm = null, criadoPor = null, datasSemAula = [],
}) {
  const tituloNorm = String(titulo || '').trim();
  const mensagemNorm = String(mensagem || '').trim();
  if (!tituloNorm) throw new Error('Informe o título do aviso.');
  if (!mensagemNorm) throw new Error('Informe a mensagem do aviso.');

  return criar('avisos', {
    titulo: tituloNorm,
    mensagem: mensagemNorm,
    tipo,
    ativo: true,
    inicioEm: inicioEm || new Date().toISOString(),
    fimEm: fimEm || null,
    datasSemAula,
    criadoPor,
    criadoEm: new Date().toISOString(),
  });
}

export const alternarAviso = (avisoId, ativo) => atualizar('avisos', avisoId, { ativo });

export const atualizarAviso = (avisoId, campos) => atualizar('avisos', avisoId, campos);

/**
 * Remove o aviso e as confirmações de leitura associadas, para não deixar
 * registros órfãos apontando para um aviso que não existe mais. Se o aviso
 * bloqueava datas, elas voltam a aceitar agendamento (as aulas canceladas
 * continuam canceladas — o crédito já foi devolvido).
 */
export async function removerAviso(avisoId) {
  const leituras = await listar('avisosLidos', { avisoId });
  for (const leitura of leituras) await remover('avisosLidos', leitura.id);
  await liberarDatasDoAviso(avisoId);
  return remover('avisos', avisoId);
}

/* --------------------------------------------------------------------------
   Datas sem aula (tempestade, indisponibilidade)
   -------------------------------------------------------------------------- */

/** Lista de datas 'YYYY-MM-DD' entre `de` e `ate`, inclusive (máx. 31). */
export function intervaloDeDatas(de, ate) {
  if (!de) return [];
  const fim = ate && ate >= de ? ate : de;
  const datas = [];
  const cursor = dataDeISO(de);
  while (isoDeData(cursor) <= fim && datas.length < 31) {
    datas.push(isoDeData(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return datas;
}

async function gravarDiasSemAula(transformar) {
  const config = await obter('config', 'app');
  const atuais = Array.isArray(config?.diasSemAula) ? config.diasSemAula : [];
  const hoje = isoDeData(new Date());
  // Datas que já passaram não servem para nada: saem da lista.
  const novos = transformar(atuais).filter((d) => d.data >= hoje);
  if (config) await atualizar('config', 'app', { diasSemAula: novos });
  else await criar('config', { id: 'app', diasSemAula: novos });
}

async function liberarDatasDoAviso(avisoId) {
  try {
    await gravarDiasSemAula((atuais) => atuais.filter((d) => d.avisoId !== avisoId));
  } catch (err) {
    console.warn('[avisos] não foi possível liberar as datas do aviso:', err);
  }
}

/**
 * Publica um aviso de "não haverá aulas":
 *  1. bloqueia as datas para novos agendamentos;
 *  2. cancela as aulas já marcadas nelas, devolvendo o crédito de cada aluno;
 *  3. manda a cada aluno afetado uma mensagem explícita pedindo para
 *     reagendar (a mensagem também sai por e-mail, pelo servidor).
 */
export async function publicarAvisoSemAula({ aviso, datas, admin }) {
  const { cancelarDatas } = await import('./agenda.js');
  const { enviarMensagem } = await import('./mensagens.js');

  await gravarDiasSemAula((atuais) => [
    ...atuais.filter((d) => !datas.includes(d.data)),
    ...datas.map((data) => ({ data, motivo: aviso.titulo, avisoId: aviso.id })),
  ]);

  const { canceladas, falhas } = await cancelarDatas(
    datas,
    { id: admin.id, nome: admin.nome, papel: admin.papel },
    `Sem aulas: ${aviso.titulo}`,
    { canceladoPorAviso: aviso.id },
  );

  // Uma mensagem por aluno, listando todas as aulas dele que caíram.
  const porAluno = new Map();
  for (const aula of canceladas) {
    const lista = porAluno.get(aula.alunoId) || { nome: aula.alunoNome, aulas: [] };
    lista.aulas.push(aula);
    porAluno.set(aula.alunoId, lista);
  }
  for (const [alunoId, { nome, aulas }] of porAluno) {
    const quais = aulas.map((a) => `• ${formatarData(a.data)} às ${a.horario}`).join('\n');
    try {
      await enviarMensagem({
        destinatarios: [{ id: alunoId, nome }],
        texto: `⚠️ ${aviso.titulo}\n\n${aviso.mensagem}\n\n`
          + `${aulas.length === 1 ? 'Sua aula foi cancelada' : 'Suas aulas foram canceladas'}:\n${quais}\n\n`
          + `${aulas.length === 1 ? 'O crédito já voltou' : 'Os créditos já voltaram'} para a sua conta. `
          + 'Por favor, REAGENDE pelo site em "Agendar aula".',
      });
    } catch (err) {
      console.warn(`[avisos] não foi possível avisar ${nome}:`, err);
    }
  }

  return { canceladas: canceladas.length, alunos: porAluno.size, falhas: falhas.length };
}

/** Quantos alunos já confirmaram a leitura — útil no painel do admin. */
export async function contarLeituras(avisoId) {
  const leituras = await listar('avisosLidos', { avisoId });
  return leituras.length;
}

/** Descrição curta da janela de exibição, para a listagem do admin. */
export function descreverJanela(aviso) {
  const inicio = aviso.inicioEm ? formatarData(String(aviso.inicioEm).slice(0, 10)) : null;
  const fim = aviso.fimEm ? formatarData(String(aviso.fimEm).slice(0, 10)) : null;
  if (inicio && fim) return `${inicio} até ${fim}`;
  if (inicio) return `A partir de ${inicio}`;
  if (fim) return `Até ${fim}`;
  return 'Sem prazo definido';
}
