# Pagamentos em produção — Mercado Pago (e PayPal opcional)

[← voltar ao GUIA](GUIA.md)

## Como funciona

```
Aluno escolhe plano/aula/cupom → site cria compras/{id} com status 'pendente'
  → POST {backendUrl}/mercadopago/preference   (token do Firebase no header)
       servidor recalcula preço + cupom a partir de `pacotes`/`cupons`
       cria a preferência (Checkout Pro) e devolve init_point
  → aluno paga no Mercado Pago (PIX, cartão até 12x, boleto, saldo MP)
  → volta para checkout.html?compra={id}  (tela "Confirmando seu pagamento…")
  → Mercado Pago chama {backendUrl}/mercadopago/webhook
       servidor confere a assinatura, busca o pagamento na API
       approved  → compra 'pago' + creditos/compra_{id} + uso do cupom
       rejected  → compra 'recusado'
  → a tela (que observa a compra) vê 'pago', agenda a aula reservada e mostra o sucesso
```

- **Só o servidor credita compra.** As regras do Firestore bloqueiam o
  navegador de marcar compra como paga ou lançar crédito de compra.
- **Cupom de 100%:** não passa pelo gateway; o site chama
  `/compra/gratuita`, e o servidor confere que o valor recalculado é zero.
- **A aula reservada** é agendada pelo navegador do aluno ao ver a compra paga.
  Se ele fechar a aba, o painel conclui a reserva no próximo acesso
  (`concluirReservasPendentes`). Se a vaga acabou no meio-tempo, o crédito
  fica na conta e o painel avisa para escolher outro horário.

## Sobre a chave que você enviou

`APP_USR-c13c2208-5c11-4eb1-b19a-3ba3f8a203d1` é a **Public Key** de produção
(formato `APP_USR-` + UUID). Ela é pública por natureza e já está em
`js/config.js` (`pagamentos.mercadoPagoPublicKey`).

**Ela sozinha não cobra nada.** Para criar a cobrança e consultar pagamentos o
servidor precisa do **Access Token** (formato
`APP_USR-<números>-<números>-<hex>-<números>`), que é **secreto**: vai só para
o cofre do Firebase, nunca para o código, git, e-mail ou WhatsApp.

> O fluxo usa **Checkout Pro** (o aluno paga na tela do Mercado Pago). Nele a
> Public Key não é obrigatória; ela fica pronta para quando/se quiser migrar
> para o **Checkout Bricks** (pagamento embutido no site) — veja o fim deste
> documento.

## Passo a passo

### 1. Conta e credenciais (painel do Mercado Pago)

