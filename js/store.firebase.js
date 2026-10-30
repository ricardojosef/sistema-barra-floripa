/**
 * store.firebase.js — driver de dados sobre Firebase (Auth + Firestore).
 *
 * Expõe exatamente a mesma interface do store.local.js, então as telas não
 * mudam ao trocar CONFIG.MODO_DADOS de 'local' para 'firebase'.
 *
 * Os SDKs são carregados do CDN por import dinâmico, mantendo o projeto sem
 * build step. Veja docs/GUIA.md para o passo a passo do Console.
 */

import { CONFIG } from './config.js';
import { aplicarOrdenacao } from './store.js';

const VERSAO_SDK = '10.14.1';
const BASE_SDK = `https://www.gstatic.com/firebasejs/${VERSAO_SDK}`;

let app = null;
let db = null;
let auth = null;
let fs = null;   // módulo firestore
let fa = null;   // módulo auth
let fapp = null; // módulo app (usado para instâncias secundárias)

/** Espera a primeira resposta do Firebase Auth sobre a sessão. */
function aguardarAuthPronto() {
  return new Promise((resolve) => {
    const cancelar = fa.onAuthStateChanged(auth, (usuario) => {
      cancelar();
      resolve(usuario);
    });
  });
}

/** Traduz os filtros do store para `where()` do Firestore. */
function montarConsulta(colecao, filtros = {}, opcoes = {}) {
  const partes = [];

  for (const [campo, cond] of Object.entries(filtros)) {
    if (cond !== null && typeof cond === 'object' && 'op' in cond) {
      const mapa = {
        '==': '==', '!=': '!=', '>': '>', '>=': '>=', '<': '<', '<=': '<=',
        in: 'in', 'not-in': 'not-in',
      };
      const operador = mapa[cond.op];
      if (operador) partes.push(fs.where(campo, operador, cond.valor));
    } else {
      partes.push(fs.where(campo, '==', cond));
    }
  }

  // Ordenação e limite NÃO vão para o Firestore: combinar `where` num campo
  // com `orderBy` em outro exige um índice composto criado à mão no Console,
  // e sem ele a consulta inteira falha. Para o volume de uma escola, ordenar
  // no navegador (aplicarOrdenacao, em listar) é simples e não quebra.
  void opcoes;
  return fs.query(fs.collection(db, colecao), ...partes);
}

const comId = (snap) => ({ id: snap.id, ...snap.data() });

