/**
 * Ponto de entrada das Cloud Functions do Barra Floripa.
 *
 * Cada módulo exporta as próprias funções; aqui só juntamos tudo.
 * Veja docs/GUIA.md, seções 6 (pagamentos) e 7 (e-mails).
 */

const { setGlobalOptions } = require('firebase-functions/v2');

// Mesmo local do Firestore (São Paulo). Gatilhos do banco precisam disso.
setGlobalOptions({ region: 'southamerica-east1' });

Object.assign(exports, require('./emails'));

// Descomente quando criar functions/pagamentos.js (GUIA.md, seção 6.6).
// Object.assign(exports, require('./pagamentos'));
