/**
 * disponibilidade.js — quando e onde cada professor atende.
 *
 * Documento `disponibilidade/{professorId}`:
 *   {
 *     professorId,
 *     semana:    { '0': ['08:00', '10:00'], ..., '6': [...] }  // 0 = domingo
 *     locais:    { '0': 'local-barra', ... }                   // local de cada dia
 *     dias:      { '2026-11-02': { horarios: ['08:00'], localId, motivo } }
 *     bloqueios: [ { data: '2026-11-02', horarios: [], motivo } ]  // [] = dia todo
 *   }
 *
 * `semana` é o padrão que se repete toda semana. `dias` são ajustes feitos no
 * calendário para uma data específica e substituem o padrão naquela data —
 * `horarios: []` é folga. `bloqueios` é o formato antigo (só tirava
 * horários); continua valendo para documentos salvos antes do calendário,
 * mas a tela converte tudo para `dias` ao salvar.
 *
 * Sem documento, o professor atende todos os horários da escola todos os
 * dias, no local padrão — exatamente o comportamento de antes desta tela
 * existir. Assim nenhuma agenda "some" até alguém configurar.
 *
 * Os horários possíveis continuam sendo os da escola (config.horarios);
 * aqui o professor só escolhe em quais deles trabalha.
 */

import { listar, obter, criar, atualizar } from './store.js';
import { usuarioAtual } from './auth.js';
import { dataDeISO, hojeISO } from './ui.js';

export class ErroDisponibilidade extends Error {
  constructor(codigo, mensagem) {
    super(mensagem);
    this.name = 'ErroDisponibilidade';
    this.codigo = codigo;
  }
}

const DIAS = ['0', '1', '2', '3', '4', '5', '6'];

/** Disponibilidade de quem nunca configurou: tudo, todos os dias. */
export function disponibilidadePadrao(professorId, config) {
  const semana = {};
  const locais = {};
  for (const dia of DIAS) {
    semana[dia] = [...config.horarios];
    locais[dia] = config.localPadraoId;
  }
  return { professorId, semana, locais, dias: {}, bloqueios: [], padrao: true };
}

/** Completa um documento salvo com o que faltar (dias novos, local). */
export function normalizarDisponibilidade(doc, professorId, config) {
  const base = disponibilidadePadrao(professorId, config);
  if (!doc) return base;
  const semana = {};
  const locais = {};
  for (const dia of DIAS) {
    semana[dia] = Array.isArray(doc.semana?.[dia]) ? doc.semana[dia] : base.semana[dia];
    locais[dia] = doc.locais?.[dia] || base.locais[dia];
  }
  return {
    ...doc,
    professorId,
    semana,
    locais,
    dias: doc.dias && typeof doc.dias === 'object' ? doc.dias : {},
    bloqueios: Array.isArray(doc.bloqueios) ? doc.bloqueios : [],
    padrao: false,
  };
}

export async function obterDisponibilidade(professorId, config) {
  const doc = await obter('disponibilidade', professorId);
  return normalizarDisponibilidade(doc, professorId, config);
}

/** Disponibilidade de vários professores de uma vez: Map professorId -> disp. */
export async function mapaDisponibilidades(professores, config) {
  const docs = await listar('disponibilidade');
  const porId = new Map(docs.map((d) => [d.id, d]));
  return new Map(professores.map((p) => [p.id, normalizarDisponibilidade(porId.get(p.id), p.id, config)]));
}

/**
 * Horários em que o professor atende numa data, já descontados os
 * bloqueios. Devolve [{ horario, localId }], na ordem da grade da escola.
 */
export function horariosNoDia(disp, data, config) {
  const dia = String(dataDeISO(data).getDay());
  const ajuste = disp.dias?.[data];
  const doDia = new Set(ajuste ? ajuste.horarios || [] : disp.semana[dia] || []);
  const localId = (ajuste && ajuste.localId) || disp.locais[dia] || config.localPadraoId;

  const bloqueiosDoDia = (disp.bloqueios || []).filter((b) => b.data === data);
  if (bloqueiosDoDia.some((b) => !b.horarios || b.horarios.length === 0)) return [];
  const bloqueados = new Set(bloqueiosDoDia.flatMap((b) => b.horarios || []));

  // Só horários que a escola ainda oferece: se o admin tirar um horário da
  // grade, ele some de todas as agendas, mesmo que o professor o tivesse.
  return config.horarios
    .filter((h) => doDia.has(h) && !bloqueados.has(h))
    .map((horario) => ({ horario, localId }));
}