export function criarDriver() {
  return {
    async inicializar() {
      if (app) return;

      if (!CONFIG.firebaseConfig?.apiKey || !CONFIG.firebaseConfig?.projectId) {
        throw new Error(
          'MODO_DADOS está como "firebase", mas CONFIG.firebaseConfig não foi preenchido. '
          + 'Copie as credenciais do Console do Firebase para js/config.js (veja docs/GUIA.md).',
        );
      }

      const [modApp, modFs, modAuth] = await Promise.all([
        import(`${BASE_SDK}/firebase-app.js`),
        import(`${BASE_SDK}/firebase-firestore.js`),
        import(`${BASE_SDK}/firebase-auth.js`),
      ]);

      fs = modFs;
      fa = modAuth;
      fapp = modApp;
      app = modApp.initializeApp(CONFIG.firebaseConfig);
      db = fs.getFirestore(app);
      auth = fa.getAuth(app);

      // Garante que a sessão restaurada já esteja disponível na primeira leitura.
      await aguardarAuthPronto();
    },

    /* --- Leitura --- */

    async listar(colecao, filtros = {}, opcoes = {}) {
      const snap = await fs.getDocs(montarConsulta(colecao, filtros));
      return aplicarOrdenacao(snap.docs.map(comId), opcoes);
    },

    async obter(colecao, id) {
      const snap = await fs.getDoc(fs.doc(db, colecao, id));
      return snap.exists() ? comId(snap) : null;
    },

    /* --- Escrita --- */

    async criar(colecao, dados) {
      const registro = { ...dados, criadoEm: dados.criadoEm || new Date().toISOString() };

      // Id explícito (ex.: `usuarios/{uid}`, `avisosLidos/{aluno_aviso}`).
      if (registro.id) {
        const { id, ...campos } = registro;
        await fs.setDoc(fs.doc(db, colecao, id), campos);
        return registro;
      }

      const ref = await fs.addDoc(fs.collection(db, colecao), registro);
      return { ...registro, id: ref.id };
    },

    async atualizar(colecao, id, campos) {
      const ref = fs.doc(db, colecao, id);
      await fs.updateDoc(ref, { ...campos, atualizadoEm: new Date().toISOString() });
      const snap = await fs.getDoc(ref);
      return comId(snap);
    },

    async remover(colecao, id) {
      await fs.deleteDoc(fs.doc(db, colecao, id));
      return true;
    },

    /**
     * Transação do Firestore.
     *
     * Atenção: o Firestore não permite CONSULTAS dentro de runTransaction —
     * só leitura por id. Como a regra de capacidade precisa contar quantos
     * alunos há no slot, as leituras de lista acontecem antes da transação e
     * as escritas entram num batch atômico.
     *
     * Para tornar a checagem de capacidade realmente à prova de corrida em
     * produção, o caminho recomendado é um contador agregado por slot
     * (documento `slots/{data_professor_horario}` com o campo `ocupados`),
     * incrementado dentro da transação. O guia explica como fazer.
     */
    /**
     * Transação real do Firestore (runTransaction).
     *
     * `obter` lê PELA transação: se outro aluno alterar o mesmo documento
     * (por exemplo, a contagem de vagas da turma) antes do commit, o
     * Firestore descarta tudo e roda `fn` de novo com os dados novos. É o
     * que impede dois alunos de ocuparem juntos a última vaga.
     *
     * `listar` (consultas) não pode participar de transações no SDK web;
     * roda fora dela. Por isso a regra de capacidade se apoia num documento
     * único por turma (coleção `vagas`), lido com `obter`.
     *
     * Regra do Firestore: todas as leituras antes de qualquer escrita. As
     * funções de agenda.js e pagamentos.js já seguem essa ordem.
     */
    async transacao(fn) {
      return fs.runTransaction(db, async (tx) => {
        const ops = {
          listar: async (colecao, filtros, opcoes) => {
            const snap = await fs.getDocs(montarConsulta(colecao, filtros));
            return aplicarOrdenacao(snap.docs.map(comId), opcoes);
          },
          obter: async (colecao, id) => {
            const snap = await tx.get(fs.doc(db, colecao, id));
            return snap.exists() ? comId(snap) : null;
          },
          criar: async (colecao, dados) => {
            const registro = {
              ...dados,
              id: dados.id || fs.doc(fs.collection(db, colecao)).id,
              criadoEm: dados.criadoEm || new Date().toISOString(),
            };
            const { id, ...campos } = registro;
            tx.set(fs.doc(db, colecao, id), campos);
            return registro;
          },
          atualizar: async (colecao, id, campos) => {
            const dados = { ...campos, atualizadoEm: new Date().toISOString() };
            tx.update(fs.doc(db, colecao, id), dados);
            return { id, ...dados };
          },
          remover: async (colecao, id) => {
            tx.delete(fs.doc(db, colecao, id));
            return true;
          },
        };
        return fn(ops);
      });
    },

    observar(colecao, filtros, cb, opcoes = {}) {
      return fs.onSnapshot(
        montarConsulta(colecao, filtros),
        (snap) => cb(aplicarOrdenacao(snap.docs.map(comId), opcoes)),
        (err) => console.error(`[store.firebase] falha ao observar "${colecao}":`, err),
      );
    },

    /* --- Autenticação (usada por auth.js) --- */

    usuarioFirebaseAtual: () => auth.currentUser,

    entrarComSenha: (email, senha) => fa.signInWithEmailAndPassword(auth, email, senha),

    cadastrarComSenha: (email, senha) => fa.createUserWithEmailAndPassword(auth, email, senha),

    entrarComGoogle: () => fa.signInWithPopup(auth, new fa.GoogleAuthProvider()),

    sair: () => fa.signOut(auth),

    /**
     * Cria uma conta de e-mail/senha SEM trocar o usuário logado.
     *
     * `createUserWithEmailAndPassword` sempre autentica a conta recém-criada
     * na instância em que roda. Se usássemos a instância principal, o
     * administrador seria deslogado no meio do cadastro. Por isso a conta
     * nasce numa instância secundária e descartável do app.
     *
     * Devolve o UID da conta criada.
     */
    async criarContaSemTrocarSessao(email, senha) {
      const nomeInstancia = `cadastro-equipe-${Date.now()}`;
      const appSecundario = fapp.initializeApp(CONFIG.firebaseConfig, nomeInstancia);
      try {
        const authSecundario = fa.getAuth(appSecundario);
        const cred = await fa.createUserWithEmailAndPassword(authSecundario, email, senha);
        await fa.signOut(authSecundario);
        return cred.user.uid;
      } finally {
        await fapp.deleteApp(appSecundario);
      }
    },
  };
}
