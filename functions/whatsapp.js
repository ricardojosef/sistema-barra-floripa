/**
 * whatsapp.js — notificações por WhatsApp (API oficial da Meta / Cloud API).
 *
 * DESLIGADO por padrão. Para ligar, siga docs/NOTIFICACOES.md e depois
 * descomente a linha `require('./whatsapp')` em functions/index.js.
 *
 * Envia MODELOS (templates) aprovados pela Meta — é o que a Meta exige para
 * a escola falar primeiro com o aluno. Os nomes abaixo precisam existir,
 * aprovados, no WhatsApp Manager, nos idiomas pt_BR, en e es:
 *
 *   aula_confirmada   {{1}} nome  {{2}} data  {{3}} horário  {{4}} praia
 *   aula_cancelada    {{1}} nome  {{2}} data  {{3}} horário  {{4}} motivo
 *   lembrete_aula     {{1}} nome  {{2}} horário  {{3}} praia   (véspera, 18h)
 *
 * Segredo:   WHATSAPP_TOKEN    (token permanente de "usuário do sistema")
 * Variáveis: WHATSAPP_PHONE_ID (id do número), WHATSAPP_API_VERSION (ex.: v23.0)
 */

const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const WHATSAPP_TOKEN = defineSecret('WHATSAPP_TOKEN');
const OPCOES = { secrets: [WHATSAPP_TOKEN] };

const IDIOMA_META = { pt: 'pt_BR', en: 'en', es: 'es' };

/** '+55 (48) 99999-9999' -> '5548999999999'. Brasileiro sem DDI ganha 55. */
function telefoneE164(telefone) {
  const bruto = String(telefone || '').trim();
  const digitos = bruto.replace(/\D/g, '');
  if (digitos.length < 10) return null;
  if (bruto.startsWith('+')) return digitos;
  return digitos.length <= 11 ? `55${digitos}` : digitos;
}

function dataCurta(iso) {
  const [a, m, d] = String(iso).split('-');
  return `${d}/${m}/${a}`;
}

/**
 * Envia um template uma única vez por evento (registro em `whatsapp`, mesmo
 * esquema do `emails`).
 */
async function enviarModelo(eventoId, tipo, usuario, modelo, parametros) {
  const para = telefoneE164(usuario?.telefone);
  if (!para) return;
  if (usuario?.whatsappOptOut === true) return;

  const registro = db.collection('whatsapp').doc(`${eventoId}-${tipo}`);
  try {
    await registro.create({ tipo, para, modelo, status: 'enviando', criadoEm: new Date().toISOString() });
  } catch (err) {
    if (err.code === 6) return; // já enviado
    throw err;
  }

  const versao = process.env.WHATSAPP_API_VERSION || 'v23.0';
  try {
    const resp = await fetch(`https://graph.facebook.com/${versao}/${process.env.WHATSAPP_PHONE_ID}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${WHATSAPP_TOKEN.value()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: para,
        type: 'template',
        template: {
          name: modelo,
          language: { code: IDIOMA_META[usuario.idioma] || 'pt_BR' },
          components: [{ type: 'body', parameters: parametros.map((texto) => ({ type: 'text', text: String(texto ?? '') })) }],
        },
      }),
    });
    const dados = await resp.json();
    if (!resp.ok) throw new Error(JSON.stringify(dados.error || dados));
    await registro.update({ status: 'enviado', idMeta: dados.messages?.[0]?.id || null, enviadoEm: new Date().toISOString() });
  } catch (err) {
    logger.error(`[whatsapp] ${tipo} para ${para}:`, err);
    await registro.update({ status: 'erro', erro: String(err.message || err) });
  }
}

async function usuario(id) {
  const snap = await db.collection('usuarios').doc(id).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

async function nomeLocal(localId) {
  if (!localId) return '';
  const snap = await db.collection('locais').doc(localId).get();
  return snap.exists ? snap.get('nome') : '';
}

exports.whatsappAgendamento = onDocumentCreated({ ...OPCOES, document: 'agendamentos/{id}' }, async (evento) => {
  const aula = evento.data?.data();
  if (!aula || aula.status !== 'confirmado') return;
  const [aluno, local] = await Promise.all([usuario(aula.alunoId), nomeLocal(aula.localId)]);
  await enviarModelo(evento.id, 'confirmada', aluno, 'aula_confirmada',
    [aluno?.nome?.split(' ')[0], dataCurta(aula.data), aula.horario, local]);
});

exports.whatsappCancelamento = onDocumentUpdated({ ...OPCOES, document: 'agendamentos/{id}' }, async (evento) => {
  const antes = evento.data?.before.data();
  const depois = evento.data?.after.data();
  if (!antes || !depois || antes.status !== 'confirmado' || depois.status !== 'cancelado') return;
  // Cancelado pelo próprio aluno: ele já sabe.
  if (depois.canceladoPorPapel === 'aluno') return;
  const aluno = await usuario(depois.alunoId);
  await enviarModelo(evento.id, 'cancelada', aluno, 'aula_cancelada',
    [aluno?.nome?.split(' ')[0], dataCurta(depois.data), depois.horario, depois.motivoCancelamento || '']);
});

/** Lembrete na véspera, às 18h de Brasília, para as aulas de amanhã. */
exports.whatsappLembrete = onSchedule({ ...OPCOES, schedule: '0 18 * * *', timeZone: 'America/Sao_Paulo' }, async () => {
  const amanha = new Date(Date.now() - 3 * 3600000 + 86400000).toISOString().slice(0, 10);
  const aulas = await db.collection('agendamentos').where('data', '==', amanha).where('status', '==', 'confirmado').get();
  for (const doc of aulas.docs) {
    const aula = doc.data();
    const [aluno, local] = await Promise.all([usuario(aula.alunoId), nomeLocal(aula.localId)]);
    await enviarModelo(`lembrete-${doc.id}`, 'lembrete', aluno, 'lembrete_aula',
      [aluno?.nome?.split(' ')[0], aula.horario, local]);
  }
});
