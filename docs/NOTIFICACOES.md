# Notificações por e-mail e WhatsApp

[← voltar ao GUIA](GUIA.md)

## O que já está pronto (e-mail)

O servidor (`functions/emails.js`) reage às gravações no Firestore e manda
e-mail via SMTP (Brevo). Nenhum e-mail sai do navegador.

| Evento | Quem recebe | Status |
|---|---|---|
| Conta criada | Aluno | já existia |
| Créditos de compra/ajuste | Aluno | já existia |
| Aula agendada | Aluno + professor atribuído | já existia (aluno não vê mais o nome do professor) |
| Aula cancelada | Aluno (+ professor, se foi o aluno) | já existia |
| Mensagem da equipe | Aluno | já existia |
| **Aviso "sem aulas" (tempestade)** | Cada aluno afetado, com as aulas dele e o pedido para reagendar | **novo** (via mensagem) |
| **Justificativa enviada** | Administradores (link para analisar) | **novo** |
| **Justificativa aprovada/recusada** | Aluno | **novo** (via mensagem) |
| **Professor trocado pelo admin** | Professor novo e antigo | **novo** |

Para ligar: crie a conta no Brevo, verifique o remetente e rode

```bash
firebase functions:secrets:set SMTP_USER
firebase functions:secrets:set SMTP_PASS
firebase deploy --only functions
```

Cada envio fica registrado na coleção `emails` (status e erro), visível só ao admin.

---

## Opções gratuitas (levantamento de novembro de 2026)

### E-mail

| Opção | Grátis | Prós | Contras |
|---|---|---|---|
| **Brevo** (já integrado) | 300 e-mails/dia, sem prazo | SMTP simples, já no código; folga para a escola | Limite diário; precisa verificar o domínio para não cair no spam |
| Resend | 3.000/mês, com teto de 100/dia | API moderna | Teto diário baixo para um dia de "tempestade" com muitas turmas |
| Gmail/Workspace SMTP | ~500/dia (conta comum) | Nada novo para cadastrar | Entregabilidade pior para disparo automático; senha de app |

**Recomendação:** manter o **Brevo**. Com 300/dia sobra para a escola (uma
tempestade que cancele 4 turmas de 5 alunos gera ~20 e-mails).

### WhatsApp

| Opção | Custo | Automático? | Risco | Observação |
|---|---|---|---|---|
| **Link wa.me** (clique para conversar) | R$ 0 | ❌ manual | nenhum | Já existe na ficha do aluno (professor/admin abre o WhatsApp com 1 clique) |
| **WhatsApp Cloud API (Meta, oficial)** | Sem mensalidade; paga por mensagem-modelo enviada pela escola | ✅ | baixo | Caminho oficial. Ver custos abaixo |
| CallMeBot | R$ 0 | ✅ (só para quem ativou) | médio | Uso pessoal: cada destinatário precisa mandar uma mensagem ao bot antes. Serve para avisar **a equipe**, não alunos |
| Bibliotecas não oficiais (Baileys, WPPConnect, Evolution API) | R$ 0 + servidor ligado 24h | ✅ | **alto** | Contra os termos do WhatsApp; o número da escola pode ser **banido**. Não roda no Firebase Functions |
| Revendedores (Twilio, Z-API, etc.) | Mensalidade e/ou taxa por mensagem | ✅ | varia | Twilio é oficial (adiciona margem); outros nacionais costumam ser não oficiais |

**Custos da Cloud API no Brasil** (tabela da Meta citada por provedores,
vigente desde 1º/out/2026):

