# Barra Floripa — Sistema de Reserva de Aulas

Sistema web completo de agendamento para a escola de surf Barra Floripa
(Praia da Barra da Lagoa, Florianópolis). O visitante escolhe plano e aula,
cria a conta no caminho e paga — como num site de passagens. Professores
controlam turmas, presença e saldo; a administração configura preços,
cupons, professores, avisos e analisa justificativas. Site em português,
inglês e espanhol.

HTML5 + CSS + JavaScript puro. Sem framework, sem build, sem `npm install`.

---

## Rodando em 30 segundos

O projeto precisa ser servido por HTTP (módulos ES não carregam via
`file://`). A partir da pasta do projeto:

```bash
npx serve .
```

Abra o endereço que aparecer. Os dados de demonstração são criados sozinhos
no primeiro acesso.

**Contas de teste** — senha `barra123` para todas:

| E-mail | Perfil |
|---|---|
| `aluno@teste.com` | Aluno (com créditos e aulas marcadas) |
| `laudinei@barrafloripa.com.br` | Administrador |
| `pedro@barrafloripa.com.br` | Professor |
| `igor@barrafloripa.com.br` | Professor |
| `gabrieli@barrafloripa.com.br` | Professor |

A tela de login traz botões que preenchem essas contas automaticamente.

---

## O que o sistema faz

**Visitante / aluno**
- **Reserva sem login** (`reservar.html`): plano → dia e horário → cadastro
  (CPF ou passaporte, nacionalidade, idioma) → questionário de saúde → pagamento
- Não escolhe professor: vê horário, praia e vagas
- Paga pelo Mercado Pago (PIX, cartão, boleto) ou PayPal, com **cupom de desconto**
- Questionário PAR-Q + termo de responsabilidade assinados no site (renovados a cada 6 meses, PDF)
- Cancela até 12h antes; depois disso envia **justificativa com atestado**
- Botão do **grupo de WhatsApp** dos alunos, avisos de "sem aulas" com pedido para reagendar
- Tutorial guiado no primeiro acesso, extrato de créditos e histórico

**Professor**
- Turmas do dia com documento, idioma e alerta de saúde de cada aluno
- **Baixa de presença pelo CPF** e registro de falta
- **Saldo a receber** pelas aulas dadas e pagamentos já recebidos
- **Hall de declarações de saúde** com download em PDF
- Cancela a aula de um aluno ou a turma inteira, com motivo

**Administrador** (Laudinei)
- Tudo do professor, para todos os professores
- **Atribui/troca o professor** de cada aula (invisível para o aluno)
- Adiciona e retira professores; define a remuneração de cada um
- Cupons, justificativas (aprovar devolve o crédito), preços, locais, horários
- Avisos com **data sem aula**: cancela as aulas, devolve créditos e avisa os alunos

---

## Regras de negócio

### Aula em grupo

| Item | Valor | Validade | Por aula |
|---|---|---|---|
| 1 aula | R$ 150,00 | sem prazo | R$ 150,00 |
| Pacote 4 aulas | R$ 480,00 | 1 mês | R$ 120,00 |
| Pacote 9 aulas | R$ 990,00 | 40 dias | R$ 110,00 |
| Pacote 12 aulas | R$ 1.300,00 | 2 meses | R$ 108,33 |

### Aula particular

| Item | Valor |
|---|---|
| Aula particular | R$ 250,00 |

### Planos mensais — **somente sábado e domingo**

| Item | Valor | Aulas/mês |
|---|---|---|
| 1x por semana | R$ 400,00/mês | 4 |
| 2x por semana | R$ 720,00/mês (Mais Popular) | 8 |

### Demais regras

- **Máximo de 5 alunos** por professor em cada horário
- Horários: **08:00, 10:00, 14:00, 16:00**, todos os dias — aulas de **1h30**
- Professores: **Laudinei Neves** (admin), **Pedro**, **Igor** e **Gabrieli** —
  o quadro é gerenciado pelo painel administrativo
