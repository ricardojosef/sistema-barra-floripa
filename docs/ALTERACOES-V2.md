# Versão 2 — o que mudou

[← voltar ao GUIA](GUIA.md)

A versão anterior está na branch `v1-antes-alteracoes`.

## Resumo por pedido do cliente

| # | Pedido | Onde ficou |
|---|---|---|
| 1 | Agendar e comprar **antes** de ter login (estilo e-commerce) | `reservar.html` (5 etapas: plano → dia/horário → dados → saúde → pagamento). Todos os botões "Agendar Aula" da página inicial levam para lá. A conta nasce na etapa 3 e vira o acesso ao painel |
| 2 | Aluno não escolhe professor; equipe controla | O aluno vê só horário, praia e vagas. O sistema atribui o professor e o **admin troca** pelo botão ⇄ na aba Turmas. Professores veem as próprias turmas como antes |
| 3 | Saldo a receber do professor | Aba **Saldo** no painel do professor (admin vê de todos e registra pagamentos). Regra: R$ por aluno em grupo / R$ por particular, configurável |
| 4 | Nacionalidade e idioma; site no idioma | Cadastro com nacionalidade + "prefiro minha aula em PT/EN/ES". Site detecta o idioma do navegador já no 1º acesso, seletor PT·EN·ES no topo, preferência salva no perfil. O professor vê a bandeira do idioma em cada aluno |
| 5 | Botão do grupo de WhatsApp | Cartão verde no painel do aluno depois da 1ª aula marcada. Link editável em Admin → Horários |
| 6 | CPF obrigatório e baixa na aula | CPF (brasileiros) ou passaporte (estrangeiros) no cadastro, validado. Professor dá baixa digitando o CPF ou pelo ✓ de cada aluno (mostra o documento para conferir) e registra falta |
| 7 | Cupom de desconto | Campo no checkout; aba **Cupons** no admin (percentual ou valor, validade, limite de usos, planos). O servidor recalcula o desconto |
| 8 | Aviso de tempestade com data sem aula | Admin → Avisos → "Não haverá aulas" + data(s): bloqueia a data, cancela as aulas com estorno e manda a cada aluno mensagem e e-mail pedindo para reagendar. O painel do aluno mostra um alerta vermelho "reagende" |
| 9 | Política de cancelamento visível + bloqueio de 12h + justificativa | Seção na página inicial, caixa no fluxo de reserva e no checkout (com aceite obrigatório), página `termos.html`. Depois de 12h o botão Cancelar vira **Justificar** (texto + atestado). Admin aprova (estorna) ou recusa na aba **Justificativas** |
| 10 | Questionário de saúde + termo, renovação semestral, hall de PDFs | PAR-Q (7 perguntas do PDF) + termo + assinatura no dedo/mouse. Obrigatório para comprar e para agendar, vence em 6 meses. Aluno vê em "Saúde e termo"; professores têm a aba **Declarações** com download em PDF |
| 11 | Notificações WhatsApp e e-mail | Levantamento e guia em [NOTIFICACOES.md](NOTIFICACOES.md). E-mails dos eventos novos já implementados; módulo de WhatsApp oficial pronto e desligado |
| 12 | Pagamentos com a chave enviada + guia | Servidor `functions/pagamentos.js` ligado, Public Key no site, guia em [PAGAMENTOS.md](PAGAMENTOS.md) |
| 13 | Identidade visual | Mesmas fontes, cores, cabeçalho com foto e onda, cartões e botões. Nenhuma cor nova de marca (só o verde do WhatsApp no botão do grupo) |

## Modelo de dados (novidades)

| Coleção / campo | Conteúdo |
|---|---|
| `usuarios.{cpf, documento, nacionalidade, nascimento, idioma}` | CPF só dígitos (BR) ou passaporte; país ISO; `pt`/`en`/`es` |
| `agendamentos.{atribuicao, presenca, presencaEm, presencaPor, canceladoPorAviso, justificativaId, professorAnteriorId}` | `presenca`: `presente`/`ausente`/null |
| `compras.{valorOriginal, desconto, cupomCodigo, reserva, reservaStatus, reservaAgendamentoId}` | `reserva`: `{data, horario, localId, tipo}` |
| `creditos/{compra_<compra>}` · `creditos/{debito_<aula>}` · `creditos/{estorno_<aula>}` | Ids fixos: impedem crédito ou estorno em dobro |
| `config/app.{remuneracao, diasSemAula, grupoWhatsapp, validadeDeclaracaoMeses, pagamentoSimulado}` | |
| `professores.remuneracao` | Valores próprios (opcional) |
| `declaracoes` | PAR-Q + termo assinados (imutáveis) |
| `justificativas` | Texto, anexo (data URL), status, resposta |
| `cupons/{CODIGO}` | Leitura por código pública; listagem só admin |
| `repasses` | Pagamentos da escola ao professor |

## Decisões a validar

Onde o pedido deixava espaço, escolhi o que me pareceu mais sensato. Cada
item diz a alternativa e quanto custa mudar.

