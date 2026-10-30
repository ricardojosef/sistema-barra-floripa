/**
 * avisos.js — avisos pop-up que o administrador publica para os alunos.
 *
 * O aviso aparece no dashboard do aluno enquanto estiver ativo, dentro da
 * janela de datas e ainda não confirmado por ele. A confirmação é gravada
 * em `avisosLidos` com id determinístico `<alunoId>_<avisoId>`, o que evita
 * registros duplicados se o aluno clicar duas vezes.
 */

import { listar, criar, obter, atualizar, remover } from './store.js';
import { abrirModal, escapar, formatarData, icone as svgIcone } from './ui.js';

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

export function criarAviso({ titulo, mensagem, tipo = 'info', inicioEm = null, fimEm = null, criadoPor = null }) {
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
    criadoPor,
    criadoEm: new Date().toISOString(),
  });
}

export const alternarAviso = (avisoId, ativo) => atualizar('avisos', avisoId, { ativo });

export const atualizarAviso = (avisoId, campos) => atualizar('avisos', avisoId, campos);

/**
 * Remove o aviso e as confirmações de leitura associadas, para não deixar
 * registros órfãos apontando para um aviso que não existe mais.
 */
export async function removerAviso(avisoId) {
  const leituras = await listar('avisosLidos', { avisoId });
  for (const leitura of leituras) await remover('avisosLidos', leitura.id);
  return remover('avisos', avisoId);
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
