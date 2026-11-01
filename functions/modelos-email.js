/**
 * modelos-email.js — textos e visual dos e-mails automáticos.
 *
 * Cada modelo devolve { assunto, html, texto }. O `texto` é a versão sem
 * formatação, exibida por leitores de e-mail que não mostram HTML (e que
 * ajuda a mensagem a não cair no spam).
 *
 * Para mudar um texto, edite aqui e rode `firebase deploy --only functions`.
 */

const SITE_URL = () => (process.env.SITE_URL || '').replace(/\/+$/, '');

// Cópia dos dados de js/config.js (ESCOLA): o servidor não lê os arquivos do site.
const ESCOLA = {
  nome: 'Barra Floripa Surf School',
  whatsapp: '(48) 99900-2584',
  endereco: 'Tv. Manoel Florentino Vieira, 0030 - Barra da Lagoa, Florianópolis - SC',
};

const LARANJA = '#fd711d';

/* ---------- utilitários ---------- */

function escapar(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const primeiroNome = (nome) => String(nome || '').trim().split(/\s+/)[0] || 'aluno';
const plural = (n, um, varios) => `${n} ${Number(n) === 1 ? um : varios}`;

/** '2026-11-14' -> 'sábado, 14 de novembro de 2026' */
function dataExtenso(iso) {
  const [a, m, d] = String(iso).split('-').map(Number);
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(Date.UTC(a, m - 1, d)));
}

/** ISO completo -> '14/12/2026', no horário de Brasília. */
function dataCurta(isoCompleto) {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo',
  }).format(new Date(isoCompleto));
}