1. [mercadopago.com.br/developers/panel](https://www.mercadopago.com.br/developers/panel) → sua aplicação
   (a mesma da Public Key).
2. ✅ Public Key de produção — já está no site.
3. ⬜ **Credenciais de produção → Access Token**: copie para colar no passo 3.
4. ⬜ Na conta MP da escola: **cadastre uma chave PIX** (sem ela o PIX não aparece
   no Checkout Pro) e confira **Parcelamento sem juros** / **Prazo de
   recebimento** (o site diz "até 12x"; quem paga juros é configuração da conta).

### 2. Ferramentas

```bash
npm install -g firebase-tools
firebase login
firebase use barra-floripa
```

Plano **Blaze** ativo no projeto (Cloud Functions exigem). Crie um alerta de
orçamento (ex.: R$ 20) em Faturamento.

### 3. Segredos

```bash
firebase functions:secrets:set MP_ACCESS_TOKEN      # cole o Access Token de produção
firebase functions:secrets:set MP_WEBHOOK_SECRET    # digite: provisorio (o real vem no passo 6)
firebase functions:secrets:set PAYPAL_CLIENT_ID     # nao-usado  (ou o Client ID, se for usar)
firebase functions:secrets:set PAYPAL_SECRET        # nao-usado  (ou o Secret)
```

> As functions de e-mail usam `SMTP_USER` e `SMTP_PASS`. Como tudo sobe junto,
> o deploy pede esses dois se não existirem. Se ainda não configurou o Brevo,
> cadastre valores provisórios (os e-mails falham e ficam registrados em
> `emails`, sem afetar pagamentos) ou siga [NOTIFICACOES.md](NOTIFICACOES.md).

### 4. Variáveis

```bash
cp functions/.env.example functions/.env
```

No `functions/.env`, confira:

```
SITE_URL=https://barrafloripasurfschool.com.br   # endereço público do site, sem barra no final
PAYPAL_API=https://api-m.paypal.com              # produção (sandbox: api-m.sandbox.paypal.com)
```

### 5. Deploy

```bash
firebase deploy --only functions,firestore:rules
```

No fim o terminal mostra a URL da function `api`. O site já aponta para:

```
https://southamerica-east1-barra-floripa.cloudfunctions.net/api
```

Se a URL mostrada for diferente (ex.: `https://api-xxxx-rj.a.run.app`), cole-a
em `js/config.js` → `backendUrl` (sem barra no final). As duas formas
funcionam para functions de 2ª geração.

### 6. Webhook

1. Painel da aplicação → **Webhooks → Configurar notificações**.
2. **URL de produção:** `{backendUrl}/mercadopago/webhook`
3. Evento: **Pagamentos**. Salvar.
4. Copie a **assinatura secreta** e:
   ```bash
   firebase functions:secrets:set MP_WEBHOOK_SECRET
   firebase deploy --only functions
   ```
5. **Simular notificação** (tipo payment) deve responder **200**. 401 = assinatura errada.

### 7. Teste com dinheiro real (pequeno)

1. Admin → Cupons → crie `TESTE99` de **R$ 479** em valor fixo, limite 1 uso,
   só para "Pacote 4 Aulas" (a compra fica em R$ 1,00).
2. Numa janela anônima: `reservar.html` → plano 4 aulas → horário → cadastro →
   questionário → cupom → aceite → **PIX**.
3. Pague o PIX de R$ 1. Em segundos a tela vira "Pagamento confirmado" e a aula
   aparece agendada.
4. Confira no Firestore: `compras/{id}.status = 'pago'`, `creditos/compra_{id}`,
   `cupons/TESTE99.usos = 1`.
5. Estorne no painel do Mercado Pago e ajuste os créditos em **Admin → Alunos**
   (lançamento de "retirar").

**Se algo falhar:** `firebase functions:log --only api` mostra o erro. Os
casos comuns:

| Sintoma | Causa provável |
|---|---|
| "O servidor de pagamentos recusou" logo ao clicar | `backendUrl` errado, ou compra criada com regras antigas |
| Volta do MP e fica em "Confirmando…" para sempre | Webhook não configurado ou `MP_WEBHOOK_SECRET` errado (veja o log: 401) |
| Log: `pago X, esperado Y` | Preço alterado no admin entre criar e pagar a compra — o crédito não é lançado; estorne |

## PayPal (opcional, para estrangeiros)

O Mercado Pago pode pedir CPF em alguns pagamentos com cartão, o que atrapalha
turistas. O PayPal já está implementado:

1. [developer.paypal.com](https://developer.paypal.com) → Apps & Credentials → **Live** → Create App.
2. `firebase functions:secrets:set PAYPAL_CLIENT_ID` e `PAYPAL_SECRET` com os valores Live.
3. `PAYPAL_API=https://api-m.paypal.com` no `functions/.env` e `firebase deploy --only functions`.
4. Em `js/config.js` → `pagamentos.paypalClientId` = Client ID Live. O botão
   PayPal aparece sozinho no checkout (só conta PayPal; cartão continua no
   Mercado Pago).

## Alternativa: Checkout Bricks (pagamento dentro do site)

Usa a Public Key no navegador para desenhar o formulário do Mercado Pago
dentro do checkout (sem sair do site). Exige uma rota nova no servidor
(`POST /v1/payments` com os dados que o Brick tokeniza) e tratar o retorno do
PIX (QR Code) na tela. Vale se a escola quiser a experiência 100% no site; o
Checkout Pro atual é mais simples e já cobre PIX, cartão e boleto.
