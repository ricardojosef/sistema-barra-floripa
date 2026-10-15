# Barra Floripa — Sistema de Reserva de Aulas

Sistema web completo de agendamento para a escola de surf Barra Floripa
(Praia da Barra da Lagoa, Florianópolis). Alunos compram pacotes e agendam
aulas; professores acompanham a lotação das turmas; a administração
configura preços, professores, locais e avisos.

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
| `igor@barrafloripa.com.br` | Professor |
| `jorge@barrafloripa.com.br` | Professor |

A tela de login traz botões que preenchem essas contas automaticamente.

---

## O que o sistema faz

**Aluno**
- Compra pacotes com PIX (QR Code + copia e cola), cartão, Mercado Pago ou PayPal
- Agenda aulas em calendário que mostra as vagas de cada turma em tempo real
- Cancela aulas e recebe o crédito de volta na hora
- Acompanha saldo, extrato de créditos e histórico

**Professor**
- Vê as turmas do dia com a lotação de cada horário
- Recebe destaque visual quando a turma atinge o limite de 5 alunos
- Cancela a aula de um aluno ou a turma inteira, com motivo

**Administrador** (Laudinei)
- Tudo do professor, para os três professores
- Edita nomes dos professores, preços, locais e grade de horários
- Publica avisos que aparecem como pop-up no painel dos alunos

---

## Regras de negócio

| Item | Valor |
|---|---|
| Aula em grupo avulsa | R$ 130,00 |
| Pacote 4 aulas | R$ 480,00 |
| Pacote 9 aulas | R$ 990,00 |
| Pacote 12 aulas | R$ 1.300,00 |
| Aula individual | R$ 230,00 |
| Mensalista 1x/semana | R$ 350,00/mês |
| Mensalista 2x/semana | R$ 610,00/mês (Mais Popular) |

- **Máximo de 5 alunos** por professor em cada horário
- Horários: **08:00, 10:00, 14:00, 16:00** — aulas de **1h30**
- Três professores: **Laudinei Neves** (admin), **Igor** e **Jorge**
- Aluno cancela pelo site até **12h antes**; a equipe cancela a qualquer momento
- Todo cancelamento **devolve o crédito**

Preços, horários, capacidade e nomes são editáveis pelo painel administrativo
e propagam imediatamente para todas as telas.

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
> [guia](docs/GUIA.md#6-ligando-os-pagamentos-reais) explica por quê e como
> mover a emissão de crédito para um backend.

---

## Documentação

**[docs/GUIA.md](docs/GUIA.md)** — guia completo:

- Como o sistema funciona por dentro
- Roteiro de teste passo a passo (8 cenários)
- Firebase: criar projeto, ativar login, cadastrar a equipe, regras de segurança
- Pagamentos: PIX, Mercado Pago, PayPal e cartão em produção
- Publicação e perguntas frequentes

---

## Estrutura

```
*.html               9 telas (landing, login, painéis, agendamento, checkout)
css/                 base, componentes, layout e estilos por página
js/
  config.js          ⚙️ configuração central
  store.js           camada de dados (local ou Firebase)
  auth.js            login, sessão e proteção de rotas
  agenda.js          vagas, agendamento e cancelamento
  creditos.js        saldo e extrato
  pagamentos.js      PIX, cartão e gateways
  precos.js          preços e configuração efetivos
  avisos.js          pop-ups para alunos
  ui.js              utilitários de interface
  pages/             um controlador por tela
firestore.rules      regras de segurança do Firestore
docs/GUIA.md         guia de implementação
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
