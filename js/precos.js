/**
 * precos.js — fonte única de verdade para preços, pacotes, professores,
 * locais e parâmetros da escola.
 *
 * As telas NUNCA leem DEFAULTS direto do config.js. Elas chamam as funções
 * daqui, que fazem o merge entre os valores de fábrica e o que o administrador
 * gravou no painel. Assim, qualquer edição no admin propaga sozinha para a
 * landing, o checkout, o agendamento e os painéis.
 */

import { DEFAULTS, PRECO_AULA_AVULSA, ESCOLA } from './config.js';
import { listar, obter } from './store.js';

/* --------------------------------------------------------------------------
   Configuração geral da escola
   -------------------------------------------------------------------------- */

/**
 * Parâmetros operacionais (horários, capacidade, duração).
 * Se o documento `config/app` não existir, cai nos valores de fábrica.
 */
export async function obterConfig() {
  const salvo = await obter('config', 'app');
  return {
    horarios: salvo?.horarios?.length ? salvo.horarios : [...DEFAULTS.horarios],
    duracaoMin: salvo?.duracaoMin ?? DEFAULTS.duracaoMin,
    capacidadeGrupo: salvo?.capacidadeGrupo ?? DEFAULTS.capacidadeGrupo,
    horasMinimasCancelamento: salvo?.horasMinimasCancelamento ?? DEFAULTS.horasMinimasCancelamento,
    localPadraoId: salvo?.localPadraoId || DEFAULTS.locais[0]?.id || null,
    validadeDeclaracaoMeses: salvo?.validadeDeclaracaoMeses ?? DEFAULTS.validadeDeclaracaoMeses,
    remuneracao: { ...DEFAULTS.remuneracao, ...(salvo?.remuneracao || {}) },
    /** Datas sem aula (tempestade, feriado...): [{ data, motivo, avisoId }]. */
    diasSemAula: Array.isArray(salvo?.diasSemAula) ? salvo.diasSemAula : [],
    grupoWhatsapp: salvo?.grupoWhatsapp ?? ESCOLA.grupoWhatsapp ?? '',
    atualizadoEm: salvo?.atualizadoEm || null,
  };
}

/** A data está bloqueada por um aviso de "não haverá aulas"? Devolve o bloqueio ou null. */
export function bloqueioDoDia(config, data) {
  return (config?.diasSemAula || []).find((d) => d.data === data) || null;
}

/* --------------------------------------------------------------------------
   Pacotes e preços
   -------------------------------------------------------------------------- */

/**
 * Catálogo de pacotes ativos, ordenado.
 * `incluirInativos` serve ao painel admin, que precisa ver tudo.
 */
export async function obterPacotes({ incluirInativos = false } = {}) {
  const salvos = await listar('pacotes');
  const base = salvos.length ? salvos : DEFAULTS.pacotes;
  const lista = incluirInativos ? base : base.filter((p) => p.ativo !== false);
  return [...lista].sort((a, b) => (a.ordem ?? 99) - (b.ordem ?? 99));
}

export async function obterPacote(pacoteId) {
  const pacotes = await obterPacotes({ incluirInativos: true });
  return pacotes.find((p) => p.id === pacoteId) || null;
}

/** Pacotes agrupados por tipo, como a landing e o checkout exibem. */
export async function obterPacotesAgrupados() {
  const pacotes = await obterPacotes();
  return {
    grupo: pacotes.filter((p) => p.tipo === 'avulsa' || p.tipo === 'pacote'),
    individual: pacotes.filter((p) => p.tipo === 'individual'),
    mensal: pacotes.filter((p) => p.tipo === 'mensal'),
    todos: pacotes,
  };
}

/** Preço por aula, usado no rótulo "R$ 120 por aula". */
export function precoUnitario(pacote) {
  const creditos = Number(pacote?.creditos) || 1;
  return (Number(pacote?.preco) || 0) / creditos;
}

/** Texto do período para planos mensais ('/mês') ou vazio para pacotes. */
export const sufixoPeriodo = (pacote) => (pacote?.tipo === 'mensal' ? '/mês' : '');

/**
 * Quanto o aluno economiza em relação a comprar aulas avulsas.
 * Retorna null quando não há desconto (aula avulsa ou particular).
 */
/** Quantas aulas avulsas/particulares dá para comprar de uma vez. */
export const MAX_QUANTIDADE = 12;

/** Só planos de 1 crédito (aula avulsa, particular) podem ser comprados em quantidade. */
export const aceitaQuantidade = (pacote) => Number(pacote?.creditos) === 1;