1. **Atribuição do professor (item 2).** O sistema já atribui ao agendar e o
   Laudinei pode trocar a qualquer momento. Na turma em grupo, completa
   primeiro a turma que já tem alunos e, empatado, segue a ordem da grade.
   *Alternativa:* aula fica "sem professor" até o Laudinei atribuir
   manualmente. Isso exige uma fila de "a atribuir" e cria o risco de aula
   sem professor se ele esquecer. *Mudança:* média.
2. **Vagas por horário = soma das vagas dos professores disponíveis** naquele
   horário e praia (ex.: 3 professores × 5 = 15). Se houver professores em
   praias diferentes no mesmo horário, o aluno escolhe a praia.
3. **Retirar professor** agora tenta passar as aulas futuras para outro
   professor do mesmo horário antes de cancelar.
4. **Remuneração (item 3):** padrão de R$ 40 por aluno em grupo e R$ 120 por
   aula particular, **valores de exemplo**: ajuste em Admin → Horários. Conta
   aluno que faltou sem justificativa (desligável). Não conta aula futura nem
   cancelada. *Alternativas:* valor fixo por turma, ou faixas por número de
   alunos.
5. **Estrangeiros (item 6):** sem CPF, informam passaporte/documento, e a baixa
   pelo número funciona igual. *Alternativa:* exigir CPF de todos, o que
   impede turistas.
6. **CPF não é checado contra duplicidade** entre contas (as regras não deixam
   um aluno ler dados de outro). Dá para fazer no servidor se for importante.
7. **Uma aula por reserva no fluxo público.** Quem compra pacote escolhe a
   1ª aula no fluxo (ou "agendar depois") e as demais pelo painel.
8. **Login com Google** continua para quem já tem conta. Quem entra assim pela
   primeira vez completa CPF/nacionalidade/idioma antes de comprar ou agendar.
   A aba "Criar conta" da tela de login agora leva ao fluxo de reserva.
9. **Questionário de saúde:** "SIM" em alguma pergunta **não bloqueia**: mostra
   a recomendação médica, o termo registra a responsabilidade e o professor vê
   um selo "PAR-Q: atenção". Menores de 18 anos exigem o nome do responsável.
   A assinatura é desenhada na tela (assinatura eletrônica simples).
   *Alternativa:* bloquear quem responde SIM até enviar liberação médica.
10. **Atestado** fica dentro do próprio documento (foto reduzida ou PDF até
    ~500 KB), sem precisar do Firebase Storage. *Alternativa:* Storage, para
    arquivos maiores.
11. **Justificativa** pode ser enviada para aula confirmada fora do prazo de
    12h **ou** para aula que já passou (falta). Aprovar = a escola cancela a
    aula e devolve o crédito, mesmo se a aula já passou.
12. **Aviso "sem aulas":** cancela **todas** as aulas confirmadas das datas,
    de todos os professores. Excluir o aviso libera as datas, mas não refaz as
    aulas canceladas.
13. **Idioma:** a página inicial, o fluxo de reserva, o login, os termos, o
    questionário, o checkout (partes novas) e o painel do aluno estão
    traduzidos. Ficam em português: nomes/descrições dos planos (dados do
    admin), mensagens da equipe, painéis do professor e do admin, e alguns
    avisos internos (toasts) do painel do aluno. O PDF da declaração sai
    sempre em português (documento oficial da escola).
14. **Termos de uso** (`js/termos-texto.js`) foram **redigidos por mim** a
    partir das regras combinadas (inclui CDC, arrependimento de 7 dias e
    LGPD). Precisam de revisão da escola e, idealmente, de um advogado.
