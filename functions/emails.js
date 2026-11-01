/**
 * emails.js — e-mails automáticos, disparados por mudanças no Firestore.
 *
 * O site não manda e-mail: ele só grava no banco, como já fazia. Estas
 * funções rodam no servidor e reagem às gravações:
 *
 *   usuarios      criado (papel aluno)          -> boas-vindas ao aluno
 *   creditos      criado (+N, compra ou ajuste) -> créditos adicionados ao aluno
 *   agendamentos  criado (confirmado)           -> confirmação ao aluno + aviso ao professor
 *   agendamentos  confirmado -> cancelado       -> aviso ao aluno (+ professor, se foi o aluno)
 *   mensagens     criada                        -> recado da equipe ao aluno
 *
 * Como o gatilho é o próprio banco, ninguém consegue disparar e-mail pelo
 * navegador, e as regras do Firestore continuam valendo para tudo.
 *
 * Cada envio fica registrado na coleção `emails` (status, destinatário,
 * erro). O id do registro também impede envio em dobro quando o Google
 * entrega o mesmo evento duas vezes.
 */

const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
const modelos = require('./modelos-email');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const SMTP_USER = defineSecret('SMTP_USER');
const SMTP_PASS = defineSecret('SMTP_PASS');
const OPCOES = { secrets: [SMTP_USER, SMTP_PASS] };

/* ---------- envio ---------- */

let transporte = null;

function obterTransporte() {
  if (transporte) return transporte;
  const porta = Number(process.env.SMTP_PORT || 587);
  transporte = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: porta,
    secure: porta === 465, // 465 = SSL direto; 587 = STARTTLS
    auth: { user: SMTP_USER.value(), pass: SMTP_PASS.value() },
  });
  return transporte;
}

/**
 * Envia um e-mail uma única vez por evento e registra o resultado.
 * `tipo` diferencia dois e-mails do mesmo evento (aluno e professor).
 */
async function enviar(evento, tipo, para, { assunto, html, texto }) {
  if (!para) {
    logger.warn(`[emails] ${tipo}: destinatário sem e-mail, envio ignorado.`);
    return;
  }

  const registro = db.collection('emails').doc(`${evento.id}-${tipo}`);
  try {
    await registro.create({
      tipo, para, assunto, status: 'enviando', criadoEm: new Date().toISOString(),
    });
  } catch (err) {
    if (err.code === 6) return; // ALREADY_EXISTS: este evento já foi tratado
    throw err;
  }

  try {
    await obterTransporte().sendMail({
      from: process.env.EMAIL_REMETENTE,
      replyTo: process.env.EMAIL_RESPOSTA || undefined,
      to: para,
      subject: assunto,
      html,
      text: texto,
    });
    await registro.update({ status: 'enviado', enviadoEm: new Date().toISOString() });
  } catch (err) {
    logger.error(`[emails] falha ao enviar ${tipo} para ${para}:`, err);
    await registro.update({ status: 'erro', erro: String(err.message || err) });
  }
}

/* ---------- leitura de apoio ---------- */

