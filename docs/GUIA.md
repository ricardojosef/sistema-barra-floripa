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
7. [Publicando o site](#7-publicando-o-site)
8. [Perguntas frequentes](#8-perguntas-frequentes)

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

### 6.1 O que muda

```
MODO DEMONSTRAÇÃO (hoje)
  Navegador → "paguei" → credita  ← inseguro em produção

MODO PRODUÇÃO (recomendado)
  Navegador → gateway → paga
  Gateway   → webhook → SEU SERVIDOR → valida → credita
  Navegador → consulta → vê o crédito
```

O servidor pode ser uma **Cloud Function do Firebase** (no mesmo projeto, sem
custo adicional no volume de uma escola).

### 6.2 PIX

O sistema **já gera um código PIX válido** — o `js/pagamentos.js` monta o
BR Code no padrão do Banco Central, com CRC16 correto. Para receber de
verdade:

1. Em `js/config.js`, troque a chave pela chave PIX real da escola:

```javascript
pagamentos: {
  pixChave: 'CNPJ-OU-EMAIL-DA-ESCOLA',
  pixBeneficiario: 'BARRA FLORIPA SURF',
  pixCidade: 'FLORIANOPOLIS',
},
```

2. O aluno paga e o dinheiro cai na conta — **mas o sistema não sabe disso**.
   Alguém precisa conferir. Duas saídas:
   - **Simples:** a escola confere o extrato e libera o crédito manualmente
     pelo painel admin (ajuste de créditos).
   - **Automática:** contrate um PSP com API PIX (Mercado Pago, Gerencianet,
     Asaas). Eles enviam um webhook quando o pagamento cai, e aí o crédito é
     automático.

### 6.3 Mercado Pago

1. Crie a conta em [mercadopago.com.br/developers](https://www.mercadopago.com.br/developers).
2. Pegue a **Public Key** (vai no `config.js`) e o **Access Token**
   (fica **só no servidor** — nunca no navegador).
3. No `js/config.js`:

```javascript
MODO_PAGAMENTO: 'real',
backendUrl: 'https://sua-regiao-seu-projeto.cloudfunctions.net/api',
pagamentos: {
  mercadoPagoPublicKey: 'APP_USR-...',
},
```

4. No servidor, crie dois endpoints:
   - `POST /mercadopago/preference` — cria a preferência e devolve o
     `init_point` para onde redirecionar o aluno.
   - `POST /mercadopago/webhook` — recebe a notificação, **consulta a API para
     confirmar que o pagamento existe mesmo**, e só então credita.

O código do cliente já chama esses endpoints — veja `processarPagamentoReal()`
em `js/pagamentos.js`.

### 6.4 PayPal

1. Crie o app em [developer.paypal.com](https://developer.paypal.com) e pegue
   o **Client ID**.
2. Coloque em `CONFIG.pagamentos.paypalClientId`.
3. Adicione o SDK na página de checkout e renderize os botões:

```html
<script src="https://www.paypal.com/sdk/js?client-id=SEU_ID&currency=BRL"></script>
```

```javascript
paypal.Buttons({
  createOrder: (data, actions) => actions.order.create({
    purchase_units: [{ amount: { value: String(pacote.preco) } }],
  }),
  onApprove: async (data) => {
    // Capture SEMPRE no servidor — nunca confie no retorno do navegador.
    await fetch(`${CONFIG.backendUrl}/paypal/capturar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId: data.orderID, compraId: compra.id }),
    });
  },
}).render('#paypal-container');
```

### 6.5 Cartão de crédito

O formulário do sistema valida o número (algoritmo de Luhn), a validade e
identifica a bandeira — isso evita erros de digitação, mas **não processa
pagamento**.

> 🔒 **Nunca envie o número do cartão para o seu próprio servidor.** Isso
> obrigaria a escola a cumprir a norma PCI-DSS. Use o SDK do gateway para
> transformar o cartão em um *token* dentro do navegador, e mande só o token.

### 6.6 Ajuste final nas regras

Depois de ligar o pagamento real, edite `firestore.rules` e bloqueie a
confirmação pelo cliente:

```javascript
match /compras/{compraId} {
  allow update: if false;   // só o backend (Admin SDK) confirma pagamentos
}
```

---

## 7. Publicando o site

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

## 8. Perguntas frequentes

**Os dados sumiram quando troquei de navegador.**
Esperado no modo `'local'` — os dados ficam no navegador. Para compartilhar
entre dispositivos, ligue o Firebase (seção 5).

**Como dou créditos a um aluno manualmente?**
Hoje isso é feito pela seção de manutenção. Uma melhoria natural seria uma
tela "Gerenciar aluno" no painel admin — a função `lancarCreditoAvulso()` em
`js/creditos.js` já está pronta para isso.

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
professor.html · admin.html

css/
  base.css          variáveis de cor, tipografia, utilitários
  components.css    botões, cards, formulários, modais
  layout.css        cabeçalho, menus, rodapé, grades
  pages.css         estilos específicos de cada tela

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
  pages/            um controlador por página

firestore.rules     regras de segurança (colar no Console)
docs/GUIA.md        este arquivo
```
