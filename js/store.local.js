/**
 * store.local.js — driver de dados sobre localStorage (modo demo).
 *
 * Persiste cada coleção em `bf_<colecao>` como um array JSON. Na primeira
 * execução semeia dados de exemplo (professores, alunos, aulas, pacotes)
 * para que o sistema possa ser testado imediatamente.
 *
 * Limitações conhecidas (aceitáveis para demonstração):
 *  - dados ficam apenas neste navegador;
 *  - a "transação" é um mutex de processo único, suficiente porque o
 *    localStorage é síncrono e só há uma aba escrevendo por vez.
 */

import { DEFAULTS, SENHA_DEMO } from './config.js';
import { aplicarFiltros, aplicarOrdenacao } from './store.js';

const PREFIXO = 'bf_';
const CHAVE_VERSAO = `${PREFIXO}versao_seed`;
const VERSAO_SEED = 4;

const COLECOES = [
  'usuarios', 'professores', 'pacotes', 'compras', 'creditos',
  'agendamentos', 'locais', 'avisos', 'avisosLidos', 'config',
];

/* --------------------------------------------------------------------------
   Leitura e escrita cruas
   -------------------------------------------------------------------------- */

function ler(colecao) {
  try {
    const bruto = localStorage.getItem(PREFIXO + colecao);
    const dados = bruto ? JSON.parse(bruto) : [];
    return Array.isArray(dados) ? dados : [];
  } catch {
    // Dado corrompido: melhor começar limpo do que travar a aplicação.
    console.warn(`[store.local] coleção "${colecao}" corrompida; reiniciando-a.`);
    return [];
  }
}

function escrever(colecao, itens) {
  try {
    localStorage.setItem(PREFIXO + colecao, JSON.stringify(itens));
  } catch (err) {
    console.error(`[store.local] falha ao gravar "${colecao}":`, err);
    throw new Error('Não foi possível salvar os dados. O armazenamento do navegador pode estar cheio ou bloqueado.');
  }
  notificar(colecao);
}

/* --------------------------------------------------------------------------
   Notificação de mudanças (para observar())
   -------------------------------------------------------------------------- */

const ouvintes = new Map(); // colecao -> Set<fn>

function notificar(colecao) {
  ouvintes.get(colecao)?.forEach((fn) => {
    try { fn(); } catch (err) { console.error('[store.local] ouvinte falhou:', err); }
  });
}

// Mudanças feitas em outra aba do mesmo navegador.
window.addEventListener('storage', (ev) => {
  if (!ev.key || !ev.key.startsWith(PREFIXO)) return;
  notificar(ev.key.slice(PREFIXO.length));
});

/* --------------------------------------------------------------------------
   Utilidades
   -------------------------------------------------------------------------- */

function novoId(prefixo) {
  const aleatorio = crypto.getRandomValues(new Uint32Array(1))[0].toString(36);
  return `${prefixo}-${Date.now().toString(36)}-${aleatorio}`;
}

const agora = () => new Date().toISOString();