- O **professor é atribuído pela escola**; o aluno escolhe só horário e praia
- Aluno cancela pelo site até **12h antes**; depois o site bloqueia, e falta
  sem justificativa aprovada faz perder o crédito. A equipe cancela a qualquer momento
- Para comprar e agendar: **CPF/passaporte** e **questionário de saúde** vigente (6 meses)
- Todo cancelamento **devolve o crédito**, mantendo a validade e as restrições
  do pacote de origem
- **Créditos vencidos saem do saldo** e não permitem agendar
- Créditos de **plano mensal só valem para sábado e domingo**: o calendário
  desabilita os demais dias para quem só tem esse tipo de crédito

Preços, validade, horários, capacidade e nomes são editáveis pelo painel
administrativo e propagam imediatamente para todas as telas.

---

## Modos de operação

Tudo se configura em [`js/config.js`](js/config.js):

```javascript
MODO_DADOS: 'local',      // 'local' (navegador) ou 'firebase' (nuvem)
MODO_PAGAMENTO: 'mock',   // 'mock' (simulado) ou 'real' (gateways)
```

O modo `local` guarda os dados no navegador e já vem populado — serve para
testar o sistema inteiro sem instalar nada. O modo `firebase` liga login real
(incluindo Google) e banco compartilhado.

As telas não sabem qual modo está ativo: todas falam com `js/store.js`, que
escolhe o driver. Por isso migrar para produção não exige reescrever telas.

> ⚠️ No modo `mock`, **o navegador confirma o pagamento e emite os créditos**.
> Isso é adequado para demonstração e inseguro em produção. O
> [guia de pagamentos](docs/PAGAMENTOS.md) explica o servidor que credita em produção.

---

## Documentação

- **[docs/GUIA.md](docs/GUIA.md)** — estado atual (checklist) e o que falta, em ordem
- **[docs/PAGAMENTOS.md](docs/PAGAMENTOS.md)** — Mercado Pago em produção, passo a passo
- **[docs/NOTIFICACOES.md](docs/NOTIFICACOES.md)** — e-mail e WhatsApp: opções gratuitas e implementação
- **[docs/ALTERACOES-V2.md](docs/ALTERACOES-V2.md)** — o que mudou, modelo de dados e decisões a validar

---

## Estrutura

```
*.html               12 telas (landing, reserva, termos, login, painéis, agendamento, checkout, saúde)
css/                 base, componentes, layout e estilos por página
js/
  config.js          ⚙️ configuração central
  store.js           camada de dados (local ou Firebase)
  auth.js            login, sessão e proteção de rotas
  agenda.js          vagas, agendamento e cancelamento
  creditos.js        saldo e extrato
  pagamentos.js      PIX, cartão e gateways
  precos.js          preços e configuração efetivos
  avisos.js          pop-ups e datas sem aula
  reserva.js         fluxo de reserva sem login
  saude.js           PAR-Q, termo e PDF
  cupons.js · justificativas.js · financeiro.js
  i18n.js            idiomas (PT/EN/ES)
  ui.js              utilitários de interface
  pages/             um controlador por tela
functions/           servidor (Cloud Functions): pagamentos, e-mails e WhatsApp (opcional)
firestore.rules      regras de segurança do Firestore
docs/                guias (GUIA, PAGAMENTOS, NOTIFICACOES, ALTERACOES-V2)
```

---

## Decisões de projeto

**Saldo de créditos é sempre calculado, nunca armazenado.** Cada compra,
agendamento ou cancelamento gera um lançamento com um `delta`; o saldo é a
soma deles. Saldo e histórico não podem divergir, e todo crédito é auditável.

**Capacidade verificada dentro de transação.** A contagem de alunos no
horário e a gravação do agendamento acontecem atomicamente — dois alunos
clicando ao mesmo tempo na última vaga não criam uma turma de 6.

**Operações idempotentes.** Confirmar o mesmo pagamento duas vezes credita
uma vez só; cancelar duas vezes devolve um crédito só.

**Preços vêm de uma fonte única.** Nenhuma tela tem preço fixo no HTML; todas
leem de `precos.js`, então o que o admin edita aparece em todo lugar.
