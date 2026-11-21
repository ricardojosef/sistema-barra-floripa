/**
 * saude.js — Questionário de Prontidão para Atividade Física (PAR-Q) e
 * Termo de Responsabilidade (Lei SC nº 16.724/2018).
 *
 * Conteúdo transcrito do documento da escola
 * (Termo-Responsabilidade-para-Pratica-Atividades-Fisica.pdf).
 *
 * Cada resposta vira um documento imutável em `declaracoes`. A declaração
 * vale por N meses (config.validadeDeclaracaoMeses, padrão 6). Sem
 * declaração válida o aluno não compra pacote nem agenda aula; ele e a
 * equipe podem baixar o PDF assinado a qualquer momento.
 */

import { listar, criar } from './store.js';
import { obterConfig } from './precos.js';
import { DEFAULTS } from './config.js';
import { documentoFormatado, rotuloDocumento, idadeEm } from './documentos.js';
import { formatarData } from './ui.js';

export class ErroSaude extends Error {
  constructor(codigo, mensagem) {
    super(mensagem);
    this.name = 'ErroSaude';
    this.codigo = codigo;
  }
}

/* --------------------------------------------------------------------------
   Conteúdo do documento
   -------------------------------------------------------------------------- */

export const PERGUNTAS = {
  pt: [
    'Algum médico já disse que você possui algum problema de coração e que só deveria realizar atividade física supervisionado por profissionais de saúde?',
    'Você sente dores no peito quando pratica atividade física?',
    'No último mês, você sentiu dores no peito quando praticou atividade física?',
    'Você apresenta desequilíbrio devido à tontura e/ou perda de consciência?',
    'Você possui algum problema ósseo ou articular que poderia ser piorado pela atividade física?',
    'Você toma atualmente algum medicamento para pressão arterial e/ou problema do coração?',
    'Sabe de alguma outra razão pela qual você não deve praticar atividade física?',
  ],
  en: [
    'Has a doctor ever said that you have a heart condition and that you should only do physical activity supervised by health professionals?',
    'Do you feel pain in your chest when you do physical activity?',
    'In the past month, have you had chest pain when doing physical activity?',
    'Do you lose your balance because of dizziness and/or ever lose consciousness?',
    'Do you have a bone or joint problem that could be made worse by physical activity?',
    'Are you currently taking medication for blood pressure and/or a heart condition?',
    'Do you know of any other reason why you should not do physical activity?',
  ],
  es: [
    '¿Algún médico le ha dicho que tiene un problema del corazón y que solo debería realizar actividad física supervisada por profesionales de la salud?',
    '¿Siente dolor en el pecho cuando realiza actividad física?',
    'En el último mes, ¿ha sentido dolor en el pecho al realizar actividad física?',
    '¿Presenta desequilibrio debido a mareos y/o pérdida de conciencia?',
    '¿Tiene algún problema óseo o articular que podría empeorar con la actividad física?',
    '¿Toma actualmente algún medicamento para la presión arterial y/o problemas del corazón?',
    '¿Conoce alguna otra razón por la cual no debería realizar actividad física?',
  ],
};

export const TERMO = {
  pt: {
    titulo: 'Termo de Responsabilidade para Atividade Física',
    texto1: 'Estou ciente de que é recomendável conversar com um médico antes de aumentar meu nível atual de atividade física, por ter respondido as perguntas do "Questionário de Prontidão para Atividade Física" (PAR-Q).',
    texto2: 'Assumo plena responsabilidade por qualquer atividade física praticada sem o atendimento a essa recomendação e isento a Escola de Surf Barra Floripa, bem como todos diretamente envolvidos no desenvolvimento das atividades oferecidas e praticadas por mim, de toda e qualquer responsabilidade por danos à minha saúde ou de qualquer outra espécie, que eventualmente possam ser causados.',
  },
  en: {
    titulo: 'Liability Waiver for Physical Activity',
    texto1: 'I am aware that it is advisable to talk to a doctor before increasing my current level of physical activity, having answered the questions of the "Physical Activity Readiness Questionnaire" (PAR-Q).',
    texto2: 'I take full responsibility for any physical activity practiced without following this recommendation and I release Barra Floripa Surf School, as well as everyone directly involved in the activities offered and practiced by me, from any and all liability for damage to my health or of any other kind that may eventually be caused.',
  },
  es: {
    titulo: 'Término de Responsabilidad para Actividad Física',
    texto1: 'Soy consciente de que es recomendable hablar con un médico antes de aumentar mi nivel actual de actividad física, por haber respondido las preguntas del "Cuestionario de Aptitud para la Actividad Física" (PAR-Q).',
    texto2: 'Asumo plena responsabilidad por cualquier actividad física practicada sin atender esta recomendación y eximo a la Escuela de Surf Barra Floripa, así como a todos los directamente involucrados en el desarrollo de las actividades ofrecidas y practicadas por mí, de toda y cualquier responsabilidad por daños a mi salud o de cualquier otra especie que eventualmente puedan causarse.',
  },
};