- Mensagem de **utilidade** (confirmação, cancelamento, lembrete): **≈ R$ 0,035** cada (US$ 0,0068).
- Marketing: ≈ R$ 0,32 cada (não usaremos).
- Respostas dentro da janela de 24h depois que o aluno escreve: **1.000 grátis por mês** por número.
- As fontes divergem se modelos de utilidade dentro da janela de 24h ainda
  são grátis; confirme na [página de preços da Meta](https://developers.facebook.com/docs/whatsapp/pricing)
  antes de ligar.

Ordem de grandeza: 300 aulas/mês × 2 mensagens (confirmação + lembrete) ≈
600 mensagens ≈ **R$ 21/mês**. Não é gratuito, mas é o único caminho
automático sem risco de perder o número.

**Recomendação:**

1. **Agora, sem custo:** e-mail (Brevo) para todos os eventos (já pronto) +
   botão do grupo de WhatsApp no painel (já pronto) + link wa.me manual.
2. **Quando a escola quiser WhatsApp automático:** Cloud API oficial com 3
   modelos de utilidade (confirmação, cancelamento pela escola, lembrete na
   véspera). O código está pronto e desligado em `functions/whatsapp.js`.
3. **Não** usar bibliotecas não oficiais com o número principal da escola.

---

## Guia — ligar o WhatsApp oficial (Cloud API)

Tempo: ~1h de configuração + 1 a 2 dias de aprovação da Meta.

### 1. Conta e número

1. [business.facebook.com](https://business.facebook.com): crie/verifique o
   **Meta Business** da escola (CNPJ ajuda na verificação).
2. [developers.facebook.com](https://developers.facebook.com) → Meus apps →
   **Criar app** → tipo **Empresa** → adicione o produto **WhatsApp**.
3. Adicione um **número de telefone**. Ele não pode estar em uso no app
   WhatsApp comum. Use um chip dedicado ou migre o número da escola, sabendo
   que ele deixa de funcionar no app de celular.
4. Anote o **Phone number ID** (WhatsApp → Configuração da API).

### 2. Token permanente

Business Settings → **Usuários do sistema** → crie um usuário Admin → **Gerar
token** com as permissões `whatsapp_business_messaging` e
`whatsapp_business_management`, sem expiração.

### 3. Modelos (templates)

WhatsApp Manager → **Modelos de mensagem** → categoria **Utilidade**, nos
idiomas **Português (BR)**, **Inglês** e **Espanhol**:

| Nome | Texto sugerido (PT) |
|---|---|
| `aula_confirmada` | Olá, {{1}}! Sua aula de surf está confirmada: {{2}} às {{3}}, {{4}}. Leve seu documento. Cancelamento pelo site até 12h antes. |
| `aula_cancelada` | Olá, {{1}}. A escola cancelou sua aula de {{2}} às {{3}} ({{4}}). O crédito já voltou para a sua conta — reagende pelo site. |
| `lembrete_aula` | Olá, {{1}}! Amanhã tem aula às {{2}}, {{3}}. Chegue 15 min antes e leve seu documento. |

### 4. Ligar no servidor

```bash
firebase functions:secrets:set WHATSAPP_TOKEN
```

No `functions/.env`:

```
WHATSAPP_PHONE_ID=123456789012345
WHATSAPP_API_VERSION=v23.0        # use a versão que o painel da Meta mostrar
```

Em `functions/index.js`, descomente:

```javascript
Object.assign(exports, require('./whatsapp'));
```

```bash
firebase deploy --only functions
```

O agendamento diário do lembrete usa o Cloud Scheduler (grátis até 3 jobs/mês
por conta de cobrança).

### 5. Consentimento e opt-out

- O cadastro já pede o WhatsApp "para avisos do mar". Antes de ligar,
  acrescente ao texto de `dados.whatsDica` (em `js/i18n-textos.js`) algo como
  "e avisos das suas aulas".
- Quem pedir para não receber: marque `whatsappOptOut: true` no documento do
  usuário (Console do Firebase). O módulo respeita.
- Telefones: brasileiros sem DDI recebem `55` automaticamente; estrangeiros
  precisam digitar com `+` e DDI (o placeholder do cadastro já mostra o exemplo).

### 6. Testar

Agende uma aula com o seu número; a coleção `whatsapp` registra cada envio
(`enviado` ou `erro` com a resposta da Meta). Erro `132001`: modelo
inexistente ou não aprovado naquele idioma.

---

## Fontes

- [WhatsApp Business API Pricing 2026: Rates and Providers](https://aissist.io/insights/whatsapp-business-api-pricing)
- [WhatsApp API pricing October 2026 — Reiko](https://reikosoftware.com.br/en/blog/whatsapp-api-pricing-october-2026)
- [WhatsApp API Pricing in Brazil (2026)](https://zynfo.ai/whatsapp-pricing/brazil)
- [WhatsApp Cloud API Pricing 2026 — Blueticks](https://blueticks.co/blog/whatsapp-business-api-pricing-2026)
- [Brevo — Free email API, 300 emails/day](https://www.brevo.com/features/email-api/)
- [Free email sending tiers 2026](https://freetier.co/articles/free-email-sending-tiers-2026)
- [Email API free tiers compared](https://cli.nylas.com/guides/email-api-free-tiers-compared)
