# Guia de implementação — Barra Floripa

Roteiro curto para quem programa. Cada assunto grande tem o próprio documento:

| Documento | Conteúdo |
|---|---|
| **GUIA.md** (este) | Estado atual, checklist e ordem de execução |
| [PAGAMENTOS.md](PAGAMENTOS.md) | Mercado Pago em produção (passo a passo) e PayPal opcional |
| [NOTIFICACOES.md](NOTIFICACOES.md) | E-mail e WhatsApp: opções gratuitas, comparação e implementação |
| [ALTERACOES-V2.md](ALTERACOES-V2.md) | O que mudou nesta versão, modelo de dados e **decisões a validar** |

> A versão anterior deste guia (passo a passo longo, para leigos) está no
> histórico do git e na branch `v1-antes-alteracoes`.

---

## 1. Estado atual

Legenda: ✅ feito · ⬜ a fazer · ❓ não consegui confirmar daqui — marque se já fez.

### Base

- ✅ Projeto Firebase `barra-floripa` criado, app web registrado, credenciais em `js/config.js`
- ✅ `MODO_DADOS: 'firebase'` (Auth + Firestore em uso)
- ✅ `functions/` com dependências instaladas (`functions/node_modules`)
- ✅ Public Key de produção do Mercado Pago em `js/config.js`
- ✅ Código do servidor de pagamentos pronto (`functions/pagamentos.js`) e ligado em `functions/index.js`
- ✅ Branch de backup `v1-antes-alteracoes` criada **localmente**
- ⬜ Publicar a branch de backup no GitHub: `git push -u origin v1-antes-alteracoes`
- ⬜ Firebase CLI instalado nesta máquina (`firebase` não foi encontrado no PATH)
- ❓ Plano **Blaze** ativo (obrigatório para Cloud Functions)
- ❓ E-mails automáticos publicados (Brevo + `SMTP_USER`/`SMTP_PASS`)
- ❓ Site publicado em `https://` (o retorno do Mercado Pago precisa de um endereço público)

### Esta versão (v2)

