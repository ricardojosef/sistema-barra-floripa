/**
 * mensagens.js — recados da equipe para os alunos.
 *
 * Um envio para uma turma inteira vira um documento POR ALUNO, todos com o
 * mesmo `envioId`. Isso deixa a regra de segurança simples (cada aluno lê só
 * o que tem `destinatarioId` igual ao dele) e permite que cada um marque a
 * própria mensagem como lida sem afetar os colegas.
 *
 * Só professores e o administrador enviam. O aluno lê e marca como lida.
 */

import { listar, criar, atualizar } from './store.js';
import { usuarioAtual } from './auth.js';
import { gerarId } from './ui.js';

export class ErroMensagem extends Error {
  constructor(codigo, mensagem) {
    super(mensagem);
    this.name = 'ErroMensagem';
    this.codigo = codigo;
  }
}

const LIMITE_TEXTO = 2000;

/**
 * Envia um recado.
 * destinatarios: [{ id, nome }] — alunos que recebem
 * turma (opcional): { data, horario, professorId } — contexto do recado
 */
export async function enviarMensagem({ destinatarios, texto, turma = null }) {
  const remetente = usuarioAtual();
  if (!remetente || (remetente.papel !== 'professor' && remetente.papel !== 'admin')) {
    throw new ErroMensagem('SEM_PERMISSAO', 'Apenas a equipe da escola envia mensagens.');
  }

  const corpo = String(texto || '').trim();
  if (!corpo) throw new ErroMensagem('VAZIA', 'Escreva a mensagem antes de enviar.');
  if (corpo.length > LIMITE_TEXTO) {
    throw new ErroMensagem('LONGA', `A mensagem pode ter até ${LIMITE_TEXTO} caracteres.`);
  }

  // Um aluno pode estar duas vezes na lista (ex.: aula em grupo e particular).
  const unicos = [...new Map((destinatarios || []).map((d) => [d.id, d])).values()];
  if (!unicos.length) throw new ErroMensagem('SEM_DESTINO', 'Esta turma não tem alunos para receber a mensagem.');

  const envioId = gerarId('env');
  const criadoEm = new Date().toISOString();

  for (const d of unicos) {
    await criar('mensagens', {
      envioId,
      remetenteId: remetente.id,
      remetenteNome: remetente.nome,
      destinatarioId: d.id,
      destinatarioNome: d.nome || '',
      texto: corpo,
      turma: turma ? { data: turma.data, horario: turma.horario, professorId: turma.professorId } : null,
      lidaEm: null,
      criadoEm,
    });
  }

  return { envioId, enviadas: unicos.length };
}

/** Mensagens recebidas pelo aluno, da mais recente para a mais antiga. */
export function mensagensRecebidas(alunoId) {
  return listar('mensagens', { destinatarioId: alunoId }, { ordenarPor: 'criadoEm', direcao: 'desc' });
}

export async function contarNaoLidas(alunoId) {
  const todas = await listar('mensagens', { destinatarioId: alunoId });
  return todas.filter((m) => !m.lidaEm).length;
}

export function marcarComoLida(mensagemId) {
  return atualizar('mensagens', mensagemId, { lidaEm: new Date().toISOString() });
}

/**
 * Envios feitos por um membro da equipe, agrupados: uma entrada por envio,
 * com quantos alunos receberam e quantos já leram.
 */
export async function enviosDaEquipe(remetenteId) {
  const todas = await listar('mensagens', { remetenteId });
  const grupos = new Map();
  for (const m of todas) {
    const chave = m.envioId || m.id;
    const g = grupos.get(chave) || {
      envioId: chave, texto: m.texto, turma: m.turma, criadoEm: m.criadoEm, destinatarios: [], lidas: 0,
    };
    g.destinatarios.push(m.destinatarioNome || 'Aluno');
    if (m.lidaEm) g.lidas += 1;
    grupos.set(chave, g);
  }
  return [...grupos.values()].sort((a, b) => String(b.criadoEm).localeCompare(String(a.criadoEm)));
}
