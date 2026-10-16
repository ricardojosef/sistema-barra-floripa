/**
 * precos.js — fonte única de verdade para preços, pacotes, professores,
 * locais e parâmetros da escola.
 *
 * As telas NUNCA leem DEFAULTS direto do config.js. Elas chamam as funções
 * daqui, que fazem o merge entre os valores de fábrica e o que o administrador
 * gravou no painel. Assim, qualquer edição no admin propaga sozinha para a
 * landing, o checkout, o agendamento e os painéis.
 */

import { DEFAULTS, PRECO_AULA_AVULSA } from './config.js';
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
    atualizadoEm: salvo?.atualizadoEm || null,
  };
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
export function economiaDoPacote(pacote, precoAvulsa = PRECO_AULA_AVULSA) {
  if (!pacote || pacote.tipo === 'avulsa' || pacote.tipo === 'individual') return null;

  const creditos = Number(pacote.creditos) || 0;
  if (creditos < 2) return null;

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