export const INTRO_PARQ = 'Em conformidade com a Lei nº 16.724, de 22 de maio de 2018, que alterou a Lei nº 10.048, de julho de 2001, para estabelecer e flexibilizar novos métodos de avaliação médica para os praticantes de atividades físicas e desportivas. Este documento é composto de duas partes: 1. Questionário de Prontidão para Atividade Física (PAR-Q); 2. Termo de Responsabilidade para Prática de Atividade Física.';

/* --------------------------------------------------------------------------
   Validade
   -------------------------------------------------------------------------- */

/** Data (ISO completo) em que a declaração assinada em `assinadoEm` vence. */
export function calcularValidade(assinadoEm, meses = DEFAULTS.validadeDeclaracaoMeses) {
  const d = new Date(assinadoEm);
  d.setMonth(d.getMonth() + Number(meses || 6));
  return d.toISOString();
}

export const declaracaoVigente = (decl, agora = new Date()) => !!decl && new Date(decl.validaAte) > agora;

/** Declarações do aluno, da mais recente para a mais antiga. */
export async function declaracoesDoAluno(alunoId) {
  return listar('declaracoes', { alunoId }, { ordenarPor: 'assinadoEm', direcao: 'desc' });
}

/** Última declaração do aluno, vigente ou não (null se nunca respondeu). */
export async function ultimaDeclaracao(alunoId) {
  const todas = await declaracoesDoAluno(alunoId);
  return todas[0] || null;
}

/** A declaração vigente do aluno, ou null. */
export async function declaracaoValida(alunoId) {
  const ultima = await ultimaDeclaracao(alunoId);
  return declaracaoVigente(ultima) ? ultima : null;
}

/** Dias até vencer (negativo = vencida). */
export function diasParaVencer(decl) {
  if (!decl) return null;
  return Math.ceil((new Date(decl.validaAte) - Date.now()) / 86400000);
}

/* --------------------------------------------------------------------------
   Assinatura
   -------------------------------------------------------------------------- */

/**
 * Grava a declaração. `dados`:
 *   { respostas: ['sim'|'nao' x7], nomeCompleto, rg, celular, email,
 *     nascimento, responsavelNome?, observacoes?, assinatura (data URL PNG),
 *     aceite: true, idioma }
 */
export async function assinarDeclaracao(usuario, dados) {
  if (!usuario) throw new ErroSaude('SEM_SESSAO', 'Entre novamente para continuar.');

  const respostas = Array.isArray(dados.respostas) ? dados.respostas : [];
  if (respostas.length !== PERGUNTAS.pt.length || respostas.some((r) => r !== 'sim' && r !== 'nao')) {
    throw new ErroSaude('RESPOSTAS', 'Responda SIM ou NÃO a todas as perguntas.');
  }
  const nomeCompleto = String(dados.nomeCompleto || '').trim();
  if (nomeCompleto.length < 5) throw new ErroSaude('NOME', 'Informe o nome completo, por extenso.');
  if (!dados.nascimento) throw new ErroSaude('NASCIMENTO', 'Informe a data de nascimento.');

  const idade = idadeEm(dados.nascimento);
  if (idade !== null && idade < 18 && String(dados.responsavelNome || '').trim().length < 5) {
    throw new ErroSaude('RESPONSAVEL', 'Para menores de 18 anos, o responsável legal precisa informar o nome e assinar.');
  }
  if (!dados.aceite) throw new ErroSaude('ACEITE', 'É preciso aceitar o Termo de Responsabilidade.');
  if (!/^data:image\/png;base64,/.test(String(dados.assinatura || ''))) {
    throw new ErroSaude('ASSINATURA', 'Assine no quadro com o dedo ou o mouse.');
  }
  if (dados.assinatura.length > 120000) {
    throw new ErroSaude('ASSINATURA', 'A assinatura ficou grande demais. Limpe e assine de novo, sem rabiscar o quadro todo.');
  }

  const config = await obterConfig();
  const assinadoEm = new Date().toISOString();

  return criar('declaracoes', {
    alunoId: usuario.id,
    alunoNome: usuario.nome,
    nomeCompleto,
    documento: documentoFormatado(usuario),
    tipoDocumento: rotuloDocumento(usuario),
    rg: String(dados.rg || '').trim().slice(0, 30),
    celular: String(dados.celular || usuario.telefone || '').trim().slice(0, 25),
    email: usuario.email,
    nascimento: dados.nascimento,
    idade,
    responsavelNome: String(dados.responsavelNome || '').trim().slice(0, 120) || null,
    respostas,
    algumSim: respostas.includes('sim'),
    observacoes: String(dados.observacoes || '').trim().slice(0, 600) || null,
    aceiteTermo: true,
    assinatura: dados.assinatura,
    idioma: dados.idioma || 'pt',
    assinadoEm,
    validaAte: calcularValidade(assinadoEm, config.validadeDeclaracaoMeses),
    navegador: navigator.userAgent.slice(0, 200),
    criadoEm: assinadoEm,
  });
}