/** Hash SHA-256 da senha. Só para a demo — em produção quem cuida disso é o Firebase Auth. */
export async function hashSenha(senha) {
  const bytes = new TextEncoder().encode(`barrafloripa::${senha}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** 'YYYY-MM-DD' somando `dias` a partir de hoje. */
function diaRelativo(dias) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + dias);
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/**
 * Offset (em dias a partir de hoje) do próximo sábado ou domingo.
 * O seed roda em qualquer dia da semana, então o mensalista — cujos
 * créditos só valem no fim de semana — precisa de uma data coerente.
 */
function proximoFimDeSemana(aPartirDe = 1) {
  for (let i = aPartirDe; i < aPartirDe + 7; i += 1) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + i);
    if (d.getDay() === 6 || d.getDay() === 0) return i;
  }
  return aPartirDe;
}

/* --------------------------------------------------------------------------
   Seed dos dados de demonstração
   -------------------------------------------------------------------------- */

const ALUNOS_DEMO = [
  { nome: 'Ricardo Alves', email: 'aluno@teste.com', telefone: '(48) 99111-1111' },
  { nome: 'Giovanna Zambrini', email: 'giovanna@teste.com', telefone: '(48) 99222-2222' },
  { nome: 'Ana Gabriela Ferreira', email: 'ana@teste.com', telefone: '(48) 99333-3333' },
  { nome: 'André Pagorare', email: 'andre@teste.com', telefone: '(48) 99444-4444' },
  { nome: 'Marina Costa', email: 'marina@teste.com', telefone: '(48) 99555-5555' },
  { nome: 'Bruno Tavares', email: 'bruno@teste.com', telefone: '(48) 99666-6666' },
  { nome: 'Camila Rocha', email: 'camila@teste.com', telefone: '(48) 99777-7777' },
  { nome: 'Diego Martins', email: 'diego@teste.com', telefone: '(48) 99888-8888' },
];

async function semear() {
  const senhaHash = await hashSenha(SENHA_DEMO);
  const criadoEm = agora();

  // --- Usuários: professores/admin + alunos de exemplo ---
  const usuarios = [];
  const professores = [];

  for (const prof of DEFAULTS.professores) {
    const usuarioId = `usr-${prof.id}`;
    usuarios.push({
      id: usuarioId,
      nome: prof.nome,
      email: prof.email,
      telefone: '(48) 3232-0000',
      papel: prof.papel,
      ativo: true,
      googleId: null,
      senhaHash,
      criadoEm,
    });
    professores.push({
      id: prof.id,
      usuarioId,
      nome: prof.nome,
      ativo: true,
      ordem: prof.ordem,
    });
  }

  const alunos = ALUNOS_DEMO.map((a, i) => ({
    id: `usr-aluno-${i + 1}`,
    nome: a.nome,
    email: a.email,
    telefone: a.telefone,
    papel: 'aluno',
    ativo: true,
    googleId: null,
    senhaHash,
    criadoEm,
  }));
  usuarios.push(...alunos);

  // --- Catálogo de pacotes e locais ---
  const pacotes = DEFAULTS.pacotes.map((p) => ({ ...p }));
  const locais = DEFAULTS.locais.map((l) => ({ ...l }));

  // --- Compras e créditos dos alunos de exemplo ---
  const compras = [];
  const creditos = [];
  const comprasDemo = [
    { aluno: 0, pacote: 'pac-4', metodo: 'pix' },
    { aluno: 1, pacote: 'pac-9', metodo: 'cartao' },
    { aluno: 2, pacote: 'pac-4', metodo: 'mercadopago' },
    { aluno: 3, pacote: 'pac-9', metodo: 'cartao' },
    { aluno: 4, pacote: 'pac-4', metodo: 'pix' },
    { aluno: 5, pacote: 'pac-avulsa', metodo: 'pix' },
    // Camila é a mensalista: os créditos dela só valem sábado e domingo,
    // o que dá um caso pronto para testar a restrição no agendamento.
    { aluno: 6, pacote: 'pac-mensal-2x', metodo: 'cartao' },
    { aluno: 7, pacote: 'pac-4', metodo: 'pix' },
    { aluno: 0, pacote: 'pac-individual', metodo: 'cartao' },
  ];

  comprasDemo.forEach((c, i) => {
    const pacote = pacotes.find((p) => p.id === c.pacote);
    const alunoId = alunos[c.aluno].id;
    const compraId = `cmp-demo-${i + 1}`;
    const quando = new Date();
    quando.setDate(quando.getDate() - (comprasDemo.length - i) * 3);
    const tipoPacote = pacote.tipo === 'individual' ? 'individual' : 'grupo';

    compras.push({
      id: compraId,
      alunoId,
      pacoteId: pacote.id,
      nomePacote: pacote.nome,
      valor: pacote.preco,
      creditos: pacote.creditos,
      validadeDias: pacote.validadeDias ?? null,
      apenasFimDeSemana: pacote.apenasFimDeSemana === true,
      tipoPacote,
      metodo: c.metodo,
      status: 'pago',
      referenciaPagamento: `DEMO-${String(i + 1).padStart(6, '0')}`,
      criadoEm: quando.toISOString(),
      pagoEm: quando.toISOString(),
    });

    // A validade conta a partir do pagamento, igual ao fluxo real.
    let expiraEm = null;
    if (pacote.validadeDias) {
      const limite = new Date(quando);
      limite.setDate(limite.getDate() + pacote.validadeDias);
      limite.setHours(23, 59, 59, 999);
      expiraEm = limite.toISOString();
    }

    creditos.push({
      id: `crd-demo-${i + 1}`,
      alunoId,
      delta: pacote.creditos,
      motivo: 'compra',
      compraId,
      nomePacote: pacote.nome,
      pacoteId: pacote.id,
      tipoPacote,
      apenasFimDeSemana: pacote.apenasFimDeSemana === true,
      expiraEm,
      agendamentoId: null,
      criadoEm: quando.toISOString(),
    });
  });

  // --- Agendamentos ---
  // Monta uma agenda realista nos próximos dias, incluindo uma turma lotada
  // (5/5) para dar o que testar na regra de capacidade.
  const agendamentos = [];
  let seqAg = 0;

  const marcar = (alunoIdx, professorId, dia, horario, tipo = 'grupo', localId = 'local-barra') => {
    seqAg += 1;
    const aluno = alunos[alunoIdx];
    const agendamentoId = `agd-demo-${seqAg}`;
    const data = diaRelativo(dia);
    agendamentos.push({
      id: agendamentoId,
      alunoId: aluno.id,
      alunoNome: aluno.nome,
      professorId,
      data,
      horario,
      duracaoMin: DEFAULTS.duracaoMin,
      tipo,
      localId,
      status: 'confirmado',
      canceladoPor: null,
      motivoCancelamento: null,
      criadoEm: agora(),
    });
    // Todo agendamento consome um crédito — o extrato precisa refletir isso.
    creditos.push({
      id: `crd-ag-${seqAg}`,
      alunoId: aluno.id,
      delta: -1,
      motivo: 'agendamento',
      compraId: null,
      agendamentoId,
      criadoEm: agora(),
    });
  };

  // Turma LOTADA amanhã às 08:00 com o Igor (5 alunos) — testa o limite.
  [0, 1, 2, 3, 4].forEach((idx) => marcar(idx, 'prof-igor', 1, '08:00'));

  // Turma quase cheia amanhã às 10:00 com o Jorge (4 alunos).
  [5, 6, 7, 0].forEach((idx) => marcar(idx, 'prof-jorge', 1, '10:00'));

  // Aulas espalhadas nos próximos dias.
  marcar(1, 'prof-laudinei', 2, '14:00');
  marcar(2, 'prof-laudinei', 2, '14:00');
  marcar(3, 'prof-igor', 2, '16:00');
  marcar(4, 'prof-jorge', 3, '08:00', 'grupo', 'local-mole');
  marcar(5, 'prof-jorge', 3, '08:00', 'grupo', 'local-mole');
  // Camila é mensalista: aula no fim de semana, como o plano exige.
  marcar(6, 'prof-igor', proximoFimDeSemana(3), '10:00');
  marcar(0, 'prof-laudinei', 5, '16:00', 'individual');
  marcar(7, 'prof-igor', 6, '08:00');
  marcar(1, 'prof-jorge', 7, '14:00');

  // --- Aviso de exemplo ---
  const inicio = new Date();
  inicio.setDate(inicio.getDate() - 1);
  const fim = new Date();
  fim.setDate(fim.getDate() + 30);

  const avisos = [{
    id: 'avs-demo-1',
    titulo: 'Atenção à previsão do fim de semana',
    mensagem: 'Está prevista entrada de swell forte no sábado. As turmas das 08:00 e 10:00 podem ser transferidas para a Praia Mole. Confirme no WhatsApp na manhã da aula.',
    tipo: 'aviso',
    ativo: true,
    inicioEm: inicio.toISOString(),
    fimEm: fim.toISOString(),
    criadoPor: 'usr-prof-laudinei',
    criadoEm: agora(),
  }];

  // --- Configuração da escola ---
  const config = [{
    id: 'app',
    horarios: [...DEFAULTS.horarios],
    duracaoMin: DEFAULTS.duracaoMin,
    capacidadeGrupo: DEFAULTS.capacidadeGrupo,
    horasMinimasCancelamento: DEFAULTS.horasMinimasCancelamento,
    localPadraoId: 'local-barra',
    atualizadoEm: agora(),
  }];

  escrever('usuarios', usuarios);
  escrever('professores', professores);
  escrever('pacotes', pacotes);
  escrever('locais', locais);
  escrever('compras', compras);
  escrever('creditos', creditos);
  escrever('agendamentos', agendamentos);
  escrever('avisos', avisos);
  escrever('avisosLidos', []);
  escrever('config', config);

  localStorage.setItem(CHAVE_VERSAO, String(VERSAO_SEED));
}

/* --------------------------------------------------------------------------
   Driver
   -------------------------------------------------------------------------- */

export function criarDriver() {
  /**
   * Fila de transações. Como o localStorage é síncrono, basta encadear as
   * transações em série para que nenhuma leia dados no meio da escrita de outra.
   */
  let filaTransacoes = Promise.resolve();

  const operacoes = {
    listar(colecao, filtros = {}, opcoes = {}) {
      return aplicarOrdenacao(aplicarFiltros(ler(colecao), filtros), opcoes);
    },

    obter(colecao, id) {
      return ler(colecao).find((item) => item.id === id) || null;
    },

    criar(colecao, dados) {
      const itens = ler(colecao);
      const registro = {
        ...dados,
        id: dados.id || novoId(colecao.slice(0, 3)),
        criadoEm: dados.criadoEm || agora(),
      };
      if (itens.some((i) => i.id === registro.id)) {
        throw new Error(`Já existe um registro com o id "${registro.id}" em ${colecao}.`);
      }
      itens.push(registro);
      escrever(colecao, itens);
      return registro;
    },

    atualizar(colecao, id, campos) {
      const itens = ler(colecao);
      const idx = itens.findIndex((item) => item.id === id);
      if (idx === -1) throw new Error(`Registro "${id}" não encontrado em ${colecao}.`);
      itens[idx] = { ...itens[idx], ...campos, id, atualizadoEm: agora() };
      escrever(colecao, itens);
      return itens[idx];
    },

    remover(colecao, id) {
      const itens = ler(colecao);
      const restantes = itens.filter((item) => item.id !== id);
      if (restantes.length === itens.length) return false;
      escrever(colecao, restantes);
      return true;
    },
  };

  return {
    async inicializar() {
      const versao = Number(localStorage.getItem(CHAVE_VERSAO) || 0);
      if (versao < VERSAO_SEED) {
        // Seed novo: limpa o que havia para não misturar formatos antigos.
        for (const colecao of COLECOES) localStorage.removeItem(PREFIXO + colecao);
        await semear();
      }
    },

    ...operacoes,

    /** As operações já são síncronas; a fila só garante a ordem entre blocos. */
    transacao(fn) {
      const executar = async () => fn(operacoes);
      filaTransacoes = filaTransacoes.then(executar, executar);
      return filaTransacoes;
    },

    observar(colecao, filtros, cb, opcoes = {}) {
      const emitir = () => cb(aplicarOrdenacao(aplicarFiltros(ler(colecao), filtros), opcoes));
      if (!ouvintes.has(colecao)) ouvintes.set(colecao, new Set());
      ouvintes.get(colecao).add(emitir);
      emitir();
      return () => ouvintes.get(colecao)?.delete(emitir);
    },

    async reiniciar() {
      for (const colecao of COLECOES) localStorage.removeItem(PREFIXO + colecao);
      localStorage.removeItem(CHAVE_VERSAO);
      localStorage.removeItem('bf_sessao');
      await semear();
      COLECOES.forEach(notificar);
    },
  };
}