15. **Pagamento:** Checkout Pro (o aluno paga na tela do Mercado Pago).
    *Alternativa:* Checkout Bricks (embutido no site, usa a Public Key) —
    veja [PAGAMENTOS.md](PAGAMENTOS.md#alternativa-checkout-bricks-pagamento-dentro-do-site).
16. **Professor vê só os próprios pagamentos** (`repasses`); a lista de aulas
    (agendamentos) continua visível para toda a equipe, como antes.
17. **A falta continua sem baixa automática:** se o professor não registrar,
    a aula vira "realizada" e conta como dada.

## Roteiro de teste

Em modo local (`MODO_DADOS: 'local'`, `MODO_PAGAMENTO: 'mock'`). Estes
cenários foram executados num navegador automatizado (41 verificações,
todas OK):

1. **Página inicial:** seção "Como funcionam agendamento e cancelamento";
   seletor PT·EN·ES traduz a página.
2. **Reserva sem login:** `reservar.html` → Pacote 4 Aulas → horário (sem nome
   de professor) → cadastro com CPF → questionário (enviar sem responder
   barra) → checkout com a aula no resumo → cupom `BEMVINDO10` (R$ 480 → R$
   432) → pagar sem aceitar termos barra → pagar → "Aula agendada!".
3. **Painel do aluno:** aula sem professor, botão do grupo de WhatsApp, saldo 3.
4. **Justificativa:** `andre@teste.com` → Histórico → falta de ontem → Justificar.
5. **Professor** `pedro@...`: amanhã → documento e idioma dos alunos → baixa
   pelo CPF `862.883.667-57` → aba Saldo (R$ 80,00) → aba Declarações.
6. **Admin:** aprovar a justificativa (estorno) → cupom com 1 uso → criar
   cupom → aviso "sem aulas" amanhã (cancela tudo, bloqueia a data) → trocar o
   professor de uma aula (⇄).
7. **Aluno afetado** (`aluno@teste.com`): alerta "reagende", mensagem, dia
   riscado no calendário.
8. **Termos** em espanhol com o prazo de 12h.

Também verificados: download do PDF da declaração, layout no celular (390 px,
sem rolagem lateral) e ausência de erros no console.

**Não testado aqui** (exige as credenciais e o deploy): regras do Firestore
publicadas, Cloud Functions de pagamento, webhook do Mercado Pago, e-mails e
WhatsApp. Siga o passo 7 de [PAGAMENTOS.md](PAGAMENTOS.md#7-teste-com-dinheiro-real-pequeno).

## Ajustes v2.1

| Pedido | Onde ficou |
|---|---|
| Datas dia/mês/ano | `formatarData` (`js/ui.js`) e `formatoDatas` (`js/i18n.js`). Campos de data viraram texto com máscara `dd/mm/aaaa` (o `.value` continua `YYYY-MM-DD`) |
| Menu lateral sem rolagem | `.barra-lateral` rola; a barra aparece ao passar o mouse (`css/pages.css`, seção v2.1) |
| Calendário antes do plano | `reservar.html`: 1. Suas aulas (uma ou várias) → 2. Plano sugerido → dados → saúde → pagamento. A compra guarda `reservas: [...]` |
| WhatsApp flutuante e no rodapé | `montarBotaoWhatsapp` / `montarRodape` (`js/ui.js`) |
| Página de links da bio | `links/index.html` → `barrafloripasurfschool.com.br/links` |

### Decisões a validar (v2.1)

18. **Quem é "gringo" para as datas:** só quem lê em inglês **e** é dos EUA
    (pelo cadastro ou, antes do login, pelo navegador `en-US`) vê mm/dd/aaaa.
    Espanhol, inglês britânico e brasileiros em inglês ficam com dia/mês/ano.
    Painéis da equipe, PDF da declaração e e-mails: sempre padrão brasileiro.
    *Alternativa:* todo mundo em dia/mês/ano, sem exceção (1 linha).
19. **Limite de aulas por compra:** até o maior pacote do tipo (12 em grupo,
    1 particular). As demais são agendadas depois pelo painel.
20. **Plano recomendado:** o mais barato que cobre as aulas marcadas. Planos
    que não servem (poucos créditos, mensalista só fim de semana, prazo de
    validade menor que a data da última aula) aparecem recolhidos, com o motivo.
21. **Particular:** uma aula por compra (o catálogo só tem particular avulsa).
22. **Fotos das aulas (/links):** abre uma galeria na própria página com as
    fotos do site. Para um álbum externo (Google Fotos), preencha
    `ESCOLA.fotosUrl` em `js/config.js`.

## Ajustes v2.2

| Pedido | O que mudou |
|---|---|
| Rolagem lateral | Painel do aluno no celular: o seletor de idioma do topo some abaixo de 560 px (fica no modal "Minha conta"), o chip mostra só o número de créditos e a barra inferior encolhe os rótulos. Rede de segurança `overflow-x: clip` em `html, body` (não corta conteúdo dentro da tela nem quebra o cabeçalho fixo) |
| Resumo e cupom antes do pagamento | `checkout.html`: resumo + cupom à esquerda (no celular, no topo); aceite e formas de pagamento depois |
| "Economize R$ 193.700" | Era cadastro: o Pacote 12 Aulas com **1300 créditos** (o preço digitado no campo de créditos). Admin agora recusa mais de 60 créditos, o site não mostra economia nesse caso e o servidor não cobra plano com cadastro inválido |
| Desmarcar horário | Clicar de novo desmarca também na tela "Agendar aula". O "mouse em cima" ficou diferente do "escolhido" (que ganhou um ✓) |
| Aula avulsa ×N | Com 2+ aulas marcadas aparece "N× Aula em Grupo Avulsa" (ou particular). Compra com `quantidade`; o servidor recalcula preço e créditos |
| Página de links | Sombra colorida em cada botão, fundo um pouco mais escuro, logo preenchendo o círculo |

23. **Recomendado com várias aulas:** continua sendo o pacote mais barato que
    cobre as aulas; "N× avulsa" aparece ao lado como alternativa ("Sem pacote")
    e só é recomendada se nenhum pacote servir. *Alternativa:* recomendar
    sempre o menor total (aí 2× avulsa, R$ 300, ganharia do Pacote 4, R$ 480).
24. **Aula particular** agora pode ser comprada em quantidade (até 12), como a avulsa.