/**
 * O plano multiplicado pela quantidade: '2× Aula em Grupo Avulsa', preço e
 * créditos dobrados. O servidor refaz a mesma conta antes de cobrar.
 */
export function pacoteComQuantidade(pacote, quantidade = 1) {
  const q = aceitaQuantidade(pacote) ? Math.min(MAX_QUANTIDADE, Math.max(1, Math.trunc(Number(quantidade)) || 1)) : 1;
  if (q === 1) return { ...pacote, quantidade: 1 };
  return {
    ...pacote,
    quantidade: q,
    nomeBase: pacote.nome,
    nome: `${q}× ${pacote.nome}`,
    preco: Number(pacote.preco) * q,
    precoUnitarioBase: Number(pacote.preco),
    creditos: q,
  };
}

/** Limite de créditos de um plano (o admin não salva acima disso). */
export const MAX_CREDITOS_PACOTE = 60;

export function economiaDoPacote(pacote, precoAvulsa = PRECO_AULA_AVULSA) {
  if (!pacote || pacote.tipo === 'avulsa' || pacote.tipo === 'individual') return null;

  const creditos = Number(pacote.creditos) || 0;
  // Acima de MAX_CREDITOS_PACOTE o cadastro está errado (ex.: o preço digitado
  // no campo de créditos): melhor não mostrar economia nenhuma.
  if (creditos < 2 || creditos > MAX_CREDITOS_PACOTE) return null;

  const valorSemDesconto = creditos * precoAvulsa;
  const economia = valorSemDesconto - (Number(pacote.preco) || 0);
  if (economia <= 0) return null;

  return {
    valor: economia,
    percentual: Math.round((economia / valorSemDesconto) * 100),
    valorSemDesconto,
  };
}

/** Texto curto da validade: 'válido por 1 mês', '40 dias'... */
export function textoValidade(pacote) {
  const dias = pacote?.validadeDias;
  if (!dias) return null;
  if (dias % 30 === 0) {
    const meses = dias / 30;
    return meses === 1 ? 'válido por 1 mês' : `válido por ${meses} meses`;
  }
  return `válido por ${dias} dias`;
}

/* --------------------------------------------------------------------------
   Professores
   -------------------------------------------------------------------------- */

/** Professores ativos, ordenados. Nome sempre vem daqui (nunca de cache). */
export async function obterProfessores({ incluirInativos = false } = {}) {
  const salvos = await listar('professores');
  const base = salvos.length
    ? salvos
    : DEFAULTS.professores.map((p) => ({ id: p.id, nome: p.nome, ativo: true, ordem: p.ordem }));
  const lista = incluirInativos ? base : base.filter((p) => p.ativo !== false);
  return [...lista].sort((a, b) => (a.ordem ?? 99) - (b.ordem ?? 99));
}

/**
 * Mapa id -> professor, para resolver nomes em listas sem N consultas.
 * Inclui inativos: uma aula antiga pode apontar para professor desativado.
 */
export async function mapaProfessores() {
  const lista = await obterProfessores({ incluirInativos: true });
  return new Map(lista.map((p) => [p.id, p]));
}

/** Nome atual do professor, com fallback para o cache gravado na aula. */
export function nomeProfessor(mapa, professorId, fallback = 'Professor') {
  return mapa.get(professorId)?.nome || fallback;
}

/* --------------------------------------------------------------------------
   Locais
   -------------------------------------------------------------------------- */

export async function obterLocais({ incluirInativos = false } = {}) {
  const salvos = await listar('locais');
  const base = salvos.length ? salvos : DEFAULTS.locais;
  return incluirInativos ? base : base.filter((l) => l.ativo !== false);
}

export async function mapaLocais() {
  const lista = await obterLocais({ incluirInativos: true });
  return new Map(lista.map((l) => [l.id, l]));
}

export function nomeLocal(mapa, localId, fallback = 'A definir') {
  return mapa.get(localId)?.nome || fallback;
}

/* --------------------------------------------------------------------------
   Carga combinada
   -------------------------------------------------------------------------- */

/**
 * Carrega de uma vez tudo que as telas de agendamento e painéis precisam.
 * Evita repetir quatro awaits em cada controlador.
 */
export async function carregarContexto() {
  const [config, professores, locais, pacotes] = await Promise.all([
    obterConfig(),
    obterProfessores(),
    obterLocais(),
    obterPacotes(),
  ]);
  return {
    config,
    professores,
    locais,
    pacotes,
    mapaProfessores: new Map(professores.map((p) => [p.id, p])),
    mapaLocais: new Map(locais.map((l) => [l.id, l])),
  };
}
