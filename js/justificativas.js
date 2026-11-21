/**
 * justificativas.js — justificativa de falta / cancelamento fora do prazo.
 *
 * Depois do prazo (12h antes da aula) o aluno não cancela mais pelo site, e
 * a falta sem justificativa faz perder o crédito. O aluno pode enviar uma
 * justificativa com texto e, se quiser, um atestado (foto ou PDF). O
 * administrador analisa:
 *   - aprovada: a aula é cancelada pela escola e o crédito volta;
 *   - recusada: nada muda, e o aluno vê a resposta da escola.
 *
 * O anexo fica dentro do próprio documento, em data URL (imagens são
 * reduzidas antes de gravar), para não exigir o Firebase Storage. O limite
 * de 1 MB por documento do Firestore cabe uma foto de atestado com folga.
 */

import { listar, criar, atualizar, obter } from './store.js';
import { cancelar } from './agenda.js';
import { enviarMensagem } from './mensagens.js';
import { formatarData } from './ui.js';

export class ErroJustificativa extends Error {
  constructor(codigo, mensagem) {
    super(mensagem);
    this.name = 'ErroJustificativa';
    this.codigo = codigo;
  }
}

const LIMITE_ANEXO = 700 * 1024;     // tamanho final do data URL
const LADO_MAXIMO_IMAGEM = 1600;

/* --------------------------------------------------------------------------
   Anexo
   -------------------------------------------------------------------------- */

function lerComoDataUrl(arquivo) {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(leitor.result);
    leitor.onerror = () => reject(new ErroJustificativa('ANEXO', 'Não foi possível ler o arquivo.'));
    leitor.readAsDataURL(arquivo);
  });
}

/** Reduz uma imagem para JPEG, mantendo legível o texto de um atestado. */
async function reduzirImagem(arquivo) {
  const url = await lerComoDataUrl(arquivo);
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new ErroJustificativa('ANEXO', 'Imagem inválida.'));
    i.src = url;
  });
  const escala = Math.min(1, LADO_MAXIMO_IMAGEM / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * escala);
  canvas.height = Math.round(img.height * escala);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  for (const qualidade of [0.8, 0.65, 0.5, 0.4]) {
    const saida = canvas.toDataURL('image/jpeg', qualidade);
    if (saida.length <= LIMITE_ANEXO) return saida;
  }
  throw new ErroJustificativa('ANEXO', 'A imagem é grande demais. Tire uma foto mais próxima do atestado.');
}

/** Prepara o anexo escolhido pelo aluno: { nome, tipo, dataUrl }. */
export async function prepararAnexo(arquivo) {
  if (!arquivo) return null;
  if (arquivo.type.startsWith('image/')) {
    return { nome: arquivo.name, tipo: 'image/jpeg', dataUrl: await reduzirImagem(arquivo) };
  }
  if (arquivo.type === 'application/pdf') {
    const dataUrl = await lerComoDataUrl(arquivo);
    if (dataUrl.length > LIMITE_ANEXO) {
      throw new ErroJustificativa('ANEXO', 'O PDF passa de 500 KB. Envie uma foto do atestado no lugar.');
    }
    return { nome: arquivo.name, tipo: 'application/pdf', dataUrl };
  }
  throw new ErroJustificativa('ANEXO', 'Envie uma foto (JPG/PNG) ou um PDF.');
}

/** Abre o anexo numa nova aba (data URL não abre direto em navegadores atuais). */
export function abrirAnexo(anexo) {
  if (!anexo?.dataUrl) return;
  const [cabecalho, base64] = anexo.dataUrl.split(',');
  const tipo = /data:([^;]+)/.exec(cabecalho)?.[1] || anexo.tipo;
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: tipo }));
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/* --------------------------------------------------------------------------
   Aluno
   -------------------------------------------------------------------------- */

export async function enviarJustificativa(usuario, aula, { texto, arquivo }) {
  const corpo = String(texto || '').trim();
  if (corpo.length < 10) throw new ErroJustificativa('TEXTO', 'Explique o motivo em pelo menos uma frase.');
  if (aula.alunoId !== usuario.id) throw new ErroJustificativa('SEM_PERMISSAO', 'Esta aula não é sua.');
  if (aula.status === 'cancelado') throw new ErroJustificativa('CANCELADA', 'Esta aula já foi cancelada.');

  const existentes = await listar('justificativas', { alunoId: usuario.id, agendamentoId: aula.id });
  if (existentes.some((j) => j.status !== 'recusada')) {
    throw new ErroJustificativa('DUPLICADA', 'Você já enviou uma justificativa para esta aula.');
  }

  const anexo = await prepararAnexo(arquivo);
  return criar('justificativas', {
    alunoId: usuario.id,
    alunoNome: usuario.nome,
    agendamentoId: aula.id,
    aula: { data: aula.data, horario: aula.horario, tipo: aula.tipo, professorId: aula.professorId || null },
    texto: corpo.slice(0, 2000),
    anexo,
    status: 'pendente',
    resposta: null,
    analisadoPor: null,
    analisadoEm: null,
    criadoEm: new Date().toISOString(),
  });
}

export async function justificativasDoAluno(alunoId) {
  return listar('justificativas', { alunoId }, { ordenarPor: 'criadoEm', direcao: 'desc' });
}

/* --------------------------------------------------------------------------
   Administrador
   -------------------------------------------------------------------------- */

export async function listarJustificativas() {
  return listar('justificativas', {}, { ordenarPor: 'criadoEm', direcao: 'desc' });
}

/**
 * Aprova: cancela a aula pela escola (mesmo que já tenha passado) e devolve
 * o crédito. Avisa o aluno por mensagem (que também vira e-mail).
 */
export async function aprovarJustificativa(justificativa, admin, resposta = '') {
  const aula = await obter('agendamentos', justificativa.agendamentoId);
  if (aula && aula.status !== 'cancelado') {
    await cancelar(aula.id, admin, 'Falta justificada — aprovada pela escola', {
      permitirRealizada: true,
      extras: { justificativaId: justificativa.id },
    });
  }
  const atualizada = await atualizar('justificativas', justificativa.id, {
    status: 'aprovada',
    resposta: String(resposta || '').trim().slice(0, 600) || null,
    analisadoPor: admin.id,
    analisadoEm: new Date().toISOString(),
  });
  await avisarAluno(justificativa, true, resposta);
  return atualizada;
}

export async function recusarJustificativa(justificativa, admin, resposta) {
  const motivo = String(resposta || '').trim();
  if (motivo.length < 5) throw new ErroJustificativa('RESPOSTA', 'Explique ao aluno por que a justificativa foi recusada.');
  const atualizada = await atualizar('justificativas', justificativa.id, {
    status: 'recusada',
    resposta: motivo.slice(0, 600),
    analisadoPor: admin.id,
    analisadoEm: new Date().toISOString(),
  });
  await avisarAluno(justificativa, false, motivo);
  return atualizada;
}

async function avisarAluno(j, aprovada, resposta) {
  const quando = `${formatarData(j.aula.data)} às ${j.aula.horario}`;
  const texto = aprovada
    ? `Sua justificativa para a aula de ${quando} foi aprovada. O crédito voltou para a sua conta — já pode reagendar.${resposta ? `\n\n${resposta}` : ''}`
    : `Sua justificativa para a aula de ${quando} não foi aprovada.\n\nMotivo: ${resposta}`;
  try {
    await enviarMensagem({ destinatarios: [{ id: j.alunoId, nome: j.alunoNome }], texto });
  } catch (err) {
    console.warn('[justificativas] não foi possível avisar o aluno:', err);
  }
}