/**
 * Converte os bloqueios do formato antigo em ajustes de dia, para a tela do
 * calendário trabalhar com um formato só. Devolve uma cópia.
 */
export function bloqueiosComoDias(disp, config) {
  const dias = structuredClone(disp.dias || {});
  for (const b of disp.bloqueios || []) {
    if (dias[b.data]) continue;
    const efetivos = horariosNoDia(disp, b.data, config);
    dias[b.data] = {
      horarios: efetivos.map((s) => s.horario),
      localId: efetivos[0]?.localId || disp.locais[String(dataDeISO(b.data).getDay())],
      motivo: b.motivo || '',
    };
  }
  return dias;
}

/* --------------------------------------------------------------------------
   Edição
   -------------------------------------------------------------------------- */

/**
 * Quem pode editar a disponibilidade de um professor: ele mesmo ou o
 * administrador. As regras do Firestore repetem essa checagem no servidor.
 */
async function exigirPermissao(professorId) {
  const usuario = usuarioAtual();
  if (!usuario) throw new ErroDisponibilidade('SEM_SESSAO', 'Entre novamente para continuar.');
  if (usuario.papel === 'admin') return usuario;

  const professor = await obter('professores', professorId);
  if (usuario.papel === 'professor' && professor?.usuarioId === usuario.id) return usuario;

  throw new ErroDisponibilidade('SEM_PERMISSAO', 'Você só pode editar a sua própria disponibilidade.');
}

/** Valida e limpa os dados vindos da tela. */
function sanitizar({ semana, locais, dias, bloqueios }, config, locaisValidos) {
  const horariosValidos = new Set(config.horarios);
  const limpa = { semana: {}, locais: {}, dias: {}, bloqueios: [] };

  for (const dia of DIAS) {
    limpa.semana[dia] = (semana?.[dia] || []).filter((h) => horariosValidos.has(h));
    const local = locais?.[dia];
    limpa.locais[dia] = locaisValidos.has(local) ? local : config.localPadraoId;
  }

  const hoje = hojeISO();
  for (const [data, ajuste] of Object.entries(dias || {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || data < hoje) continue;
    limpa.dias[data] = {
      horarios: (ajuste?.horarios || []).filter((h) => horariosValidos.has(h)),
      localId: locaisValidos.has(ajuste?.localId) ? ajuste.localId : limpa.locais[String(dataDeISO(data).getDay())],
      motivo: String(ajuste?.motivo || '').trim().slice(0, 120),
    };
  }

  for (const b of bloqueios || []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.data))) continue;
    if (b.data < hoje) continue; // bloqueio no passado não serve para nada
    limpa.bloqueios.push({
      data: b.data,
      horarios: (b.horarios || []).filter((h) => horariosValidos.has(h)),
      motivo: String(b.motivo || '').trim().slice(0, 120),
    });
  }
  limpa.bloqueios.sort((a, b) => a.data.localeCompare(b.data));
  return limpa;
}

/**
 * Aulas já marcadas que ficariam fora da nova disponibilidade.
 * Elas NÃO são canceladas automaticamente — o professor decide —, mas a
 * tela mostra quantas são antes de salvar.
 */
export async function aulasForaDaDisponibilidade(professorId, novaDisp, config) {
  const aulas = await listar('agendamentos', { professorId, status: 'confirmado' });
  const hoje = hojeISO();
  const disp = normalizarDisponibilidade(novaDisp, professorId, config);
  return aulas.filter((a) => {
    if (a.data < hoje) return false;
    return !horariosNoDia(disp, a.data, config).some((s) => s.horario === a.horario);
  });
}

export async function salvarDisponibilidade(professorId, dados, config, locais) {
  const usuario = await exigirPermissao(professorId);
  const limpa = sanitizar(dados, config, new Set(locais.map((l) => l.id)));

  const registro = {
    professorId,
    ...limpa,
    atualizadoPor: usuario.id,
    atualizadoEm: new Date().toISOString(),
  };

  const existente = await obter('disponibilidade', professorId);
  if (existente) return atualizar('disponibilidade', professorId, registro);
  return criar('disponibilidade', { id: professorId, ...registro });
}