/* --------------------------------------------------------------------------
   PDF (jsPDF, carregado sob demanda)
   -------------------------------------------------------------------------- */

const URL_JSPDF = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
let promessaJsPdf = null;

function carregarJsPdf() {
  if (window.jspdf?.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
  if (promessaJsPdf) return promessaJsPdf;
  promessaJsPdf = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = URL_JSPDF;
    s.async = true;
    s.onload = () => (window.jspdf?.jsPDF ? resolve(window.jspdf.jsPDF) : reject(new Error('jsPDF não carregou.')));
    s.onerror = () => { promessaJsPdf = null; reject(new Error('Não foi possível carregar o gerador de PDF. Verifique a internet.')); };
    document.head.append(s);
  });
  return promessaJsPdf;
}

async function logoDataUrl() {
  try {
    const resp = await fetch('logomenor-barrafloripa.png');
    const blob = await resp.blob();
    return await new Promise((res) => {
      const leitor = new FileReader();
      leitor.onload = () => res(leitor.result);
      leitor.onerror = () => res(null);
      leitor.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * Gera o PDF da declaração (sempre em português, que é o documento oficial
 * da escola) e dispara o download.
 */
export async function baixarPdfDeclaracao(decl) {
  const JsPDF = await carregarJsPdf();
  const doc = new JsPDF({ unit: 'mm', format: 'a4' });
  const margem = 18;
  const largura = 210 - margem * 2;
  let y = 16;

  const logo = await logoDataUrl();
  if (logo) doc.addImage(logo, 'PNG', 105 - 13, y, 26, 26);
  y += logo ? 32 : 6;

  const titulo = (texto) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text(texto, 105, y, { align: 'center' });
    y += 6;
  };
  const paragrafo = (texto, { negrito = false, tamanho = 9.5, espaco = 3 } = {}) => {
    doc.setFont('helvetica', negrito ? 'bold' : 'normal');
    doc.setFontSize(tamanho);
    const linhas = doc.splitTextToSize(texto, largura);
    if (y + linhas.length * 4.6 > 282) { doc.addPage(); y = 18; }
    doc.text(linhas, margem, y);
    y += linhas.length * 4.6 + espaco;
  };

  titulo('Questionário de Prontidão para Atividade Física');
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text('(para pessoas entre 15 e 69 anos)', 105, y, { align: 'center' });
  y += 8;
  paragrafo(INTRO_PARQ);

  PERGUNTAS.pt.forEach((pergunta, i) => {
    paragrafo(`${i + 1}) ${pergunta}`, { espaco: 0.5 });
    const resp = decl.respostas?.[i] === 'sim' ? '(X) SIM   ( ) NÃO' : '( ) SIM   (X) NÃO';
    paragrafo(resp, { negrito: true, espaco: 2.5 });
  });
  if (decl.observacoes) paragrafo(`Observações do aluno: ${decl.observacoes}`);

  y += 2;
  titulo(TERMO.pt.titulo);
  y += 2;
  paragrafo(TERMO.pt.texto1);
  paragrafo(TERMO.pt.texto2, { negrito: true });

  y += 2;
  const linha = (rotulo, valor) => paragrafo(`${rotulo}: ${valor || '—'}`, { espaco: 1 });
  linha('Nome completo', decl.nomeCompleto);
  linha('Nº do R.G.', decl.rg);
  linha(`Nº do ${decl.tipoDocumento || 'CPF'}`, decl.documento);
  linha('Nº celular', decl.celular);
  linha('E-mail', decl.email);
  linha('Data de nascimento', decl.nascimento ? formatarData(decl.nascimento, { br: true }) : '');
  if (decl.responsavelNome) linha('Responsável legal (menor de 18 anos)', decl.responsavelNome);

  y += 3;
  if (y > 240) { doc.addPage(); y = 20; }
  if (decl.assinatura) {
    try { doc.addImage(decl.assinatura, 'PNG', margem, y, 70, 26); } catch { /* assinatura inválida */ }
  }
  y += 28;
  doc.line(margem, y, margem + 80, y);
  y += 4;
  paragrafo('Assinatura do(a) aluno(a)' + (decl.responsavelNome ? ' / responsável' : ''), { tamanho: 9 });

  const assinado = new Date(decl.assinadoEm);
  paragrafo(`Florianópolis, ${formatarData(decl.assinadoEm.slice(0, 10), { br: true })} — assinado eletronicamente às `
    + `${String(assinado.getHours()).padStart(2, '0')}:${String(assinado.getMinutes()).padStart(2, '0')}.`, { tamanho: 9 });
  paragrafo(`Válido até ${formatarData(String(decl.validaAte).slice(0, 10), { br: true })}. Registro ${decl.id}.`, { tamanho: 8 });

  const nomeArquivo = `declaracao-saude-${String(decl.nomeCompleto || decl.alunoNome || 'aluno')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase()}`
    + `-${decl.assinadoEm.slice(0, 10)}.pdf`;
  doc.save(nomeArquivo);
}