async function usuario(id) {
  if (!id) return null;
  const snap = await db.collection('usuarios').doc(id).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

/** Professor com nome e e-mail (o e-mail fica no usuário ligado a ele). */
async function professor(professorId) {
  const snap = await db.collection('professores').doc(professorId).get();
  if (!snap.exists) return null;
  const dados = snap.data();
  const conta = await usuario(dados.usuarioId);
  return { id: snap.id, nome: dados.nome, email: conta?.email || dados.email || null };
}

async function nomeDoLocal(localId) {
  if (!localId) return null;
  const snap = await db.collection('locais').doc(localId).get();
  return snap.exists ? snap.get('nome') : null;
}

async function horasMinimasCancelamento() {
  const snap = await db.collection('config').doc('app').get();
  return Number(snap.exists && snap.get('horasMinimasCancelamento')) || 12;
}

/** Quantos alunos seguem confirmados na turma (mesmo dia, horário e professor). */
async function alunosNaTurma(aula) {
  const consulta = await db.collection('agendamentos')
    .where('data', '==', aula.data)
    .where('professorId', '==', aula.professorId)
    .where('horario', '==', aula.horario)
    .where('status', '==', 'confirmado')
    .count()
    .get();
  return consulta.data().count;
}

/** Aula com nome do professor e do local, pronta para os modelos. */
async function detalharAula(aula) {
  const [prof, localNome] = await Promise.all([professor(aula.professorId), nomeDoLocal(aula.localId)]);
  return { aula: { ...aula, professorNome: prof?.nome || null, localNome }, prof };
}

/* ---------- gatilhos ---------- */

exports.emailBoasVindas = onDocumentCreated({ ...OPCOES, document: 'usuarios/{id}' }, async (evento) => {
  const aluno = evento.data?.data();
  // Professores são cadastrados pelo admin e recebem a senha pessoalmente.
  if (!aluno || aluno.papel !== 'aluno') return;
  await enviar(evento, 'boas-vindas', aluno.email, modelos.boasVindas({ aluno }));
});

exports.emailCreditos = onDocumentCreated({ ...OPCOES, document: 'creditos/{id}' }, async (evento) => {
  const lancamento = evento.data?.data();
  // Só entradas de compra ou ajuste. A devolução por cancelamento já vai no
  // e-mail do cancelamento, e o débito do agendamento, na confirmação.
  if (!lancamento || Number(lancamento.delta) <= 0) return;
  if (!['compra', 'ajuste'].includes(lancamento.motivo)) return;

  const aluno = await usuario(lancamento.alunoId);
  if (!aluno) return;
  await enviar(evento, 'creditos', aluno.email, modelos.creditosAdicionados({ aluno, lancamento }));
});

exports.emailAgendamento = onDocumentCreated({ ...OPCOES, document: 'agendamentos/{id}' }, async (evento) => {
  const dados = evento.data?.data();
  if (!dados || dados.status !== 'confirmado') return;

  const [aluno, { aula, prof }, horas, total] = await Promise.all([
    usuario(dados.alunoId),
    detalharAula(dados),
    horasMinimasCancelamento(),
    alunosNaTurma(dados),
  ]);

  await Promise.all([
    aluno && enviar(evento, 'agendamento-aluno', aluno.email,
      modelos.agendamentoConfirmado({ aluno, aula, horasCancelamento: horas })),
    prof && enviar(evento, 'agendamento-professor', prof.email,
      modelos.professorNovoAluno({ professor: prof, aula, totalNaTurma: total })),
  ]);
});

exports.emailCancelamento = onDocumentUpdated({ ...OPCOES, document: 'agendamentos/{id}' }, async (evento) => {
  const antes = evento.data?.before.data();
  const depois = evento.data?.after.data();
  if (!antes || !depois || antes.status !== 'confirmado' || depois.status !== 'cancelado') return;

  const [aluno, { aula, prof }] = await Promise.all([usuario(depois.alunoId), detalharAula(depois)]);

  const envios = [
    aluno && enviar(evento, 'cancelamento-aluno', aluno.email, modelos.aulaCanceladaAluno({ aluno, aula })),
  ];

  // O professor só é avisado quando o cancelamento partiu do aluno: quando
  // foi a equipe, ele já sabe (ou foi ele mesmo).
  if (prof && depois.canceladoPorPapel === 'aluno') {
    const total = await alunosNaTurma(depois);
    envios.push(enviar(evento, 'cancelamento-professor', prof.email,
      modelos.professorCancelamento({ professor: prof, aula, totalNaTurma: total })));
  }

  await Promise.all(envios);
});

exports.emailMensagem = onDocumentCreated({ ...OPCOES, document: 'mensagens/{id}' }, async (evento) => {
  const mensagem = evento.data?.data();
  if (!mensagem) return;

  const aluno = await usuario(mensagem.destinatarioId);
  if (!aluno) return;
  await enviar(evento, 'mensagem', aluno.email,
    modelos.novaMensagem({ aluno, mensagem, turma: mensagem.turma || null }));
});