/** ('08:00', 90) -> '09:30' */
function horarioFim(horario, duracaoMin) {
  const [h, m] = String(horario).split(':').map(Number);
  const total = h * 60 + m + Number(duracaoMin || 0);
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

const faixa = (aula) => `${aula.horario} às ${horarioFim(aula.horario, aula.duracaoMin || 90)}`;
const tipoAula = (aula) => (aula.tipo === 'individual' ? 'Aula particular' : 'Aula em grupo');

/* ---------- moldura comum ---------- */

/**
 * Monta o e-mail com cabeçalho, corpo, botão e rodapé.
 * `blocos` é uma lista de strings HTML já escapadas (use `p()` e `tabela()`).
 */
function moldura({ titulo, blocos, botao = null }) {
  const botaoHtml = botao
    ? `<p style="margin:28px 0 8px">
         <a href="${escapar(botao.url)}" style="background:${LARANJA};color:#fff;text-decoration:none;font-weight:bold;padding:12px 24px;border-radius:6px;display:inline-block">${escapar(botao.texto)}</a>
       </p>`
    : '';

  return `<!doctype html>
<html lang="pt-BR">
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,Helvetica,sans-serif;color:#333">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:8px;overflow:hidden">
        <tr><td style="background:${LARANJA};padding:20px 24px;color:#fff;font-size:20px;font-weight:bold">${escapar(ESCOLA.nome)}</td></tr>
        <tr><td style="padding:24px;font-size:15px;line-height:1.55">
          <h1 style="font-size:20px;margin:0 0 16px;color:#111">${escapar(titulo)}</h1>
          ${blocos.join('\n')}
          ${botaoHtml}
        </td></tr>
        <tr><td style="padding:16px 24px;background:#fdf8f2;font-size:12px;color:#888;line-height:1.5">
          ${escapar(ESCOLA.nome)} · WhatsApp ${escapar(ESCOLA.whatsapp)}<br>
          ${escapar(ESCOLA.endereco)}<br>
          Este é um e-mail automático sobre a sua conta na escola.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

const p = (html) => `<p style="margin:0 0 12px">${html}</p>`;

/** Tabela de detalhes: [['Data', 'sábado...'], ...]. Valores são escapados aqui. */
function tabela(linhas) {
  const tr = linhas
    .filter(([, valor]) => valor)
    .map(([rotulo, valor]) => `<tr>
        <td style="padding:6px 12px 6px 0;color:#888;white-space:nowrap;vertical-align:top">${escapar(rotulo)}</td>
        <td style="padding:6px 0;font-weight:bold;color:#111">${escapar(valor)}</td>
      </tr>`)
    .join('');
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 16px;border-top:1px solid #eee;border-bottom:1px solid #eee;width:100%">${tr}</table>`;
}

/** Versão texto da mesma tabela. */
const tabelaTexto = (linhas) => linhas.filter(([, v]) => v).map(([r, v]) => `${r}: ${v}`).join('\n');

const linhasAula = (aula) => [
  ['Data', dataExtenso(aula.data)],
  ['Horário', faixa(aula)],
  ['Tipo', tipoAula(aula)],
  ['Professor', aula.professorNome],
  ['Local', aula.localNome],
];

/* ---------- alunos ---------- */

function boasVindas({ aluno }) {
  const url = `${SITE_URL()}/agendar.html`;
  const nome = primeiroNome(aluno.nome);
  return {
    assunto: `Boas-vindas à ${ESCOLA.nome}, ${nome}!`,
    html: moldura({
      titulo: `Que bom ter você com a gente, ${nome}!`,
      blocos: [
        p('Sua conta na Barra Floripa está criada. Pelo site você compra seus créditos, escolhe dia, horário e professor, e acompanha suas aulas.'),
        p('<strong>Como marcar a primeira aula:</strong>'),
        `<ol style="margin:0 0 12px;padding-left:20px">
          <li>Escolha um plano em <em>Comprar Plano</em> (a aula avulsa é ótima para começar);</li>
          <li>Em <em>Agendar Aula</em>, toque no dia e no horário que preferir;</li>
          <li>Pronto: você recebe a confirmação por e-mail.</li>
        </ol>`,
        p('As turmas têm no máximo 5 alunos por professor, para cada um ter atenção de verdade dentro da água.'),
      ],
      botao: { texto: 'Marcar minha primeira aula', url },
    }),
    texto: `Olá, ${nome}!\n\nSua conta na ${ESCOLA.nome} está criada.\n\n`
      + 'Para marcar a primeira aula: escolha um plano em "Comprar Plano" e depois o dia e horário em "Agendar Aula".\n\n'
      + `Marcar agora: ${url}\n\nDúvidas? WhatsApp ${ESCOLA.whatsapp}`,
  };
}

function creditosAdicionados({ aluno, lancamento }) {
  const url = `${SITE_URL()}/agendar.html`;
  const nome = primeiroNome(aluno.nome);
  const qtd = Number(lancamento.delta);
  const ehCompra = lancamento.motivo === 'compra';

  const linhas = [
    ['Créditos', plural(qtd, 'crédito', 'créditos')],
    ['Plano', ehCompra ? lancamento.nomePacote : null],
    ['Tipo', lancamento.tipoPacote === 'individual' ? 'Aula particular' : 'Aula em grupo'],
    ['Usar até', lancamento.expiraEm ? dataCurta(lancamento.expiraEm) : 'Sem prazo'],
    ['Dias permitidos', lancamento.apenasFimDeSemana ? 'Somente sábado e domingo' : null],
    ['Motivo', ehCompra ? null : lancamento.observacao],
  ];

  const abertura = ehCompra
    ? `Recebemos o seu pagamento. ${plural(qtd, 'crédito foi adicionado', 'créditos foram adicionados')} à sua conta.`
    : `A escola adicionou ${plural(qtd, 'crédito', 'créditos')} à sua conta.`;

  return {
    assunto: ehCompra
      ? `Pagamento confirmado: ${plural(qtd, 'crédito', 'créditos')} na sua conta`
      : `Você ganhou ${plural(qtd, 'crédito', 'créditos')} na Barra Floripa`,
    html: moldura({
      titulo: ehCompra ? 'Pagamento confirmado' : 'Créditos adicionados',
      blocos: [
        p(`Olá, ${escapar(nome)}! ${escapar(abertura)}`),
        tabela(linhas),
        p('Cada crédito vale uma aula. Agende quando quiser, dentro do prazo.'),
      ],
      botao: { texto: 'Agendar uma aula', url },
    }),
    texto: `Olá, ${nome}! ${abertura}\n\n${tabelaTexto(linhas)}\n\nAgendar: ${url}`,
  };
}

function agendamentoConfirmado({ aluno, aula, horasCancelamento }) {
  const url = `${SITE_URL()}/dashboard.html`;
  const nome = primeiroNome(aluno.nome);
  const linhas = linhasAula(aula);
  const prazo = `Precisa desmarcar? Pelo site, até ${horasCancelamento}h antes da aula, e o crédito volta na hora. Depois disso, fale com a escola pelo WhatsApp ${ESCOLA.whatsapp}.`;

  return {
    assunto: `Aula confirmada: ${dataExtenso(aula.data)}, ${aula.horario}`,
    html: moldura({
      titulo: 'Sua aula está confirmada',
      blocos: [
        p(`Olá, ${escapar(nome)}! Está tudo certo com a sua aula:`),
        tabela(linhas),
        p(`<span style="color:#888;font-size:13px">${escapar(prazo)}</span>`),
      ],
      botao: { texto: 'Ver minhas aulas', url },
    }),
    texto: `Olá, ${nome}! Sua aula está confirmada.\n\n${tabelaTexto(linhas)}\n\n${prazo}\n\nMinhas aulas: ${url}`,
  };
}

function aulaCanceladaAluno({ aluno, aula }) {
  const url = `${SITE_URL()}/agendar.html`;
  const nome = primeiroNome(aluno.nome);
  const peloAluno = aula.canceladoPorPapel === 'aluno';
  const linhas = [
    ...linhasAula(aula),
    ['Cancelada por', peloAluno ? 'Você' : (aula.canceladoPorNome || 'Escola')],
    ['Motivo', aula.motivoCancelamento],
  ];
  const abertura = peloAluno
    ? 'O cancelamento da sua aula foi registrado.'
    : `${aula.canceladoPorNome || 'A escola'} precisou cancelar a sua aula.`;

  return {
    assunto: `Aula cancelada: ${dataExtenso(aula.data)}, ${aula.horario}`,
    html: moldura({
      titulo: 'Aula cancelada',
      blocos: [
        p(`Olá, ${escapar(nome)}! ${escapar(abertura)}`),
        tabela(linhas),
        p('<strong>O crédito já voltou para a sua conta</strong>, com o mesmo prazo de antes. É só escolher outro horário.'),
      ],
      botao: { texto: 'Remarcar aula', url },
    }),
    texto: `Olá, ${nome}! ${abertura}\n\n${tabelaTexto(linhas)}\n\nO crédito já voltou para a sua conta. Remarcar: ${url}`,
  };
}

function novaMensagem({ aluno, mensagem, turma }) {
  const url = `${SITE_URL()}/mensagens.html`;
  const nome = primeiroNome(aluno.nome);
  const remetente = mensagem.remetenteNome || 'A equipe';
  const contexto = turma ? `Sobre a aula de ${dataExtenso(turma.data)}, ${turma.horario}` : null;

  // Quebras de linha do recado viram <br>, depois de escapar o texto.
  const textoHtml = escapar(mensagem.texto).replace(/\n/g, '<br>');

  return {
    assunto: `Mensagem de ${remetente} (Barra Floripa)`,
    html: moldura({
      titulo: `${remetente} enviou uma mensagem`,
      blocos: [
        p(`Olá, ${escapar(nome)}!`),
        contexto ? p(`<span style="color:#888">${escapar(contexto)}</span>`) : '',
        `<div style="border-left:4px solid ${LARANJA};background:#fff3e9;padding:12px 16px;margin:0 0 16px">${textoHtml}</div>`,
      ],
      botao: { texto: 'Ver no site', url },
    }),
    texto: `Olá, ${nome}!\n\n${remetente} enviou uma mensagem${contexto ? ` (${contexto})` : ''}:\n\n${mensagem.texto}\n\nVer no site: ${url}`,
  };
}

/* ---------- professores ---------- */

function professorNovoAluno({ professor, aula, totalNaTurma }) {
  const url = `${SITE_URL()}/professor.html`;
  const nome = primeiroNome(professor.nome);
  const linhas = [
    ['Aluno', aula.alunoNome],
    ['Data', dataExtenso(aula.data)],
    ['Horário', faixa(aula)],
    ['Tipo', tipoAula(aula)],
    ['Local', aula.localNome],
    ['Alunos na turma', String(totalNaTurma)],
  ];

  return {
    assunto: `Novo aluno: ${aula.alunoNome} — ${dataExtenso(aula.data)}, ${aula.horario}`,
    html: moldura({
      titulo: 'Novo agendamento na sua turma',
      blocos: [p(`Olá, ${escapar(nome)}! Um aluno acabou de marcar aula com você:`), tabela(linhas)],
      botao: { texto: 'Ver minhas turmas', url },
    }),
    texto: `Olá, ${nome}! Novo agendamento na sua turma:\n\n${tabelaTexto(linhas)}\n\nMinhas turmas: ${url}`,
  };
}

function professorCancelamento({ professor, aula, totalNaTurma }) {
  const url = `${SITE_URL()}/professor.html`;
  const nome = primeiroNome(professor.nome);
  const linhas = [
    ['Aluno', aula.alunoNome],
    ['Data', dataExtenso(aula.data)],
    ['Horário', faixa(aula)],
    ['Tipo', tipoAula(aula)],
    ['Motivo', aula.motivoCancelamento],
    ['Alunos que continuam', String(totalNaTurma)],
  ];

  return {
    assunto: `Cancelamento: ${aula.alunoNome} — ${dataExtenso(aula.data)}, ${aula.horario}`,
    html: moldura({
      titulo: 'Um aluno cancelou a aula',
      blocos: [p(`Olá, ${escapar(nome)}! Este aluno desmarcou a aula com você:`), tabela(linhas)],
      botao: { texto: 'Ver minhas turmas', url },
    }),
    texto: `Olá, ${nome}! Um aluno cancelou a aula:\n\n${tabelaTexto(linhas)}\n\nMinhas turmas: ${url}`,
  };
}

module.exports = {
  boasVindas,
  creditosAdicionados,
  agendamentoConfirmado,
  aulaCanceladaAluno,
  novaMensagem,
  professorNovoAluno,
  professorCancelamento,
};