- ⬜ Publicar as **regras novas** do Firestore (o calendário público e as coleções novas dependem delas)
- ⬜ Cadastrar o **Access Token** do Mercado Pago no cofre e publicar as functions
- ⬜ Configurar o **webhook** do Mercado Pago
- ⬜ Testar uma compra real de R$ 1 (cupom) e estornar
- ⬜ Preencher no painel admin: link do **grupo de WhatsApp** e **remuneração** dos professores
- ⬜ Revisar com a escola o texto de **termos** (`js/termos-texto.js`) e as decisões de [ALTERACOES-V2.md](ALTERACOES-V2.md#decisões-a-validar)

---

## 2. Ordem de execução (o que falta)

### Passo 1 — Ferramentas (5 min)

```bash
npm install -g firebase-tools
firebase login
firebase use barra-floripa
```

### Passo 2 — Regras do Firestore (2 min)

O `firebase.json` agora aponta para `firestore.rules`, então dá para publicar
pela linha de comando:

```bash
firebase deploy --only firestore:rules
```

O que as regras novas fazem (detalhes em `firestore.rules`):

- `vagas`, `disponibilidade`, `config`, `pacotes`, `professores`, `locais`:
  **leitura pública** — o calendário do fluxo de reserva funciona antes do login.
- `declaracoes`, `justificativas`, `cupons`, `repasses`: coleções novas.
- **Crédito de compra só pelo servidor.** O aluno só cria débito de aula
  própria e estorno `estorno_<aula>` de aula própria recém-cancelada (o id
  fixo impede estorno em dobro). Para testar o modo demonstração com o
  Firebase, crie `pagamentoSimulado: true` em `config/app` (e apague depois).

> ⚠️ Publique as regras **junto** com o site novo. Com as regras antigas, o
> fluxo de reserva não carrega o calendário para quem não está logado; com o
> site antigo e as regras novas, a compra demonstração deixa de creditar.

### Passo 3 — Pagamentos (≈ 1 h)

Siga [PAGAMENTOS.md](PAGAMENTOS.md). Resumo:

```bash
firebase functions:secrets:set MP_ACCESS_TOKEN     # Access Token de PRODUÇÃO
firebase functions:secrets:set MP_WEBHOOK_SECRET   # "provisorio" agora; o real no passo do webhook
firebase functions:secrets:set PAYPAL_CLIENT_ID    # "nao-usado" se não for usar PayPal
firebase functions:secrets:set PAYPAL_SECRET       # "nao-usado" se não for usar PayPal
cp functions/.env.example functions/.env           # e ajuste SITE_URL
firebase deploy --only functions
```

### Passo 4 — Publicar o site

Publique os arquivos (mesmo processo de antes: Firebase Hosting, Netlify ou
GitHub Pages). Depois, no painel **Admin → Horários**:

- link do **grupo de WhatsApp** dos alunos;
- **remuneração padrão** (R$ por aluno em grupo, R$ por particular) e, em
  **Admin → Professores**, valores próprios por professor se houver;
- confira a antecedência de cancelamento (12h) e a validade do questionário (6 meses).

### Passo 5 — Dados antigos (uma vez)

- **Alunos cadastrados antes desta versão** não têm CPF/nacionalidade/idioma.
  Ao entrar, o painel pede para completar (bloqueia compra e agendamento até
  completar). Nada a migrar à mão.
- **Questionário de saúde:** ninguém tem declaração ainda; cada aluno responde
  no próximo agendamento ou compra.
- **Aulas já marcadas** continuam com o professor atual. Se a lotação mostrada
  parecer errada, use **Admin → Horários → Recalcular vagas**.

### Passo 6 — Notificações (opcional)

Veja [NOTIFICACOES.md](NOTIFICACOES.md): os e-mails dos eventos novos já
estão no servidor; WhatsApp tem opções e um caminho recomendado.

---

## 3. Testar localmente

```bash
npx serve .
```

Para testar sem tocar no Firebase de produção, troque temporariamente em
`js/config.js`:

```javascript
MODO_DADOS: 'local',     // dados no navegador, com seed de demonstração
MODO_PAGAMENTO: 'mock',  // pagamento simulado
```

Contas de demonstração (senha `barra123`): `aluno@teste.com`,
`andre@teste.com` (tem uma falta para justificar), `martin@teste.com`
(argentino, aula em espanhol), `emily@teste.com` (EUA, inglês),
`camila@teste.com` e `bruno@teste.com` (sem questionário de saúde),
`laudinei@barrafloripa.com.br` (admin), `pedro@barrafloripa.com.br`,
`igor@barrafloripa.com.br`, `gabrieli@barrafloripa.com.br`. Cupom de teste:
`BEMVINDO10`.

O roteiro de teste de cada item está em [ALTERACOES-V2.md](ALTERACOES-V2.md#roteiro-de-teste).

---

## 4. Referência rápida

| Arquivo | Para quê |
|---|---|
| `js/config.js` | Modos, chaves públicas, `backendUrl`, valores de fábrica |
| `js/agenda.js` | Vagas por horário, escolha interna do professor, cancelamento, presença, troca de professor |
| `js/reserva.js` | Rascunho do fluxo de reserva e agendamento após o pagamento |
| `js/saude.js` · `js/saude-form.js` | PAR-Q, termo, assinatura, PDF |
| `js/cupons.js` · `js/justificativas.js` · `js/financeiro.js` | Cupons, justificativas, saldo dos professores |
| `js/i18n.js` · `js/i18n-textos.js` · `js/termos-texto.js` | Idiomas (PT/EN/ES) e termos |
| `functions/pagamentos.js` | Mercado Pago, PayPal, cupom 100% — único lugar que credita compra |
| `functions/emails.js` · `functions/modelos-email.js` | E-mails automáticos |
| `firestore.rules` | Segurança |
