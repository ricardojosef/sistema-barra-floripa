# Guia de Implementação — Sistema Barra Floripa

Este guia explica como o sistema funciona, como testá-lo, e como ligar o
login e os pagamentos de verdade quando a escola quiser sair do modo de
demonstração.

---

## Índice

1. [Como rodar agora](#1-como-rodar-agora)
2. [Contas de teste](#2-contas-de-teste)
3. [Como o sistema funciona](#3-como-o-sistema-funciona)
4. [Roteiro de teste completo](#4-roteiro-de-teste-completo)
5. [Ligando o Firebase (login real e banco de dados)](#5-ligando-o-firebase)
6. [Ligando os pagamentos reais](#6-ligando-os-pagamentos-reais)
7. [Ligando os e-mails automáticos](#7-ligando-os-e-mails-automáticos)
8. [Publicando o site](#8-publicando-o-site)
9. [Perguntas frequentes](#9-perguntas-frequentes)

---

## 1. Como rodar agora

O sistema funciona **sem instalar nada**, mas precisa ser servido por HTTP —
abrir o arquivo com duplo clique (`file://`) não funciona, porque o navegador
bloqueia módulos JavaScript carregados assim.

Escolha **uma** das opções abaixo, sempre a partir da pasta do projeto:

```bash
# Opção A — Node.js (você já tem)
npx serve .

# Opção B — Python 3
python -m http.server 8000

# Opção C — extensão "Live Server" do VS Code
# Clique com o botão direito em index.html > "Open with Live Server"
```

Depois abra o endereço que o comando mostrar (normalmente
`http://localhost:8000` ou `http://localhost:3000`).

> **Por que preciso de um servidor?**
> O projeto usa módulos ES (`import`/`export`), que o navegador só carrega por
> HTTP. É uma exigência de segurança do próprio navegador, não do sistema.

Na primeira vez que a página abre, o sistema cria automaticamente os dados de
demonstração: 3 professores, 8 alunos, aulas já agendadas nas próximas duas
semanas, o catálogo de preços e um aviso de exemplo.

---

## 2. Contas de teste

Todas as contas usam a senha **`barra123`**.

### Equipe

| E-mail | Nome | Papel | O que pode fazer |
|---|---|---|---|
| `laudinei@barrafloripa.com.br` | Laudinei Neves | **Administrador** | Tudo: turmas de todos os professores, painel de administração e gestão da equipe |
| `pedro@barrafloripa.com.br` | Pedro | Professor | Ver e cancelar as próprias turmas |
| `igor@barrafloripa.com.br` | Igor | Professor | Ver e cancelar as próprias turmas |
| `gabrieli@barrafloripa.com.br` | Gabrieli | Professor | Ver e cancelar as próprias turmas |

### Alunos

| E-mail | Nome | Situação inicial |
|---|---|---|
| `aluno@teste.com` | Ricardo Alves | Pacote de 4 aulas + 1 aula particular, com aulas agendadas |
| `giovanna@teste.com` | Giovanna Zambrini | Pacote de 9 aulas |
| `ana@teste.com` | Ana Gabriela Ferreira | Pacote de 4 aulas |
| `andre@teste.com` | André Pagorare | Pacote de 9 aulas |
| **`camila@teste.com`** | **Camila Rocha** | **Mensalista 2x/semana — créditos válidos só no fim de semana** |
| `marina@teste.com`, `bruno@teste.com`, `diego@teste.com` | — | Variados |

Na tela de login, em modo demonstração, aparece um bloco **"Contas de
demonstração"** com botões que preenchem e-mail e senha para você.

Você também pode **criar sua própria conta** pelo botão "Criar conta" — ela
nasce com 0 créditos, como um aluno de verdade.

---

## 3. Como o sistema funciona

### 3.1 As telas

| Arquivo | Para quem | O que faz |
|---|---|---|
| `index.html` | Público | Página de vendas, com preços sempre atualizados |
| `login.html` | Público | Entrar e criar conta (aluno ou equipe) |
| `dashboard.html` | Aluno | Saldo, próximas aulas, avisos |
| `agendar.html` | Aluno | Calendário e escolha de horário |
| `checkout.html` | Aluno | Escolha do plano e pagamento |
| `creditos.html` | Aluno | Extrato de créditos e compras |
| `historico.html` | Aluno | Todas as aulas, com filtros |
| `professor.html` | Professor/Admin | Turmas do dia, lotação, cancelamentos |
| `admin.html` | Admin | Professores, preços, locais, avisos, horários |

### 3.2 A regra dos créditos

Esta é a parte mais importante de entender:

> **O saldo de créditos nunca é um número guardado.** Ele é sempre a **soma de
> todos os lançamentos** do aluno.

Cada evento gera um lançamento na coleção `creditos`:

| Evento | Lançamento |
|---|---|
| Pagou um pacote de 4 aulas | `+4` |
| Agendou uma aula | `−1` |
| Cancelou uma aula | `+1` |
| Ajuste manual da escola | `±N` |

**Por que assim?** Se o saldo fosse um campo separado, uma falha no meio de
uma operação poderia deixar o saldo dizendo "3" enquanto o histórico mostra
outra coisa — e ninguém saberia qual está certo. Somando o extrato, saldo e
histórico são a mesma informação e nunca divergem. Além disso, dá para
auditar cada crédito: de onde veio e para onde foi.

### 3.3 Validade dos pacotes

Os pacotes têm prazo para uso, contado **a partir do pagamento**:

| Pacote | Prazo |
|---|---|
| 4 aulas | 1 mês (30 dias) |
| 9 aulas | 40 dias |
| 12 aulas | 2 meses (60 dias) |
| Planos mensais | 30 dias |
| Aula avulsa e particular | sem prazo |

Por isso os créditos são organizados em **lotes**: cada compra vira um lote
com a própria data de expiração. Quando o aluno agenda, o sistema consome o
lote que **vence primeiro** (FEFO), para ele não perder crédito à toa.

- O vencimento cai às **23:59:59** do último dia, dando o dia inteiro ao aluno.
- Créditos vencidos **saem do saldo** e não permitem agendar.
- O painel avisa quando há crédito vencendo em 7 dias ou menos.

### 3.4 Planos mensais: só sábado e domingo

Os créditos de plano mensalista valem **apenas para sábado e domingo**.

No agendamento, se todos os créditos do aluno forem desse tipo, os dias de
semana aparecem desabilitados no calendário, com a explicação do motivo. Se
ele tiver também créditos sem restrição, pode agendar em qualquer dia — e o
sistema usa primeiro o crédito mais restrito, para não desperdiçar a
flexibilidade do outro.

**Cancelamento preserva as condições.** Ao cancelar, o crédito volta com a
mesma validade e a mesma restrição de dia do lote original. Sem esse cuidado,
cancelar viraria uma forma de transformar um crédito com prazo em um crédito
eterno e irrestrito.

### 3.5 A regra das 5 vagas

Cada professor atende no máximo **5 alunos por horário**. A verificação
acontece dentro de uma *transação*: o sistema conta quantos alunos já estão
no horário e grava o novo agendamento **na mesma operação atômica**. Sem
isso, dois alunos clicando ao mesmo tempo na última vaga poderiam ambos
entrar, criando uma turma de 6.

Testamos exatamente esse cenário: 6 alunos tentando a mesma vaga ao mesmo
tempo resultam em 5 aceitos e 1 recusado.

**Aula individual** ocupa o horário inteiro do professor — ninguém mais entra.

**De onde vem a lotação que o aluno vê.** Por privacidade, um aluno não pode
ler os agendamentos dos colegas (as regras do Firestore bloqueiam). Por isso
existe a coleção `vagas`: um contador por turma (`dia + professor + horário`)
que guarda **só números** — quantos alunos e se virou aula particular. O
contador é atualizado na mesma transação que cria ou cancela a aula, e as
regras conferem que o aluno só soma 1 ao marcar uma aula dele e só tira 1 ao
cancelar uma aula dele.

Se a lotação mostrada ao aluno parecer diferente da lista de alunos que o
professor vê, use **Administração → Horários → Recalcular vagas**, que
reconta tudo a partir das aulas marcadas.

### 3.5.1 O que o aluno vê ao agendar

- No **calendário**, cada dia mostra se tem vaga; passando o mouse aparecem
  os horários e os locais do dia.
- Ao **clicar num dia**, aparece o resumo (horários e locais) e a lista de
  turmas agrupada por horário, **uma linha por professor**, com o local e a
  lotação (`3/5`, `LOTADO`).
- O seletor **Em grupo / Particular** troca a leitura: em particular, só
  aparecem livres os professores que ainda não têm nenhum aluno naquele
  horário.
- O aluno vê os números, **nunca os nomes** dos colegas.

### 3.5.2 Disponibilidade dos professores

Cada professor configura em **Painel → Disponibilidade**:

- em quais horários atende em **cada dia da semana**, e em qual **local**;
- **folgas e bloqueios** em datas específicas (o dia todo ou só alguns
  horários), com um motivo opcional.

O aluno só consegue agendar dentro da disponibilidade. Professor que nunca
salvou a disponibilidade atende todos os horários, todos os dias, no local
padrão — o comportamento de antes.

Desmarcar um horário **não cancela** aulas já marcadas nele: o painel avisa
quantas ficariam de fora, e essas turmas aparecem na aba Turmas com o aviso
"Fora da sua disponibilidade". Se o professor não for dar a aula, cancela por
ali e o crédito volta ao aluno.

O administrador edita a disponibilidade de qualquer professor escolhendo o
nome no filtro do topo.

### 3.5.3 Dados dos alunos e mensagens

- Na aba **Turmas**, clicar no nome de um aluno abre a ficha dele: e-mail,
  telefone (com botão para abrir o **WhatsApp**), aulas realizadas e
  agendadas e saldo de créditos.
- **Mensagem para a turma** (no cartão do horário) ou **Enviar mensagem**
  (na ficha) manda um recado pelo próprio sistema. Ao cancelar uma turma
  inteira, o motivo pode ir como mensagem para os alunos automaticamente.
- O aluno recebe em **Mensagens** (menu lateral e barra inferior no
  celular), com um contador de não lidas. Clicar na mensagem marca como lida.
- A aba **Mensagens** do professor mostra o que foi enviado e quantos alunos
  já leram.
- Só a equipe envia; o aluno lê e não responde pelo sistema (o contato de
  volta é pelo WhatsApp ou e-mail).

### 3.6 Cancelamento e devolução

- O **aluno** cancela pelo site até **12 horas** antes da aula (configurável
  no painel admin). Depois disso, precisa falar com a escola.
- **Professor e administrador** cancelam a qualquer momento — inclusive a
  turma inteira, quando o mar não está bom.
- Em qualquer caso o crédito **volta automaticamente** para o aluno, com a
  mesma validade e as mesmas restrições do pacote original (veja 3.4).
- O cancelamento é **idempotente**: clicar duas vezes não devolve dois
  créditos.

### 3.7 Onde os dados ficam

O sistema tem dois "modos" de armazenamento, escolhidos em `js/config.js`:

```javascript
MODO_DADOS: 'local',   // ou 'firebase'
```

| Modo | Onde os dados ficam | Quando usar |
|---|---|---|
| `'local'` | No navegador (localStorage) | Testes e demonstrações |
| `'firebase'` | Na nuvem (Cloud Firestore) | Produção |

**As telas não sabem qual modo está ativo.** Elas conversam apenas com
`js/store.js`, que repassa para o driver certo. É por isso que ligar o
Firebase não exige reescrever nenhuma tela.

> ⚠️ **Importante sobre o modo local:** os dados ficam **só naquele
> navegador**. Se você testar no Chrome e depois abrir no Firefox, verá os
> dados de demonstração de novo, do zero. Isso é esperado — é uma demonstração,
> não um banco de dados compartilhado.

### 3.8 Gestão da equipe (só o administrador)

Em **Administração → Professores**, o Laudinei — e apenas ele, por ser o
único com papel `admin` — pode:

| Ação | O que acontece |
|---|---|
| **Adicionar professor** | Cria o acesso (e-mail + senha inicial) e põe o professor no fim da grade. |
| **Ativo** desmarcado | Tira o professor da grade *temporariamente* (férias, lesão). Ele continua entrando no sistema. |
| **Retirar** | Encerra o acesso ao sistema, tira da grade e **cancela as aulas futuras**, devolvendo o crédito a cada aluno. Antes de confirmar, o painel mostra quantas aulas serão canceladas. |

Detalhes importantes:

- **Retirar não apaga.** O cadastro fica guardado como "retirado", para o
  histórico continuar mostrando quem deu cada aula. Com Firebase, apagar a
  conta do Authentication só é possível pelo servidor (Admin SDK); pelo
  navegador, o seguro é bloquear o login — e é isso que acontece.
- **Recontratação:** cadastrar de novo um e-mail retirado **reativa** o
  cadastro antigo em vez de duplicar. No modo Firebase a pessoa volta com a
  senha que já tinha (a de outra conta não pode ser trocada pelo navegador).
- O administrador não pode ser retirado, e o painel não cria outro admin.
- No Firebase, a conta nova é criada numa instância separada do app, para o
  Laudinei **não ser deslogado** no meio do cadastro.

### 3.8.2 Créditos dos alunos (só o administrador)

Em **Administração → Alunos** fica a lista de alunos com o saldo de cada
um. A busca filtra por nome ou e-mail. Em **Gerenciar**, o painel mostra:

- o **saldo disponível**;
- os **créditos em aberto**, separados por origem, com tipo (grupo ou
  particular), vencimento e restrição de fim de semana;
- as **últimas 10 movimentações**, com o motivo de cada ajuste.

Abaixo vem o formulário **Ajustar créditos**:

| Campo | Para que serve |
|---|---|
| **Operação** | *Adicionar* (cortesia, reposição, compra paga por fora do site) ou *Retirar* (reembolso, crédito lançado por engano). |
| **Quantidade** | De 1 a 50. |
| **Tipo de aula**, **Prazo** e **Só sábado e domingo** | Só aparecem ao adicionar. O crédito novo segue as mesmas regras de um pacote: prazo vazio significa que não vence. |
| **Motivo** | Obrigatório. Aparece no extrato do aluno, por exemplo "Reembolso MP-123456" ou "Cortesia: aula cancelada pelo mar". |

Regras que o painel garante:

- **Nada é apagado.** O ajuste vira um lançamento novo, com `motivo: 'ajuste'`,
  o texto em `observacao` e quem fez em `criadoPor`. Para desfazer, lance o
  ajuste contrário.
- **Não dá para retirar mais do que o aluno tem.** Um débito maior que o
  saldo ficaria pendurado e consumiria a próxima compra dele.
- **Ao retirar, saem primeiro os créditos que vencem antes**, a mesma ordem
  usada quando o aluno agenda.
- **No Firebase, só o administrador lança ajustes.** As regras recusam um
  ajuste vindo de professor ou aluno.

### 3.8.1 Meu perfil

Todo usuário (aluno, professor e administrador) tem a tela **Meu perfil**
(menu lateral, ou tocando na foto no topo):

- **Pode alterar:** telefone (com máscara e validação de DDD) e foto.
- **Não pode alterar:** nome e e-mail. Eles identificam a conta no login,
  nos recibos e nas listas de turma; para corrigir, o aluno fala com a
  escola (o link já abre o WhatsApp com a mensagem pronta).
- A foto é recortada em quadrado e reduzida no próprio navegador (320 px,
  JPEG) e fica guardada no perfil — não precisa de Firebase Storage.
- A foto aparece no topo, na lista de alunos da turma e na ficha que o
  professor abre.
- A trava também está nas regras do Firestore: mesmo editando o
  JavaScript, o usuário só consegue mudar telefone e foto do próprio perfil.

### 3.9 Tutorial de primeiro acesso

Todo aluno, no primeiro login, vê um tour guiado em duas partes:

1. **Painel** (9 passos): créditos, saldo no topo, onde comprar, onde
   agendar, próximas aulas, créditos por pacote e menu. No fim, o aluno
   escolhe se quer ver o agendamento na prática.
2. **Agendamento** (6 passos): tipo de aula, calendário (e o que significa
   cada cor), horários com lotação, custo em créditos e o botão de confirmar.
   Para mostrar esse botão o tour seleciona um horário de exemplo — **nada é
   agendado**, e a seleção é desfeita no fim.

Como funciona:

- Fica marcado no perfil do aluno (`tutorialConcluido`), então não reaparece
  — nem em outro dispositivo. **Pular** também conta como visto.
- Pode ser revisto a qualquer momento em **Como agendar**: no menu lateral
  (computador) ou tocando na foto do perfil, no topo (celular).
- Navegação por teclado: <kbd>→</kbd> avança, <kbd>←</kbd> volta e
  <kbd>Esc</kbd> encerra.
- Professores e administrador não veem o tour de aluno.

---

## 4. Roteiro de teste completo

Siga na ordem. Cada passo verifica uma regra de negócio diferente.

### Teste 1 — Cadastro e primeira compra

1. Abra o site e clique em **"Agendar Aula"**.
2. Vá em **"Criar conta"**, preencha seus dados e confirme.
   - ✅ Você cai no painel e o **tutorial guiado** começa sozinho. Avance
     com **Próximo** (ou <kbd>→</kbd>): cada passo destaca uma parte do painel.
   - ✅ No último passo, **Ver o agendamento** leva à tela de agendamento e
     o tour continua lá, mostrando calendário, horários e o botão de
     confirmar — sem agendar nada.
   - ✅ Ao terminar, o painel mostra **0 créditos** e um aviso de saldo vazio.
   - ✅ Recarregue a página: o tutorial **não** aparece de novo. Para revê-lo,
     use **Como agendar** no menu.
3. Clique em **"Comprar Plano"** e escolha o **Pacote 4 Aulas (R$ 480)**.
   - ✅ O card mostra **R$ 120,00 por aula**, o selo **"Economize R$ 120 · 20%"**
     e a condição **"Válido por 1 mês"**.
4. Deixe em **PIX**. Um QR Code aparece, junto com o código copia e cola.
   - ✅ O código começa com `00020126...` — é um BR Code válido de verdade.
   - ✅ O resumo traz **Prazo para usar: 1 mês** e a economia em destaque.
5. Clique em **"Já fiz o PIX"** e aguarde a confirmação.
   - ✅ Tela de sucesso, **saldo agora é 4**.

### Teste 2 — Agendamento

6. Clique em **"Agendar minha aula"**.
7. Escolha um dia no calendário e um horário com vaga.
   - ✅ Cada horário mostra a lotação: `2/5`, `4/5`, etc.
8. Confirme o agendamento.
   - ✅ Volta ao painel, **saldo caiu para 3**, a aula aparece em "Próximas Aulas".

### Teste 3 — Turma lotada (a regra dos 5)

9. Ainda em "Agendar Aula", navegue até **amanhã**.
10. Procure o horário **08:00 do Prof. Igor**.
    - ✅ Aparece **LOTADO**, com `5/5`, e o botão não é clicável.
    - Este é um dado de demonstração criado justamente para você ver a regra.

### Teste 4 — Cancelamento e devolução

11. No painel, clique em **"Cancelar"** em uma das suas aulas.
    - ✅ Aviso de confirmação, depois: **crédito devolvido** (saldo sobe 1).
12. Vá em **"Meus Créditos"** e veja o extrato.
    - ✅ Há três linhas: `+4` (compra), `−1` (agendamento), `+1` (cancelamento).
    - ✅ O cartão do pacote mostra a data de validade.

### Teste 5 — Plano mensal só no fim de semana

Entre com `camila@teste.com` / `barra123` — ela é mensalista no seed.

13. Vá em **"Agendar Aula"**.
    - ✅ Um aviso explica que o plano vale **apenas sábado e domingo**.
    - ✅ No calendário, os dias de semana aparecem **desabilitados**; só
      sábados e domingos ficam clicáveis.
14. Passe o mouse sobre uma segunda-feira.
    - ✅ A dica diz "Seu plano é válido apenas aos sábados e domingos".
15. Agende num sábado ou domingo.
    - ✅ Funciona normalmente e debita 1 crédito.

> Para ver o bloqueio pelo lado do servidor (e não só da interface), tente
> agendar num dia útil pelo console. O sistema recusa com a mensagem do
> plano mensalista — a validação não depende do calendário.

### Teste 6 — Crédito vencido

Este caso é mais fácil de simular pelo console do navegador (F12), já que
exige um crédito com data passada:

```javascript
// Cria um crédito que venceu ontem, para o aluno logado
const { criar } = await import('./js/store.js');
const ontem = new Date(); ontem.setDate(ontem.getDate() - 1);
await criar('creditos', {
  alunoId: 'COLE_AQUI_O_ID_DO_ALUNO',
  delta: 5, motivo: 'compra', nomePacote: 'Pacote vencido',
  expiraEm: ontem.toISOString(), criadoEm: new Date().toISOString(),
});
```

16. Recarregue o painel.
    - ✅ O saldo **não** aumentou em 5 — créditos vencidos não contam.
    - ✅ Tentar agendar com apenas créditos vencidos devolve "Você não tem
      créditos disponíveis".

### Teste 7 — Painel do professor

13. Saia e entre com `igor@barrafloripa.com.br` / `barra123`.
    - ✅ Você vê **apenas as turmas do Igor**, não as dos outros.
14. Navegue até amanhã na faixa de dias.
    - ✅ A turma das 08:00 está marcada como **LOTADA 5/5**, em vermelho.
15. Clique no **✕** ao lado de um aluno para cancelar a aula dele.
    - ✅ A vaga abre (`4/5`) e o crédito volta para aquele aluno.
16. Teste **"Cancelar turma"** em outro horário — escolha um motivo.
    - ✅ Todos os alunos daquele horário recebem o crédito de volta.
16a. Clique no nome de um aluno da turma lotada.
    - ✅ A ficha mostra e-mail, telefone e o botão do WhatsApp.
16b. Clique em **Mensagem para a turma**, escreva e envie.
    - ✅ Na aba **Mensagens** do painel o envio aparece com "0/5 leram".
    - ✅ Entrando como `aluno@teste.com`, o item **Mensagens** do menu tem um
      contador; ao abrir e clicar na mensagem, o contador some.
16c. Na aba **Disponibilidade**, desmarque o horário das 16:00 em todos os
    dias e salve.
    - ✅ O painel avisa que há aula marcada nesse horário (ela não é cancelada).
    - ✅ No calendário do aluno, o Igor deixa de aparecer às 16:00.
16d. Nos dados de exemplo, o **Pedro** só atende de manhã e o **Laudinei**
    está de folga daqui a 4 dias.
    - ✅ No calendário do aluno, eles não aparecem nesses horários.

### Teste 8 — Painel administrativo

17. Saia e entre com `laudinei@barrafloripa.com.br` / `barra123`.
    - ✅ Você vê as turmas de **todos os professores**, com filtro por nome.
18. Vá em **Administração** (menu lateral).

**Preços:**
19. Aba **💰 Preços** → mude o "Pacote 9 Aulas" de R$ 990 para R$ 950 → Salvar.
20. Abra **checkout.html** em outra aba (ou "Comprar Plano" como aluno).
    - ✅ O novo preço aparece na hora, sem republicar nada.
    - ✅ O selo de economia se recalcula sozinho: com 9 aulas a R$ 950, a
      economia sobe para R$ 400 (9 × R$ 150 = R$ 1.350).

**Professores:**
21. Aba **👤 Professores** → renomeie "Igor" para "Igor Silva" → Salvar.
22. Vá em **Turmas**.
    - ✅ O novo nome aparece em todas as turmas do Igor.

**Equipe (adicionar e retirar):**
- Em **Adicionar professor**, cadastre um nome, um e-mail novo e uma senha.
  - ✅ O professor entra no fim da lista e consegue fazer login com esses dados.
- Tente cadastrar um e-mail que já existe (ex.: `igor@barrafloripa.com.br`).
  - ✅ O painel recusa com "Esse e-mail já pertence a…".
- Clique em **Retirar** ao lado do Pedro.
  - ✅ A confirmação diz quantas aulas futuras serão canceladas.
  - ✅ Depois de confirmar, o Pedro some da lista e da grade de agendamento,
    e quem tinha aula marcada com o Pedro recebe o crédito de volta.
  - ✅ Tentar entrar com `pedro@barrafloripa.com.br` mostra "conta desativada".
- Cadastre de novo `pedro@barrafloripa.com.br`.
  - ✅ O cadastro é **reativado** (não aparece um segundo "Pedro").
- O Laudinei aparece com o selo **Admin** e **sem** botão Retirar.

**Créditos dos alunos:**
- Aba **Alunos** → digite parte do nome de um aluno na busca → **Gerenciar**.
  - ✅ Aparecem o saldo, os créditos em aberto com o vencimento e as últimas
    movimentações.
- **Adicionar créditos**, quantidade `2`, prazo `30`, motivo `Cortesia` →
  **Lançar ajuste** → confirme.
  - ✅ O saldo sobe 2 na lista e no detalhe. Aparece um lote "Crédito da
    escola" vencendo daqui a 30 dias.
- **Retirar créditos** com uma quantidade **maior** que o saldo.
  - ✅ O painel recusa e diz quantos créditos o aluno tem.
- Retire `1` com o motivo `Reembolso teste`.
  - ✅ O saldo cai 1. Entrando como esse aluno, **Meus Créditos** mostra
    "Ajuste da escola" com o motivo embaixo.

**Avisos:**
23. Aba **📢 Avisos** → publique um aviso com título e mensagem.
24. Saia e entre como **aluno**.
    - ✅ O aviso aparece como **pop-up** no painel.
25. Clique em **"Entendi"** e recarregue a página.
    - ✅ O aviso **não volta a aparecer** para você.

**Horários:**
26. Aba **🕗 Horários** → adicione o horário `18:00` → Salvar.
27. Volte a "Agendar Aula" como aluno.
    - ✅ O horário das 18:00 agora aparece na grade.

### Teste 9 — Segurança de acesso

28. Logado como **aluno**, digite na barra de endereço: `admin.html`.
    - ✅ Você é **redirecionado** para o painel de aluno. Sem acesso.
29. Saia da conta e tente abrir `dashboard.html` diretamente.
    - ✅ Você vai para o login, e **depois de entrar volta para o dashboard**.

### Teste 10 — Recomeçar do zero

30. Como admin: **Administração → Horários → "Reiniciar dados de demonstração"**.
    - ✅ Tudo volta ao estado inicial.

---

## 5. Ligando o Firebase

O Firebase dá ao sistema **login de verdade** (incluindo Google) e um banco de
dados **compartilhado entre todos os dispositivos**. O plano gratuito
(*Spark*) é mais que suficiente para uma escola de surf.

### Passo 1 — Criar o projeto

1. Acesse [console.firebase.google.com](https://console.firebase.google.com).
2. **"Adicionar projeto"** → nome: `  ` → continuar. 
3. Pode **desativar** o Google Analytics (não é necessário).

### Passo 2 — Registrar o aplicativo web

1. Na tela inicial do projeto, clique no ícone **`</>`** (Web).
2. Apelido: `Site Barra Floripa` → **Registrar app**.
3. O Firebase mostra um trecho de código com o objeto `firebaseConfig`.
   **Copie os valores.**

### Passo 3 — Colar as credenciais

Abra `js/config.js` e preencha:

```javascript
MODO_DADOS: 'firebase',          // ← mude de 'local' para 'firebase'

firebaseConfig: {
  apiKey: 'AIza...',             // ← cole aqui
  authDomain: 'barra-floripa.firebaseapp.com',
  projectId: 'barra-floripa',
  storageBucket: 'barra-floripa.appspot.com',
  messagingSenderId: '123456789',
  appId: '1:123456789:web:abc123',
},
```

> Estas chaves **podem** ficar visíveis no código do site — elas apenas
> identificam o projeto. Quem protege os dados são as *regras de segurança*
> do passo 6.

### Passo 4 — Ativar o login

1. Menu lateral → **Authentication** → **Começar**.
2. Aba **Sign-in method**:
   - Ative **E-mail/senha**.
   - Ative **Google** (escolha um e-mail de suporte do projeto).
3. Aba **Settings → Domínios autorizados**: adicione o domínio onde o site
   vai rodar (`localhost` já vem liberado).

### Passo 5 — Criar o banco

1. Menu lateral → **Firestore Database** → **Criar banco de dados**.
2. Escolha **Modo de produção** (as regras do passo 6 cuidam do acesso).
3. Local: **`southamerica-east1`** (São Paulo — menor latência no Brasil).

### Passo 6 — Colar as regras de segurança

1. Firestore Database → aba **Regras**.
2. Apague o conteúdo e cole **todo o arquivo `firestore.rules`** do projeto.
3. **Publicar**.

Essas regras garantem, no servidor, que:
- um aluno só lê os próprios dados;
- ninguém consegue se promover a administrador editando o JavaScript;
- cada usuário só altera telefone e foto do próprio perfil;
- só o administrador altera preços, professores e avisos.

> 🔁 **Atualizou o sistema?** Sempre que o arquivo `firestore.rules` mudar,
> cole e publique de novo. A versão com disponibilidade e mensagens
> acrescentou as coleções `vagas`, `disponibilidade` e `mensagens` — sem a
> regra nova, o calendário do aluno não carrega os horários. Depois de
> publicar, entre como administrador e clique uma vez em
> **Administração → Horários → Recalcular vagas**, para contar as aulas que
> já estavam marcadas.

### Passo 7 — Criar as contas da equipe

Só o **administrador (Laudinei)** precisa ser criado à mão no Console. Os
demais professores — Pedro, Igor e Gabrieli — o próprio Laudinei cadastra
depois, pelo painel (**Administração → Professores → Adicionar professor**).

> ⚠️ Para o cadastro pelo painel funcionar, as regras do Passo 6 precisam
> estar **atualizadas**: a versão atual do `firestore.rules` permite que o
> administrador crie perfis de professor. Com as regras antigas, a conta é
> criada no Authentication mas o perfil é recusado — o painel avisa, e basta
> publicar as regras novas e cadastrar o mesmo e-mail de novo.

Para criar o Laudinei:

**a) Criar o usuário:**
1. Authentication → **Users** → **Adicionar usuário**.
2. E-mail e senha → **Adicionar**.
3. **Copie o UID** que aparece na lista (algo como `xY3kP9mN...`).

**b) Criar o perfil no banco:**
1. Firestore Database → **Iniciar coleção** → id: `usuarios`.
2. **ID do documento: cole o UID copiado** (isso é essencial).
3. Adicione os campos:

| Campo | Tipo | Valor |
|---|---|---|
| `nome` | string | `Laudinei Neves` |
| `email` | string | `laudinei@barrafloripa.com.br` |
| `papel` | string | `admin` *(ou `professor`)* |
| `ativo` | boolean | `true` |
| `criadoEm` | string | `2026-01-01T00:00:00.000Z` |

**c) Criar o registro de professor:**
1. Nova coleção `professores`, ID do documento: `prof-laudinei`.
2. Campos: `nome` (string), `usuarioId` (string, o mesmo UID), `ativo`
   (boolean `true`), `ordem` (number `1`).

**d) Cadastrar o restante da equipe pelo painel:** entre como Laudinei e use
**Adicionar professor** para Pedro, Igor e Gabrieli — nome, e-mail e uma
senha inicial. Passe a senha pessoalmente a cada um.

> **Atenção ao campo `papel`:** apenas Laudinei recebe `admin`. Quem é
> cadastrado pelo painel recebe `professor` automaticamente, e as regras
> impedem que o painel crie outro administrador. Um aluno que se cadastrar
> pelo site recebe `aluno`, e também não consegue mudar isso.

#### Já tinha o Firebase configurado com a equipe antiga?

Se o seu projeto foi montado quando a equipe era Laudinei, Igor e Jorge:

1. Publique o `firestore.rules` atualizado (Passo 6).
2. Entre como Laudinei → **Administração → Professores**.
3. Clique em **Retirar** ao lado do Jorge. As aulas futuras do Jorge são
   canceladas e o crédito volta para cada aluno.
4. Use **Adicionar professor** para Pedro e Gabrieli.
5. Ajuste a **Ordem na grade** (Laudinei 1, Pedro 2, Igor 3, Gabrieli 4) e
   clique em **Salvar professores**.

### Passo 8 — Cadastrar preços e configuração

Crie a coleção `pacotes` com um documento para cada plano. Use exatamente
estes IDs, porque o sistema os referencia:

| ID do documento | nome | preco | creditos | tipo | validadeDias | apenasFimDeSemana | destaque |
|---|---|---|---|---|---|---|---|
| `pac-avulsa` | Aula em Grupo Avulsa | 150 | 1 | `avulsa` | *(vazio)* | false | false |
| `pac-4` | Pacote 4 Aulas | 480 | 4 | `pacote` | 30 | false | false |
| `pac-9` | Pacote 9 Aulas | 990 | 9 | `pacote` | 40 | false | false |
| `pac-12` | Pacote 12 Aulas | 1300 | 12 | `pacote` | 60 | false | false |
| `pac-individual` | Aula Particular | 250 | 1 | `individual` | *(vazio)* | false | false |
| `pac-mensal-1x` | Mensalista 1x/semana | 400 | 4 | `mensal` | 30 | **true** | false |
| `pac-mensal-2x` | Mensalista 2x/semana | 720 | 8 | `mensal` | 30 | **true** | **true** |

Todos com `ativo: true` (boolean) e `ordem` (number, de 1 a 7).

- `validadeDias` (number) é o prazo para usar os créditos. Deixe o campo
  ausente — ou `null` — quando o crédito não expira.
- `apenasFimDeSemana` (boolean) restringe o agendamento a sábado e domingo.
- Os planos mensais também precisam de `frequenciaSemanal` (number: 1 ou 2).

E a coleção `config`, documento de ID `app`:

| Campo | Tipo | Valor |
|---|---|---|
| `horarios` | array | `["08:00", "10:00", "14:00", "16:00"]` |
| `capacidadeGrupo` | number | `5` |
| `duracaoMin` | number | `90` |
| `horasMinimasCancelamento` | number | `12` |
| `localPadraoId` | string | `local-barra` |

E `locais`, documento `local-barra`: `nome` = "Praia da Barra da Lagoa",
`ativo` = true.

> Depois disso, o próprio painel administrativo edita tudo pela interface —
> este cadastro manual é só a carga inicial.

### Passo 9 — Testar

Recarregue o site. Crie uma conta nova e confira no Console
(Authentication → Users) que ela apareceu. Entre com o Laudinei e verifique
que o painel administrativo abre.

---

## 6. Ligando os pagamentos reais

> ### ⚠️ Leia isto antes de qualquer coisa
>
> No modo de demonstração, **o próprio navegador confirma o pagamento e emite
> os créditos**. Isso é ótimo para testar e **inaceitável em produção**:
> qualquer pessoa com o console do navegador aberto conseguiria se dar
> créditos de graça.
>
> Em produção, **quem emite crédito tem que ser o seu servidor**, ao receber
> a confirmação (*webhook*) do gateway de pagamento. O navegador nunca decide
> se algo foi pago.

### 6.1 Quem cobra o quê (sem repetir meio de pagamento)

Em produção o site passa a ter **só dois botões de pagamento**, e cada meio
de pagamento existe em **um único lugar**:

| Botão no site | Quem processa | O que o aluno pode usar |
|---|---|---|
| **PIX, cartão ou boleto** | Mercado Pago | PIX · cartão de crédito (até 12x) · cartão de débito virtual Caixa · boleto/lotérica · saldo da conta Mercado Pago · Linha de Crédito do Mercado Pago |
| **PayPal** | PayPal | **Só a conta PayPal** (saldo e cartões que o aluno já salvou no PayPal). É o caminho de quem é de fora do Brasil. |

Para isso não haver sobreposição:

- **O PIX "por chave" do site sai de cena.** Hoje o site gera um PIX com a
  chave da escola, mas não tem como saber se o aluno pagou. O PIX do Mercado
  Pago avisa o sistema sozinho, então só ele fica.
- **O formulário de cartão do site sai de cena.** Digitar o cartão dentro do
  site obrigaria a escola a seguir a norma de segurança PCI-DSS. O cartão é
  digitado na tela do Mercado Pago, que já cumpre essa norma.
- **O botão do PayPal é configurado para não aceitar cartão avulso**, só a
  conta PayPal. Cartão é sempre pelo Mercado Pago.

> 💡 **Muitos alunos estrangeiros?** O Mercado Pago pode pedir CPF em alguns
> pagamentos com cartão, o que atrapalha turistas. Se isso começar a
> acontecer muito, dá para liberar o cartão também no PayPal (veja a
> observação na Parte 4). Aí existe uma sobreposição de propósito: o cartão
> no PayPal vira a opção "cartão estrangeiro".

Com `MODO_PAGAMENTO: 'mock'` nada disso muda: os quatro métodos de
demonstração continuam aparecendo para testes.

### 6.2 Como o dinheiro e os créditos andam

```
MODO DEMONSTRAÇÃO (hoje)
  Navegador → "paguei" → credita  ← inseguro em produção

MODO PRODUÇÃO
  Aluno clica em "PIX, cartão ou boleto"
    → seu servidor cria a cobrança no Mercado Pago
    → aluno paga na tela do Mercado Pago e volta para o site
    → Mercado Pago avisa seu servidor (webhook)
    → servidor confere o pagamento na API e lança os créditos
    → o site vê os créditos e mostra "pagamento confirmado"

  Aluno clica no botão PayPal
    → seu servidor cria a ordem no PayPal
    → aluno aprova na janelinha do PayPal
    → seu servidor captura o pagamento e lança os créditos
```

O "seu servidor" é uma **Cloud Function do Firebase**: um pequeno programa
que roda no mesmo projeto Firebase que você já criou na seção 5. O código
dela está pronto na Parte 3.

### 6.3 Antes de começar

Separe **umas 3 horas** e confira se tem tudo:

- [ ] **Firebase já funcionando** (seção 5 inteira concluída).
- [ ] **Site publicado na internet** com endereço `https://` (seção 8). O
      Mercado Pago precisa de um endereço público para devolver o aluno ao
      site, e `localhost` não serve.
- [ ] **Node.js instalado** no computador (você já usa para rodar o site).
- [ ] **Conta Mercado Pago da escola**, de preferência no CNPJ. O dinheiro
      cai nela.
- [ ] **Conta PayPal Empresarial (Business)** da escola. Conta pessoal não
      serve para receber por site.
- [ ] **Um cartão de crédito para o Firebase.** As Cloud Functions só
      funcionam no plano **Blaze** (pago conforme o uso). No volume de uma
      escola de surf o uso fica dentro da cota gratuita e a conta tende a dar
      R$ 0, mas o Google exige um cartão cadastrado.

O roteiro tem seis partes, nesta ordem:

1. Mercado Pago: criar a aplicação e pegar as chaves de **teste**
2. PayPal: criar o app e pegar as chaves de **teste**
3. Firebase: ligar o plano Blaze e publicar o servidor
4. Ajustar o site (tarefa para quem programa)
5. Testar tudo com dinheiro de mentira
6. Virar a chave para produção

> 🔑 **Regra de ouro das chaves.** Cada gateway te dá uma chave **pública**
> (pode ficar no site) e uma **secreta** (Access Token / Secret). A secreta
> **nunca** vai para o `config.js`, para o GitHub, para e-mail ou para o
> WhatsApp. Ela só é digitada no terminal, na Parte 3, e fica guardada no
> cofre do Google (Secret Manager).

### 6.4 Parte 1 — Mercado Pago

**1. Cadastre uma chave PIX na conta do Mercado Pago.**
No app do Mercado Pago: **Pix → Minhas chaves → Cadastrar chave** (CNPJ ou
e-mail da escola). **Sem chave PIX cadastrada, o PIX não aparece** na tela
de pagamento.

**2. Crie a aplicação.**
1. Acesse [mercadopago.com.br/developers/panel](https://www.mercadopago.com.br/developers/panel)
   e entre com a conta da escola.
2. **Criar aplicação**.
3. Nome: `Site Barra Floripa`.
4. Tipo de solução: **Pagamentos online**.
5. Usa plataforma de e-commerce? **Não**.
6. Produto: **Checkout Pro**.
7. Aceite os termos e conclua.

> As telas do Mercado Pago mudam de nome de tempos em tempos. Se algum botão
> não estiver igual, procure pela palavra-chave (por exemplo "Checkout Pro",
> "Credenciais", "Webhooks").

**3. Copie as credenciais de teste.**
Dentro da aplicação: **Credenciais de teste**. Copie o **Access Token**
(começa com `TEST-` ou `APP_USR-`) para um bloco de notas **temporário**.
Você vai colar no terminal na Parte 3 e depois apagar o bloco de notas.

A *Public Key* não é usada: no Checkout Pro o aluno é levado para a tela do
próprio Mercado Pago.

**4. Crie as contas de teste.**
Na aplicação: **Contas de teste → Criar conta de teste**. Crie uma do tipo
**Comprador**, país Brasil, e anote o usuário e a senha. É com ela que você
vai "pagar" nos testes.

**5. Webhook (o aviso de pagamento).**
Esse passo depende do endereço do servidor, que só existe depois da Parte 3.
Deixe esta aba aberta e volte aqui no **passo 3.7**.

**6. Parcelamento e prazos (opcional, mas importante).**
O site mostra "até 12x". **Quem paga os juros do parcelamento é decisão da
escola**, configurada na conta Mercado Pago (procure por **"Parcelamento sem
juros"** e **"Prazo de recebimento"** nas configurações de custos). Quanto
mais rápido a escola quiser receber, maior a tarifa. Confira as tarifas
atuais na página de custos do Mercado Pago antes de decidir, e ajuste o
texto do botão se a escola não for absorver os juros.

### 6.5 Parte 2 — PayPal

**1. Garanta a conta Business.**
Em [paypal.com/br/business](https://www.paypal.com/br/business) crie a conta
empresarial da escola (ou converta a pessoal) e confirme o e-mail.

**2. Crie o app de teste (Sandbox).**
1. Acesse [developer.paypal.com](https://developer.paypal.com) e entre com a
   conta da escola.
2. **Apps & Credentials**. No topo, deixe a chave em **Sandbox**.
3. **Create App** → nome `Site Barra Floripa` → tipo **Merchant** → **Create App**.
4. Copie o **Client ID** (pode ir para o site) e o **Secret** (só no
   terminal, Parte 3).

**3. Pegue a conta de teste do comprador.**
Menu **Testing Tools → Sandbox Accounts**. Já existe uma conta
**Personal** criada. Clique nela → **View/Edit account** e anote e-mail e
senha.

### 6.6 Parte 3 — O servidor (Firebase Cloud Functions)

**3.1 Ligue o plano Blaze.**
1. [console.firebase.google.com](https://console.firebase.google.com) →
   projeto `barra-floripa`.
2. No canto inferior esquerdo, **Upgrade** → **Blaze** → cadastre o cartão.
3. Crie um **alerta de orçamento** (por exemplo R$ 20). Você recebe um e-mail
   se o gasto chegar perto disso. É só um alarme e não bloqueia nada.

**3.2 Prepare a pasta do servidor.**
A pasta `functions/` já existe no projeto: é a mesma dos e-mails
automáticos (seção 7). Se você já ligou os e-mails, pule para o 3.3. Se
não, abra o terminal **na pasta do projeto** e rode, um por vez:

```bash
npm install -g firebase-tools
firebase login
cd functions
npm install
cd ..
```

> Não rode `firebase init functions`: ele sobrescreveria os arquivos que já
> estão prontos.

**3.3 Cole o código do servidor.**
Crie o arquivo `functions/pagamentos.js` e cole nele o código abaixo. Depois
abra `functions/index.js` e **apague as duas barras** do começo da última
linha, para ela ficar assim:

```javascript
Object.assign(exports, require('./pagamentos'));
```

Código do `functions/pagamentos.js`:

```javascript
/**
 * Backend de pagamentos do Barra Floripa (Cloud Functions do Firebase).
 *
 * Rotas (todas POST):
 *   /mercadopago/preference  cria o checkout do Mercado Pago (PIX, cartão, boleto...)
 *   /mercadopago/webhook     recebe o aviso de pagamento do Mercado Pago
 *   /paypal/ordem            cria a ordem do PayPal
 *   /paypal/capturar         captura a ordem que o aluno aprovou
 *
 * Só este arquivo emite crédito de compra. O navegador nunca decide se algo
 * foi pago.
 */

const { onRequest } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const crypto = require('node:crypto');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const MP_ACCESS_TOKEN = defineSecret('MP_ACCESS_TOKEN');
const MP_WEBHOOK_SECRET = defineSecret('MP_WEBHOOK_SECRET');
const PAYPAL_CLIENT_ID = defineSecret('PAYPAL_CLIENT_ID');
const PAYPAL_SECRET = defineSecret('PAYPAL_SECRET');

class ErroHttp extends Error {
  constructor(status, mensagem) {
    super(mensagem);
    this.status = status;
  }
}

/* ---------- Compras e créditos ---------- */

/** Confere o login do aluno pelo token do Firebase que o site envia. */
async function uidDoAluno(req) {
  const token = (req.get('Authorization') || '').replace(/^Bearer /, '');
  if (!token) throw new ErroHttp(401, 'Faça login novamente.');
  try {
    return (await admin.auth().verifyIdToken(token)).uid;
  } catch {
    throw new ErroHttp(401, 'Sessão expirada. Faça login novamente.');
  }
}

/**
 * Carrega a compra do aluno e regrava preço e créditos a partir do catálogo.
 * Quem cria a compra é o navegador, então valor e créditos dela só passam a
 * ser confiáveis depois daqui.
 */
async function prepararCompra(req) {
  const uid = await uidDoAluno(req);
  const compraId = String(req.body?.compraId || '');
  if (!compraId) throw new ErroHttp(400, 'Compra não informada.');

  const ref = db.collection('compras').doc(compraId);
  const snap = await ref.get();
  if (!snap.exists || snap.get('alunoId') !== uid) throw new ErroHttp(404, 'Compra não encontrada.');
  if (snap.get('status') === 'pago') throw new ErroHttp(409, 'Esta compra já foi paga.');

  const pacoteSnap = await db.collection('pacotes').doc(snap.get('pacoteId')).get();
  if (!pacoteSnap.exists || pacoteSnap.get('ativo') === false) {
    throw new ErroHttp(400, 'Este plano não está mais disponível.');
  }
  const pacote = pacoteSnap.data();

  const confiavel = {
    nomePacote: pacote.nome,
    valor: Number(pacote.preco),
    creditos: Number(pacote.creditos),
    validadeDias: pacote.validadeDias ?? null,
    apenasFimDeSemana: pacote.apenasFimDeSemana === true,
    tipoPacote: pacote.tipo === 'individual' ? 'individual' : 'grupo',
    status: 'pendente',
  };
  await ref.update(confiavel);
  return { id: compraId, ...snap.data(), ...confiavel };
}

/** Fim do dia, N dias após o pagamento, no horário de Brasília (UTC-3). */
function expiraEmISO(pagoEm, validadeDias) {
  if (!validadeDias) return null;
  const FUSO = 3 * 60 * 60 * 1000;
  const local = new Date(pagoEm.getTime() - FUSO);
  local.setUTCDate(local.getUTCDate() + Number(validadeDias));
  local.setUTCHours(23, 59, 59, 999);
  return new Date(local.getTime() + FUSO).toISOString();
}

/**
 * Marca a compra como paga e lança os créditos. É a mesma lógica de
 * confirmarPagamento() em js/pagamentos.js, agora no servidor.
 * Idempotente: avisos repetidos do gateway não dobram o saldo.
 */
async function creditarCompra(compraId, referencia, valorPago) {
  const ref = db.collection('compras').doc(compraId);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new Error(`Compra ${compraId} não encontrada.`);
    const compra = snap.data();
    if (compra.status === 'pago') return;
    if (Math.abs(Number(valorPago) - Number(compra.valor)) > 0.01) {
      throw new Error(`Compra ${compraId}: pago ${valorPago}, esperado ${compra.valor}.`);
    }

    const pagoEm = new Date();
    tx.update(ref, {
      status: 'pago',
      pagoEm: pagoEm.toISOString(),
      referenciaPagamento: referencia,
      atualizadoEm: pagoEm.toISOString(),
    });
    tx.set(db.collection('creditos').doc(), {
      alunoId: compra.alunoId,
      delta: Number(compra.creditos) || 0,
      motivo: 'compra',
      nomePacote: compra.nomePacote,
      pacoteId: compra.pacoteId,
      tipoPacote: compra.tipoPacote || 'grupo',
      apenasFimDeSemana: compra.apenasFimDeSemana === true,
      expiraEm: expiraEmISO(pagoEm, compra.validadeDias),
      compraId,
      agendamentoId: null,
      observacao: null,
      criadoEm: pagoEm.toISOString(),
    });
  });
}

/* ---------- Mercado Pago ---------- */

async function mercadoPago(caminho, opcoes = {}) {
  const resp = await fetch(`https://api.mercadopago.com${caminho}`, {
    ...opcoes,
    headers: {
      Authorization: `Bearer ${MP_ACCESS_TOKEN.value()}`,
      'Content-Type': 'application/json',
    },
  });
  const dados = await resp.json();
  if (!resp.ok) throw new Error(`Mercado Pago ${resp.status}: ${JSON.stringify(dados)}`);
  return dados;
}

async function criarPreferenciaMP(req) {
  const compra = await prepararCompra(req);
  const voltar = `${process.env.SITE_URL}/checkout.html`
    + `?pacote=${encodeURIComponent(compra.pacoteId)}&compra=${compra.id}`;

  const preferencia = await mercadoPago('/checkout/preferences', {
    method: 'POST',
    body: JSON.stringify({
      items: [{
        id: compra.pacoteId,
        title: compra.nomePacote,
        quantity: 1,
        unit_price: compra.valor,
        currency_id: 'BRL',
      }],
      external_reference: compra.id,
      back_urls: { success: voltar, pending: voltar, failure: voltar },
      auto_return: 'approved',
      payment_methods: { installments: 12 },
      statement_descriptor: 'BARRA FLORIPA',
    }),
  });
  return { initPoint: preferencia.init_point };
}

/** Confere a assinatura x-signature: prova que o aviso veio do Mercado Pago. */
function assinaturaMPValida(req, dataId) {
  const partes = Object.fromEntries(
    (req.get('x-signature') || '').split(',').map((p) => p.trim().split('=')),
  );
  if (!partes.ts || !partes.v1) return false;
  const manifesto = `id:${dataId};request-id:${req.get('x-request-id')};ts:${partes.ts};`;
  const esperado = crypto.createHmac('sha256', MP_WEBHOOK_SECRET.value())
    .update(manifesto).digest('hex');
  return partes.v1.length === esperado.length
    && crypto.timingSafeEqual(Buffer.from(partes.v1), Buffer.from(esperado));
}

async function webhookMP(req) {
  const tipo = req.query.type || req.body?.type;
  const dataId = String(req.query['data.id'] || req.body?.data?.id || '').toLowerCase();
  if (tipo !== 'payment' || !dataId) return { ok: true }; // outros avisos: ignora
  if (!assinaturaMPValida(req, dataId)) throw new ErroHttp(401, 'Assinatura inválida.');

  let pagamento;
  try {
    pagamento = await mercadoPago(`/v1/payments/${dataId}`);
  } catch (err) {
    // O botão "Simular" do painel manda um id que não existe.
    logger.warn('Pagamento não encontrado no Mercado Pago', err.message);
    return { ok: true };
  }

  // PIX e boleto chegam primeiro como 'pending' e depois como 'approved'.
  if (pagamento.status === 'approved' && pagamento.external_reference) {
    await creditarCompra(pagamento.external_reference, `MP-${pagamento.id}`, pagamento.transaction_amount);
  }
  return { ok: true };
}

/* ---------- PayPal ---------- */

async function paypal(caminho, corpo = {}) {
  const base = process.env.PAYPAL_API;
  const basic = Buffer.from(`${PAYPAL_CLIENT_ID.value()}:${PAYPAL_SECRET.value()}`).toString('base64');
  const respToken = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const { access_token: token } = await respToken.json();

  const resp = await fetch(`${base}${caminho}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });
  const dados = await resp.json();
  if (!resp.ok) throw new Error(`PayPal ${resp.status}: ${JSON.stringify(dados)}`);
  return dados;
}

async function criarOrdemPaypal(req) {
  const compra = await prepararCompra(req);
  const ordem = await paypal('/v2/checkout/orders', {
    intent: 'CAPTURE',
    purchase_units: [{
      custom_id: compra.id,
      description: compra.nomePacote,
      amount: { currency_code: 'BRL', value: compra.valor.toFixed(2) },
    }],
  });
  return { id: ordem.id };
}

async function capturarPaypal(req) {
  await uidDoAluno(req);
  const orderId = String(req.body?.orderId || '');
  if (!/^[A-Z0-9]+$/.test(orderId)) throw new ErroHttp(400, 'Ordem inválida.');

  const captura = await paypal(`/v2/checkout/orders/${orderId}/capture`);
  const pagamento = captura.purchase_units?.[0]?.payments?.captures?.[0];
  if (captura.status !== 'COMPLETED' || pagamento?.status !== 'COMPLETED'
      || pagamento.amount.currency_code !== 'BRL') {
    throw new ErroHttp(402, 'O PayPal não confirmou o pagamento.');
  }
  await creditarCompra(pagamento.custom_id, `PAYPAL-${pagamento.id}`, pagamento.amount.value);
  return { ok: true };
}

/* ---------- Roteamento ---------- */

const ROTAS = {
  '/mercadopago/preference': criarPreferenciaMP,
  '/mercadopago/webhook': webhookMP,
  '/paypal/ordem': criarOrdemPaypal,
  '/paypal/capturar': capturarPaypal,
};

exports.api = onRequest(
  {
    region: 'southamerica-east1',
    cors: true,
    secrets: [MP_ACCESS_TOKEN, MP_WEBHOOK_SECRET, PAYPAL_CLIENT_ID, PAYPAL_SECRET],
  },
  async (req, res) => {
    const rota = ROTAS[req.path];
    if (req.method !== 'POST' || !rota) {
      res.status(404).json({ erro: 'Rota não encontrada.' });
      return;
    }
    try {
      res.json(await rota(req));
    } catch (err) {
      logger.error(req.path, err);
      res.status(err.status || 500).json({ erro: err.status ? err.message : 'Erro no servidor de pagamentos.' });
    }
  },
);
```

> Por que o servidor regrava o preço: hoje é o navegador que cria a compra,
> com o valor dentro dela. Sem essa conferência, alguém poderia criar uma
> compra de "12 aulas por R$ 1". O servidor ignora o valor que veio do
> navegador e usa o preço cadastrado em `pacotes`. Além disso, só lança
> crédito se o valor pago for igual ao da compra.

**3.4 Confira o arquivo de configuração do servidor.**
O servidor lê o arquivo `functions/.env`. Se ele ainda não existe, copie
`functions/.env.example` com o nome `.env` (é o mesmo arquivo dos e-mails).
Para os pagamentos, importam estas duas linhas:

```
SITE_URL=https://barrafloripasurfschool.com.br
PAYPAL_API=https://api-m.sandbox.paypal.com
```

- `SITE_URL`: o endereço do site publicado (seção 8), **sem barra no
  final**.
- `PAYPAL_API`: endereço de **teste** do PayPal. Na Parte 6 ele muda.

> O `.env` não vai para o GitHub (está no `.gitignore`). Como o GitHub Pages
> publica a pasta inteira do projeto, isso evita expor a configuração.

**3.5 Guarde as chaves secretas no cofre.**
Rode um comando por vez. Cada um pede o valor: **cole a chave e tecle Enter**
(nada aparece na tela enquanto você cola, e isso é normal).

```bash
firebase functions:secrets:set MP_ACCESS_TOKEN      # Access Token de teste do Mercado Pago
firebase functions:secrets:set PAYPAL_CLIENT_ID     # Client ID do Sandbox
firebase functions:secrets:set PAYPAL_SECRET        # Secret do Sandbox
firebase functions:secrets:set MP_WEBHOOK_SECRET    # por enquanto digite: provisorio
```

O `MP_WEBHOOK_SECRET` recebe um valor provisório agora e o valor de verdade
no passo 3.7.

> Os e-mails automáticos usam outros dois segredos, `SMTP_USER` e
> `SMTP_PASS` (seção 7). Como pagamentos e e-mails sobem juntos, o deploy
> pede os dois se eles ainda não existirem. Ligue os e-mails antes, ou
> cadastre esses segredos agora.

**3.6 Publique o servidor.**

```bash
firebase deploy --only functions
```

Leva alguns minutos. No final aparece algo como:

```
Function URL (api(southamerica-east1)): https://api-abc123xyz-rj.a.run.app
```

**Copie esse endereço.** Ele é o seu `backendUrl`. Dali em diante:

| Para quê | Endereço |
|---|---|
| `backendUrl` no `config.js` | `https://api-abc123xyz-rj.a.run.app` |
| Webhook do Mercado Pago | `https://api-abc123xyz-rj.a.run.app/mercadopago/webhook` |

**3.7 Ligue o webhook do Mercado Pago.**
1. Volte ao painel da aplicação no Mercado Pago → **Webhooks** →
   **Configurar notificações**.
2. Em **URL para teste** (e também em **URL de produção**), cole o endereço
   do webhook da tabela acima.
3. Eventos: marque **Pagamentos**. Salve.
4. Aparece uma **assinatura secreta**. Clique para revelar e copie.
5. No terminal:
   ```bash
   firebase functions:secrets:set MP_WEBHOOK_SECRET   # cole a assinatura
   firebase deploy --only functions
   ```
6. De volta ao painel, use **Simular notificação** (tipo *payment*). A
   resposta deve ser **200**. Se der 401, a assinatura foi colada errada:
   repita o passo 5.

### 6.7 Parte 4 — Ajustes no site (tarefa para quem programa)

> Esta parte é edição de código. Se a escola não tem alguém que programe,
> peça a um desenvolvedor: são alterações pequenas em três arquivos, e
> abaixo está exatamente o que mudar.

**4.1 `js/config.js`**

```javascript
MODO_PAGAMENTO: 'real',

pagamentos: {
  mercadoPagoPublicKey: '',                 // não é usada no Checkout Pro
  paypalClientId: 'AXk...client-id-sandbox',
  pixChave: '...',                          // só usada no modo demonstração
  pixBeneficiario: 'BARRA FLORIPA SURF',
  pixCidade: 'FLORIANOPOLIS',
},

backendUrl: 'https://api-abc123xyz-rj.a.run.app',   // sem barra no final
```

**4.2 `js/pagamentos.js`**

a) No import do store, acrescente `driverAtual`:

```javascript
import { criar, transacao, driverAtual } from './store.js';
```

b) Troque a lista `METODOS` para mostrar só os dois botões em produção:

```javascript
// Em produção, o Mercado Pago cuida de PIX, cartão, boleto e saldo, e o
// PayPal só da conta PayPal: cada meio aparece uma vez só.
export const METODOS = CONFIG.MODO_PAGAMENTO === 'real'
  ? [
    { id: 'mercadopago', nome: 'PIX, cartão ou boleto', icone: 'raio', descricao: 'Pelo Mercado Pago · até 12x' },
    { id: 'paypal', nome: 'PayPal', icone: 'globo', descricao: 'Conta PayPal · alunos do exterior' },
  ]
  : [
    { id: 'pix', nome: 'PIX', icone: 'raio', descricao: 'Aprovação na hora' },
    { id: 'cartao', nome: 'Cartão', icone: 'planos', descricao: 'Crédito em até 12x' },
    { id: 'mercadopago', nome: 'Mercado Pago', icone: 'carrinho', descricao: 'Saldo, cartão ou boleto' },
    { id: 'paypal', nome: 'PayPal', icone: 'globo', descricao: 'Conta PayPal' },
  ];
```

c) Substitua a função `processarPagamentoReal` inteira por:

```javascript
/** POST no backend de pagamentos, com o token de login do aluno. */
async function chamarBackend(caminho, corpo) {
  const token = await driverAtual().usuarioFirebaseAtual()?.getIdToken();
  const resp = await fetch(`${CONFIG.backendUrl}${caminho}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(corpo),
  });
  const dados = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new ErroPagamento('BACKEND', dados.erro || 'Não foi possível falar com o servidor de pagamentos.');
  return dados;
}

async function processarPagamentoReal({ compra, metodo }) {
  if (!CONFIG.backendUrl) {
    throw new ErroPagamento('SEM_BACKEND', 'MODO_PAGAMENTO está como "real", mas CONFIG.backendUrl está vazio.');
  }
  if (metodo !== 'mercadopago') {
    throw new ErroPagamento('METODO_INVALIDO', 'Em produção, o pagamento é pelo Mercado Pago ou pelo botão do PayPal.');
  }
  const { initPoint } = await chamarBackend('/mercadopago/preference', { compraId: compra.id });
  location.href = initPoint; // o aluno volta pela back_url
  return new Promise(() => {});
}

/**
 * Desenha o botão do PayPal. Só a conta PayPal: cartão avulso fica com o
 * Mercado Pago, para não haver dois caminhos para o mesmo meio.
 */
export async function renderizarPaypal(container, compra, { aoPagar, aoErro }) {
  if (!window.paypal) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = `https://www.paypal.com/sdk/js?client-id=${CONFIG.pagamentos.paypalClientId}`
        + '&currency=BRL&disable-funding=card,credit,paylater';
      script.onload = resolve;
      script.onerror = () => reject(new ErroPagamento('PAYPAL_SDK', 'Não foi possível carregar o PayPal.'));
      document.head.append(script);
    });
  }
  container.innerHTML = '';
  return window.paypal.Buttons({
    fundingSource: window.paypal.FUNDING.PAYPAL,
    createOrder: async () => (await chamarBackend('/paypal/ordem', { compraId: compra.id })).id,
    onApprove: async (data) => {
      await chamarBackend('/paypal/capturar', { orderId: data.orderID });
      aoPagar();
    },
    onError: aoErro,
  }).render(container);
}
```

> **Quer aceitar cartão estrangeiro pelo PayPal?** Tire `card` de
> `disable-funding` e apague a linha `fundingSource`. O PayPal passa a
> mostrar também "Cartão de débito ou crédito". Mude a descrição do botão
> para "Conta PayPal ou cartão do exterior", para o aluno brasileiro saber
> que o cartão dele é pelo outro botão.

**4.3 `js/pages/checkout.js`**

a) Imports: acrescente `renderizarPaypal` ao import de `../pagamentos.js` e
inclua a linha:

```javascript
import { observar } from '../store.js';
```

b) O método inicial deixa de ser fixo em `'pix'`:

```javascript
let metodoAtual = METODOS[0].id;
```

c) Em `selecionarMetodo`, depois da linha do cartão, acrescente:

```javascript
  if (id === 'paypal' && CONFIG.MODO_PAGAMENTO === 'real') await prepararPaypal();
```

d) Acrescente estas duas funções (perto de `pagarComGateway`):

```javascript
async function prepararPaypal() {
  qs('#btn-paypal').classList.add('oculto'); // o SDK desenha o botão de verdade
  if (!compra) compra = await criarCompra({ alunoId: usuario.id, pacoteId: pacote.id, metodo: 'paypal' });
  await renderizarPaypal(qs('#paypal-container'), compra, {
    aoPagar: mostrarSucesso,
    aoErro: (err) => toast(err?.message || 'O PayPal não concluiu o pagamento.', 'erro', 6000),
  });
}

/** O aluno voltou do Mercado Pago: os créditos entram quando o webhook chegar. */
function aguardarConfirmacao(compraId) {
  const aviso = qs('#aviso-modo');
  aviso.classList.remove('oculto');
  aviso.innerHTML = `
    ${icone('ampulheta')}
    <span><strong>Aguardando a confirmação do pagamento.</strong>
    PIX e cartão costumam levar poucos segundos; boleto, até 3 dias úteis.
    Os créditos entram sozinhos, e você pode fechar esta página.</span>`;

  let parar = null;
  parar = observar('compras', { alunoId: usuario.id }, (compras) => {
    if (compras.find((c) => c.id === compraId)?.status !== 'pago') return;
    parar?.();
    mostrarSucesso();
  });
}
```

e) No fim de `iniciar()`, troque `await selecionarMetodo('pix');` por:

```javascript
  // Volta do Mercado Pago (?compra=...&status=...). Se o aluno desistiu ou o
  // cartão foi recusado, mostra os métodos de novo para tentar outra vez.
  const compraRetorno = paramUrl('compra');
  if (compraRetorno && ['approved', 'pending', 'in_process'].includes(paramUrl('status'))) {
    aguardarConfirmacao(compraRetorno);
  } else if (compraRetorno) {
    toast('O pagamento não foi concluído. Você pode tentar de novo.', 'aviso', 6000);
  }

  await selecionarMetodo(METODOS[0].id);
```

f) Em `checkout.html`, no painel do Mercado Pago, troque o texto
"pagar com saldo, cartão ou boleto" por **"pagar com PIX, cartão de crédito,
boleto ou saldo"**. O nome do botão (`Ir para o Mercado Pago`) pode ficar.

Os painéis de PIX e de cartão continuam no HTML para o modo de
demonstração. Em produção eles nunca aparecem, porque não estão na lista
`METODOS`.

**4.4 Regras do Firestore**

Edite `firestore.rules` e troque as duas regras abaixo. Depois cole e
publique no Console, como no Passo 6 da seção 5.

```javascript
// ---------- compras ----------
// Só o servidor (Admin SDK, que ignora estas regras) marca como pago.
// O aluno pode apenas desistir de uma compra pendente.
allow update: if ehAdmin()
              || (ehDono(resource.data.alunoId)
                  && resource.data.status == 'pendente'
                  && request.resource.data.status == 'cancelado'
                  && request.resource.data.diff(resource.data).affectedKeys()
                       .hasOnly(['status', 'atualizadoEm']));
```

```javascript
// ---------- creditos ----------
// Crédito de compra só vem do servidor. O aluno lança apenas o -1 do
// agendamento e o +1 da devolução ao cancelar. Ajuste manual é só do admin.
allow create: if ehAdmin()
              || (ehEquipe() && request.resource.data.motivo != 'ajuste')
              || (ehDono(request.resource.data.alunoId)
                  && ((request.resource.data.motivo == 'agendamento' && request.resource.data.delta == -1)
                      || (request.resource.data.motivo == 'cancelamento' && request.resource.data.delta == 1)));
```

> ⚠️ **A regra de `creditos` é tão importante quanto a de `compras`.** A
> regra atual deixa o aluno gravar qualquer lançamento no próprio nome.
> Mesmo com o pagamento real ligado, ele ainda conseguiria se dar créditos
> pelo console do navegador.
>
> Fica um ponto em aberto: um aluno com conhecimento técnico ainda consegue
> forjar um "+1 de cancelamento". Para fechar isso de vez, o cancelamento
> também precisa passar pelo servidor, ou a regra precisa conferir o
> agendamento cancelado. Vale fazer depois que os pagamentos estiverem no ar.

Publique o site de novo (seção 8) com essas alterações.

### 6.8 Parte 5 — Testar com dinheiro de mentira

Tudo ainda está com as chaves de **teste**. Nenhum centavo é cobrado.

**Mercado Pago:**
1. Abra uma **janela anônima**, entre no site como um aluno e escolha um
   plano → **PIX, cartão ou boleto** → **Ir para o Mercado Pago**.
2. Na tela do Mercado Pago, entre com a **conta de teste do comprador**
   (Parte 1, passo 4).
3. Pague com um cartão de teste:

| Campo | Valor |
|---|---|
| Número | `5031 4332 1540 6351` (Mastercard) |
| Validade | `11/30` |
| Código de segurança | `123` |
| Nome do titular | `APRO` *(aprova o pagamento)* |
| CPF | `12345678909` |

4. ✅ Você volta para o site, vê "Aguardando a confirmação" e, segundos
   depois, "Pagamento confirmado" com os créditos no saldo.
5. Repita com o nome do titular `OTHE`. ✅ O pagamento é recusado e nenhum
   crédito entra.

**PayPal:**
1. Escolha um plano → **PayPal** → clique no botão amarelo.
2. Na janelinha, entre com a **conta Personal do Sandbox** (Parte 2, passo 3)
   e aprove.
3. ✅ A janela fecha, aparece "Pagamento confirmado" e os créditos entram.

**Confira no Firebase Console:**
- Firestore → `compras`: a compra está com `status: "pago"` e
  `referenciaPagamento` começando com `MP-` ou `PAYPAL-`.
- Firestore → `creditos`: há um lançamento `motivo: "compra"`.

**Deu errado?** Console do Firebase → **Functions → Logs** mostra o motivo.
Os mais comuns:

| Sintoma | Causa provável |
|---|---|
| "Não foi possível falar com o servidor" | `backendUrl` errado no `config.js`, ou com barra no final |
| Volta do Mercado Pago mas o crédito nunca entra | Webhook não configurado, ou `MP_WEBHOOK_SECRET` errado (log mostra 401) |
| "Este plano não está mais disponível" | Falta o documento do plano na coleção `pacotes` (seção 5, Passo 8) |
| PIX não aparece no Mercado Pago | A conta Mercado Pago não tem chave PIX cadastrada |
| Botão do PayPal não aparece | `paypalClientId` vazio ou do ambiente errado (Sandbox × Live) |

### 6.9 Parte 6 — Virar a chave para produção

Só faça isso depois de a Parte 5 funcionar inteira.

1. **Mercado Pago:** na aplicação, **Credenciais de produção → Ativar
   credenciais** (pede ramo de atividade e o endereço do site). Copie o
   **Access Token de produção** (`APP_USR-...`).
2. **PayPal:** em **Apps & Credentials**, mude a chave do topo para
   **Live** → **Create App** → copie o **Client ID** e o **Secret** de
   produção.
3. Troque os segredos e o ambiente do PayPal:
   ```bash
   firebase functions:secrets:set MP_ACCESS_TOKEN    # token de PRODUÇÃO
   firebase functions:secrets:set PAYPAL_CLIENT_ID   # Client ID LIVE
   firebase functions:secrets:set PAYPAL_SECRET      # Secret LIVE
   ```
   E em `functions/.env`:
   ```
   PAYPAL_API=https://api-m.paypal.com
   ```
4. `firebase deploy --only functions`
5. No `js/config.js`, troque `paypalClientId` pelo **Client ID Live** e
   publique o site de novo.
6. **Teste real de R$ 1:** em **Administração → Preços**, mude a *Aula em
   Grupo Avulsa* para R$ 1 e salve. Compre com PIX usando uma conta real,
   confira o crédito e depois:
   - volte o preço para o valor normal **na hora**;
   - devolva o dinheiro pelo painel do Mercado Pago (**Atividade → o
     pagamento → Devolver**);
   - retire o crédito do aluno de teste em **Administração → Alunos →
     Gerenciar → Retirar créditos** (veja "Reembolso" na seção 6.10).

> 🧹 **Faxina:** apague o bloco de notas onde você copiou as chaves. Se
> alguma chave secreta vazou (foi parar no GitHub, num print, numa
> mensagem), gere uma nova no painel do gateway e rode o `secrets:set` de
> novo.

### 6.10 Depois de ligado

- **Reembolso ou contestação (chargeback):** o sistema **não tira os
  créditos sozinho** quando o dinheiro é devolvido. Faça assim:
  1. Devolva o dinheiro no painel do Mercado Pago (**Atividade → o
     pagamento → Devolver**) ou do PayPal (**Atividade → a transação →
     Reembolsar**).
  2. Em **Administração → Alunos**, busque o aluno → **Gerenciar**.
  3. **Retirar créditos**, com a quantidade devolvida. No motivo, escreva o
     código da compra, por exemplo `Reembolso MP-123456`. O código está em
     `referenciaPagamento` da compra e no extrato do gateway.

  Se o aluno já usou parte das aulas, retire só o que sobrou. O painel não
  deixa retirar mais do que o saldo. Num reembolso parcial, a escola decide
  quanto devolver em dinheiro.
- **Boleto:** os créditos só entram quando o banco compensa (até 3 dias
  úteis). A validade do pacote começa a contar a partir do pagamento, então
  o aluno não perde dias.
- **Mudou um preço no painel admin?** O servidor sempre cobra o preço atual
  da coleção `pacotes`. Quem já pagou mantém as condições da compra dele.
- **Onde ver o dinheiro:** Mercado Pago e PayPal têm seus próprios extratos.
  No Firestore, cada compra paga guarda em `referenciaPagamento` o código
  `MP-...` ou `PAYPAL-...`, que bate com o número do pagamento no extrato.

---

## 7. Ligando os e-mails automáticos

Com esta parte ligada, o sistema avisa alunos e professores por e-mail:

| Quando | Quem recebe | O que diz |
|---|---|---|
| Um aluno cria a conta (e-mail/senha ou Google) | Aluno | Boas-vindas, como marcar a primeira aula e um botão para agendar |
| Entram créditos por **compra** ou por **ajuste** do admin | Aluno | Quantos créditos, plano, tipo, prazo para usar e o motivo, se for ajuste |
| Uma aula é **agendada** | Aluno | Confirmação com data, horário, professor, local e o prazo para desmarcar |
| | Professor da aula | Nome do aluno, data, horário e quantos alunos já estão na turma |
| Uma aula é **cancelada** (por qualquer pessoa) | Aluno | Quem cancelou, o motivo e o aviso de que o crédito voltou |
| | Professor da aula, **só se foi o aluno que cancelou** | Nome do aluno, motivo e quantos alunos continuam na turma |
| A equipe manda uma **mensagem** | Aluno | O texto do recado e a turma a que ele se refere |

Alguns detalhes:

- **Só funciona com o Firebase** (`MODO_DADOS: 'firebase'`). No modo
  `'local'` não há servidor, então nada é enviado.
- Quando a equipe cancela uma aula, o professor **não** recebe e-mail: ou foi
  ele mesmo, ou foi o administrador. Ao **retirar um professor**, cada aluno
  com aula marcada recebe o e-mail de cancelamento.
- Retirar crédito (reembolso) e o débito de um agendamento **não** geram
  e-mail de crédito. O agendamento já tem a confirmação dele.

### 7.1 Como funciona

O site **não envia e-mail**. Ele continua gravando no banco como sempre. Um
pequeno programa no servidor (Cloud Functions, na pasta `functions/`) fica
de olho no Firestore e manda o e-mail quando aparece um usuário, crédito,
agendamento, cancelamento ou mensagem novo.

Por isso ninguém consegue disparar e-mails pelo navegador, e as regras de
segurança continuam valendo. Cada envio fica registrado na coleção
**`emails`** do Firestore, com destinatário, assunto e `status` (`enviado`
ou `erro`, com a mensagem do erro). Só dá para ver essa coleção pelo
Console.

| Arquivo | Para que serve |
|---|---|
| `functions/emails.js` | Os gatilhos: quando enviar e para quem |
| `functions/modelos-email.js` | Os textos e o visual de cada e-mail |
| `functions/.env.example` | Modelo da configuração (copie para `.env`) |
| `firebase.json`, `.firebaserc` | Dizem ao Firebase onde está o servidor e qual é o projeto |

### 7.2 Escolha o serviço de envio

O servidor precisa de uma "caixa de correio de saída" (SMTP). Há duas
opções:

| | **Brevo** (recomendado) | **Gmail** |
|---|---|---|
| Remetente | `contato@barrafloripasurfschool.com.br` | o próprio endereço Gmail |
| Chance de cair no spam | Menor, com o domínio autenticado | Maior para e-mails automáticos |
| Custo | Plano gratuito com cota diária (perto de 300/dia; confira o plano atual) | Gratuito, com limite diário de envio |
| Trabalho | Precisa mexer no DNS do domínio (uma vez) | Só gerar uma senha de app |

Para uma escola, a cota gratuita do Brevo sobra. Um dia cheio de aulas gera
algumas dezenas de e-mails.

### 7.3 Passo a passo — Brevo

**1. Crie a conta.** Em [brevo.com](https://www.brevo.com), cadastre a
escola com o e-mail de contato.

**2. Autentique o domínio.** É isso que faz os e-mails não caírem no spam.
1. Menu do perfil → **Senders, Domains & Dedicated IPs** → aba **Domains**
   → **Add a domain** → `barrafloripasurfschool.com.br`.
2. O Brevo mostra alguns registros DNS (do tipo **TXT** e, às vezes,
   **CNAME**).
3. Entre no painel onde o domínio está registrado (Registro.br, Hostinger,
   Cloudflare...) → **DNS** / **Zona DNS** → adicione **cada registro**
   exatamente como o Brevo mostrou.
4. Volte ao Brevo e clique em **Authenticate**. A propagação pode levar
   algumas horas. Se falhar, tente de novo mais tarde.

> ⚠️ Cuidado para **não apagar** os registros que já existem no DNS,
> principalmente os do GitHub Pages (que mantêm o site no ar) e os do
> e-mail da escola (MX). Só **adicione**.

**3. Cadastre o remetente.** Aba **Senders** → **Add a sender** → nome
`Barra Floripa Surf School`, e-mail `contato@barrafloripasurfschool.com.br`.
Confirme pelo link que chega nessa caixa.

**4. Pegue o login SMTP.** Menu → **SMTP & API** → aba **SMTP**:
- anote o **Login** (algo como `8a1b2c001@smtp-brevo.com`): é o `SMTP_USER`;
- clique em **Generate a new SMTP key**, dê o nome `Site` e copie a chave:
  é o `SMTP_PASS`. Ela só aparece uma vez.

Configuração do Brevo no `.env`:
```
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
EMAIL_REMETENTE="Barra Floripa Surf School <contato@barrafloripasurfschool.com.br>"
```

**Alternativa — Gmail:**
1. Na conta Google que vai enviar, ative a **verificação em duas etapas**.
2. Acesse [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords),
   crie uma senha de app chamada `Barra Floripa` e copie os 16 caracteres.
3. `SMTP_USER` é o endereço Gmail e `SMTP_PASS` é a senha de app (sem
   espaços). No `.env`:
   ```
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=465
   EMAIL_REMETENTE="Barra Floripa Surf School <escola@gmail.com>"
   ```
   O remetente **precisa** ser o mesmo endereço Gmail.

### 7.4 Configure e publique o servidor

**1. Plano Blaze.** As Cloud Functions exigem o plano Blaze, o mesmo dos
pagamentos. Se ainda não ligou, siga o passo **3.1 da seção 6.6**. No
volume de uma escola, o uso fica dentro da cota gratuita.

**2. Ferramentas.** No terminal, **na pasta do projeto**:
```bash
npm install -g firebase-tools
firebase login
cd functions
npm install
cd ..
```

**3. Configuração.** Copie `functions/.env.example` para `functions/.env`
e ajuste:

| Linha | O que colocar |
|---|---|
| `SITE_URL` | Endereço do site, sem barra no final. É para onde apontam os botões dos e-mails. |
| `SMTP_HOST`, `SMTP_PORT` | Do serviço escolhido (7.3) |
| `EMAIL_REMETENTE` | Nome e endereço que aparecem como remetente |
| `EMAIL_RESPOSTA` | Para onde vão as respostas dos alunos (opcional) |

**4. Segredos.** Um comando por vez. Cole o valor quando ele pedir (nada
aparece na tela, e isso é normal):
```bash
firebase functions:secrets:set SMTP_USER
firebase functions:secrets:set SMTP_PASS
```

**5. Publicar:**
```bash
firebase deploy --only functions
```
Na primeira vez, o Firebase pode pedir para **ativar APIs** do Google
(Eventarc, Cloud Run, Secret Manager...). Responda **sim**. Se o primeiro
deploy falhar com erro de **permissão**, espere uns 5 minutos e rode de
novo: as permissões novas demoram um pouco para valer.

No final aparecem cinco funções: `emailBoasVindas`, `emailCreditos`,
`emailAgendamento`, `emailCancelamento` e `emailMensagem`.

> **Os e-mails dos professores precisam ser caixas reais.** O aviso vai
> para o e-mail de login de cada professor (ex.:
> `igor@barrafloripa.com.br`). Se esse endereço não recebe e-mail de
> verdade, a mensagem volta. Confira em **Authentication → Users**.

### 7.5 Testar

Use um e-mail seu, de verdade:

1. **Boas-vindas:** crie uma conta de aluno nova no site.
   - ✅ Chega "Boas-vindas à Barra Floripa Surf School".
2. **Créditos:** compre um plano (no modo de demonstração o pagamento é
   simulado, mas o e-mail é real).
   - ✅ Chega "Pagamento confirmado: N créditos na sua conta".
3. **Agendamento:** agende uma aula.
   - ✅ O aluno recebe "Aula confirmada". O professor da aula recebe "Novo
     aluno".
4. **Cancelamento:** cancele essa aula pelo painel do aluno.
   - ✅ O aluno recebe "Aula cancelada" e o professor, "Cancelamento".
5. **Mensagem:** entre como professor e mande um recado para a turma.
   - ✅ O aluno recebe "Mensagem de ...".
6. **Ajuste:** como admin, em **Administração → Alunos**, adicione 1
   crédito.
   - ✅ O aluno recebe "Você ganhou 1 crédito".

Não chegou? Confira nesta ordem:

| Onde olhar | O que procurar |
|---|---|
| Caixa de **spam** do destinatário | Comum nos primeiros envios, principalmente com Gmail |
| Firestore → coleção `emails` | Se o registro existe e qual é o `status`. Com `erro`, o campo `erro` diz o motivo. |
| Console → **Functions → Logs** | Se a função rodou. Sem registro na coleção `emails`, a função nem chegou a enviar. |

| Erro comum | Causa |
|---|---|
| `Invalid login` / `535` | `SMTP_USER` ou `SMTP_PASS` errados. Cadastre de novo e faça o deploy. |
| `Sender not authorized` / remetente recusado | `EMAIL_REMETENTE` não cadastrado no Brevo, ou diferente do Gmail |
| Botões do e-mail abrem página errada | `SITE_URL` errado no `.env` |
| Professor não recebe | O professor não tem e-mail no cadastro, ou o e-mail não existe |

### 7.6 Mudando os textos

Todos os textos ficam em **`functions/modelos-email.js`**, um bloco por
e-mail (`boasVindas`, `creditosAdicionados`, `agendamentoConfirmado`,
`aulaCanceladaAluno`, `novaMensagem`, `professorNovoAluno`,
`professorCancelamento`). Edite o texto entre as aspas e publique de novo
com `firebase deploy --only functions`.

> O WhatsApp e o endereço da escola no rodapé dos e-mails são uma **cópia**
> do `ESCOLA` de `js/config.js`, porque o servidor não lê os arquivos do
> site. Se mudarem, atualize os dois lugares.

Para desligar um tipo de e-mail, apague o bloco `exports.email...`
correspondente em `functions/emails.js` e publique. O Firebase pergunta se
pode remover a função: responda **sim**.

---

## 8. Publicando o site

### Firebase Hosting (recomendado, integra com o resto)

```bash
npm install -g firebase-tools
firebase login
firebase init hosting     # diretório público: . (ponto)
firebase deploy
```

### Netlify (mais simples ainda)

Arraste a pasta do projeto para [app.netlify.com/drop](https://app.netlify.com/drop).

### GitHub Pages

Faça push do repositório e ative Pages nas configurações, apontando para a
branch `main`.

> Em qualquer opção, lembre de adicionar o domínio publicado em
> **Authentication → Settings → Domínios autorizados** no Firebase, senão o
> login com Google não funciona.

---

## 9. Perguntas frequentes

**Os dados sumiram quando troquei de navegador.**
Esperado no modo `'local'` — os dados ficam no navegador. Para compartilhar
entre dispositivos, ligue o Firebase (seção 5).

**Como dou ou retiro créditos de um aluno manualmente?**
Em **Administração → Alunos → Gerenciar**: escolha a operação, a quantidade
e escreva o motivo. Os detalhes estão na seção 3.8.2.

**Posso mudar as cores e a logo?**
As cores estão em `css/base.css`, no bloco `:root`. Troque `--laranja` e tudo
acompanha. A logo é `logomenor-barrafloripa.png`, referenciada em `js/ui.js`.

**Como adiciono um quarto professor?**
No modo local, ele precisa existir como usuário. O caminho mais direto é
adicioná-lo em `DEFAULTS.professores` no `js/config.js` e reiniciar os dados
de demonstração. Com Firebase, siga o Passo 7 da seção 5.

**O QR Code não aparece.**
Ele é gerado por uma biblioteca carregada de um CDN. Sem internet, o sistema
mostra um aviso e o código copia e cola continua funcionando normalmente —
que é o caminho principal do PIX de qualquer forma.

**Dá para o aluno remarcar em vez de cancelar e agendar de novo?**
Não na versão atual. Como cancelar devolve o crédito na hora, o efeito prático
é o mesmo em dois passos.

---

## Estrutura dos arquivos

```
index.html · login.html · dashboard.html · agendar.html
checkout.html · creditos.html · historico.html · mensagens.html
professor.html · admin.html · perfil.html

css/
  base.css          variáveis de cor, tipografia, utilitários
  components.css    botões, cards, formulários, modais
  layout.css        cabeçalho, menus, rodapé, grades
  pages.css         estilos específicos de cada tela
  tema.css          visual do sistema (fontes Barlow, cabeçalho com foto e
                    onda, menu) — a página inicial não usa

js/
  config.js         ⚙️ AQUI você configura tudo
  store.js          camada de dados (escolhe o driver)
  store.local.js    driver localStorage + dados de exemplo
  store.firebase.js driver Firestore
  auth.js           login, sessão, proteção de páginas
  agenda.js         vagas, agendamento, cancelamento
  disponibilidade.js horários e locais de cada professor, folgas
  mensagens.js      recados da equipe para os alunos
  creditos.js       saldo e extrato
  pagamentos.js     PIX, cartão, gateways
  precos.js         preços e configuração efetivos
  avisos.js         pop-ups para os alunos
  ui.js             utilitários de tela
  icones.js         ícones de traço do sistema (sem emojis)
  pages/            um controlador por página

functions/          servidor (Cloud Functions) — exige plano Blaze
  index.js          junta os módulos abaixo
  emails.js         e-mails automáticos disparados pelo Firestore
  modelos-email.js  textos e visual dos e-mails
  pagamentos.js     (criado na seção 6.6) Mercado Pago e PayPal
  .env.example      modelo da configuração; copie para .env

firebase.json       onde está o servidor (usado pelo firebase deploy)
firestore.rules     regras de segurança (colar no Console)
docs/GUIA.md        este arquivo
```
