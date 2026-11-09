# Contingência do canal: e se a Meta travar

> **Papel deste documento:** registrar os planos B, C e D caso a Meta não libere o WhatsApp, com o orçamento do Twilio como base de custo. **Nada aqui está decidido** (DD-23): é o mapa para não improvisar se o bloqueio durar. Em conflito com `requisitos.md`, vale `requisitos.md`. A política da Meta está em `politica-meta-whatsapp.md` (local); os bloqueios atuais, em [`canal-whatsapp.md`](canal-whatsapp.md) ("Pendências da Meta") e [`andamento.md`](andamento.md), seção 4.

Escrito em 07/11/2026. Legenda: ✅ vem de fonte conferida no projeto · ⚠️ a confirmar antes de depender · 🧭 proposta nossa, sujeita ao OK dos sócios.

## 1. O risco, em uma frase

O WhatsApp é a tese do produto (RF11 a RF19). Se a Meta negar o acesso de vez, o código continua de pé, mas o produto perde o diferencial de lançar sem instalar nada. O bloqueio de hoje (P15: app em modo desenvolvimento e erro 130497) é **operacional**, não de política ✅. Só o segundo tipo de bloqueio mata o plano A.

| Tipo de bloqueio | Exemplo | O BSP (plano B) resolve? |
|---|---|---|
| Operacional | App não publicado, perfil incompleto, pagamento, falta de CNPJ para a verificação | Em parte: o suporte do BSP ajuda, mas a verificação da empresa continua exigindo o CNPJ ⚠️ |
| De política | A Meta enquadra o produto como "provedor de IA" (seção 4.7) e recusa | **Não.** O BSP aplica a mesma política. Ir para o plano C ou D |
| De conta | Número banido, restrição por país de destino (130497) | Talvez. Depende da causa, que ainda não conhecemos ⚠️ |

## 2. Orçamento do Twilio (calculadora, 07/11/2026)

Tarifas copiadas da calculadora do Twilio:

| Tipo | Tarifa da Meta | Tarifa do Twilio |
|---|---|---|
| Mensagem de serviço (resposta dentro da janela de 24 h) | US$ 0,0068 por mensagem enviada, depois das 1.000 gratuitas por número por mês ⚠️ | US$ 0,005 por mensagem, entrada ou saída ✅ |
| Modelo de utilidade (fora da janela) | US$ 0,0068 por mensagem | US$ 0,005 por mensagem |
| Modelo de autenticação | US$ 0,0068 por mensagem | US$ 0,005 por mensagem |
| Modelo de marketing (não usamos) | US$ 0,0625 por mensagem | US$ 0,005 por mensagem |

**Correção importante (conferida na página de preços da Meta e na do Twilio, 07/11/2026):** a Meta cobra pelas mensagens de serviço dentro da janela de 24 h, e não só pelos modelos. Pela página da Meta, as mensagens de serviço foram gratuitas a partir de 01/11/2024; a cobrança voltou em **01/10/2026**, a partir da 1.001ª mensagem de serviço por mês por número, e os modelos de utilidade enviados em resposta ao usuário também voltaram a ser cobrados. A cobrança é **por mensagem enviada** (a entrada não custa). Isso contradiz a premissa "serviço gratuito" do `produto.md`, que estava desatualizada. Três ressalvas ⚠️: (1) a leitura da página foi automática, então a confirmação final é no cartão de tarifas em reais da Meta; (2) uma leitura da página do Twilio trouxe US$ 0,0034 na linha de serviço, e usei US$ 0,0068 (o valor colado) por prudência; (3) as 1.000 mensagens gratuitas valem por número, e o plano é um número só para todos os restaurantes, então o ganho é pequeno.

### Custo por restaurante por mês

(O modelo completo, com a IA, o custo fixo e a margem por preço, está em [`../custos-e-precificacao.md`](../custos-e-precificacao.md).)

Premissas 🧭: cada mensagem recebida gera uma resposta (a confirmação, RF16, regra inegociável 7); a Meta cobra só a saída; o Twilio cobra entrada e saída; dólar a R$ 5,50 (suposição); sem desconto das mensagens gratuitas.

| Cenário | Recebidas / enviadas | Meta direta (plano A) | Com Twilio (Meta + Twilio) | Parte de um plano de R$ 199 (A / B) | Parte de um plano de R$ 99 (A / B) |
|---|---|---|---|---|---|
| Leve (10 por dia, cerca de 300 lançamentos) | 300 / 300 | US$ 2,04 (R$ 11,22) | US$ 5,04 (R$ 27,72) | 6% / 14% | 11% / 28% |
| Intenso (20 por dia) | 600 / 600 | US$ 4,08 (R$ 22,44) | US$ 10,08 (R$ 55,44) | 11% / 28% | 23% / 56% |
| Intenso com perguntas e correções (+20%) | 720 / 720 | US$ 4,90 (R$ 26,93) | US$ 12,10 (R$ 66,53) | 14% / 33% | 27% / 67% |

Os planos de R$ 99 a R$ 199 são a faixa provisória do P03. Os valores acima **não incluem a IA** (cerca de US$ 0,0004 por mensagem de texto, mais a transcrição).

**Mensagens proativas** (resumos e alertas da v1.1, RF34, fora da janela): US$ 0,0118 cada (Meta mais Twilio). Quatro por mês dão cerca de US$ 0,05 por restaurante. Irrelevante.

### Leitura

- **O plano A também custa.** Só a Meta direta já pesa de US$ 2 a US$ 5 por restaurante por mês, e a referência de custo variável total é de até US$ 5 (RNF08.R2, que inclui a IA). No uso intenso a referência estoura mesmo sem BSP. Isso pede decisão dos sócios sobre o preço (P03) e os limites de uso (RF21), antes do piloto.
- **O Twilio mais que dobra o custo do WhatsApp:** o acréscimo é de US$ 3 a US$ 7 por restaurante por mês.
- **Piloto (5 a 10 restaurantes):** de US$ 25 a US$ 100 por mês com Twilio. Cabe.
- **100 restaurantes no uso leve:** cerca de US$ 504 por mês com Twilio (R$ 2.772), contra US$ 204 pela Meta direta. Pesa, mas a diferença é a taxa do BSP.
- **Alavancas:** subir o preço ou o piso do plano; manter uma resposta só por mensagem de origem (já é a regra, RF16) e não multiplicar perguntas de volta; cota de mensagens por plano (RF21); cotar BSPs de mensalidade fixa.

**Conclusão:** o Twilio é viável como **ponte** (piloto, sandbox de testes, contingência por alguns meses). Como casa definitiva ele pesa na margem. Se virar permanente, pedir também orçamento de BSPs de mensalidade fixa por número (o 360dialog é o exemplo, ⚠️ valores a confirmar) e de BSPs brasileiros (Zenvia, entre outros).

## 3. Os planos

### Plano A: Cloud API da Meta, direta (o atual)

A Meta cobra só as mensagens enviadas (de US$ 2 a US$ 5 por restaurante por mês, seção 2). Depende de resolver P15: publicar o app, forma de pagamento, perfil, CNPJ e verificação da empresa. **Segue como plano principal.**

### Plano B: provedor oficial intermediário (BSP)

Fluxo: `cliente → WhatsApp → Meta → BSP → webhook da nossa API`, e o inverso no envio. Para o cliente final nada muda ✅. Candidatos: Twilio (sandbox imediato e documentação forte), 360dialog (formato quase igual ao da Meta, o menor retrabalho), Zenvia e Gupshup.

- **Quando acionar 🧭:** o bloqueio é operacional ou de conta, o CNPJ já foi aberto e a verificação enviada, e mesmo assim o 130497 persiste por **15 dias** com ticket aberto na Meta.
- **Quando não adianta:** bloqueio de política (seção 1).
- **Custo:** tabela da seção 2.
- **Trabalho:** um adaptador por provedor em `packages/whatsapp` (assinatura, leitura do webhook, download de mídia) e o `MessageSender` correspondente. O Twilio assina com `X-Twilio-Signature` e manda formulário; a mídia exige autenticação básica ⚠️. A chave de idempotência (`wa_message_id`) passa a ser o identificador do BSP, e avaliar uma coluna `provider` em `inbound_messages`. Fila, IA, regras e banco não mudam. Estimativa 🧭: poucos dias, porque os testes de webhook (E3) e de mídia (E9) já são por porta.
- **Ainda exige:** CNPJ para a verificação da empresa, número dedicado (sem uso no app comum) e modelos de mensagem aprovados.

### Plano C: Telegram como segundo canal

A API de bots é gratuita, sem verificação de empresa e sem aprovação de modelos. Texto, áudio e foto funcionam, então o pipeline da E9 se reaproveita. Limites:

- O público de restaurante usa WhatsApp. Serve para o círculo de amigos do piloto, não para vender.
- O Telegram identifica por `chat_id`. A E4 identifica pelo telefone, então seria preciso um passo de vínculo (o usuário compartilha o contato uma vez) ⚠️.
- **Quando acionar 🧭:** a Meta recusa por política, ou o plano B esbarra em custo ou em prazo e precisamos de um canal real para validar com restaurantes.

Também serve, mesmo sem crise, ao teste "mágico de Oz" do `produto.md` (seção 7), que hoje depende de um número de WhatsApp operado à mão.

### Plano D: painel web como entrada principal

O painel já é PWA (F7). Adiantar o **lançamento manual** (RF26, hoje v1.1) e acrescentar gravação de voz e foto da nota pelo próprio navegador, reaproveitando a transcrição e a leitura de cupom da E9. Mais perto do "app" que o MVP tinha deixado de fora, com atrito maior (abrir o painel, não só mandar uma mensagem). **Quando acionar 🧭:** a Meta nega e os planos B e C não resolvem. A captura de nota por e-mail (RF31) é um reforço natural.

### Descartados

- **Bibliotecas não oficiais do WhatsApp (Baileys, whatsapp-web.js):** violam os termos, o número pode ser banido sem aviso e a empresa fica refém disso. Nem como paliativo de piloto.
- **Plataforma de mensagens própria:** exigiria um app que o cliente não vai instalar; o app nativo já ficou fora do MVP.

## 4. Como o código absorve a troca

O canal já está atrás de portas em `packages/core` (`MessageSender`, `MediaDownloader`) e o recebimento vive em `apps/api/src/http/webhooks/whatsapp.ts` e `packages/whatsapp`. Trocar de provedor é trocar adaptador e rota na composição (`apps/api/src/composition.ts`, `CHANNEL_MODE`). Estes pontos viram trabalho se a troca acontecer:

1. `inbound_messages.raw` guarda o formato da Meta (D3). Um segundo provedor guardaria o dele; decidir o campo `provider` ou aceitar JSON heterogêneo.
2. A identificação do remetente por telefone (E4) vale para o BSP (o número vem no webhook) e **não** vale para o Telegram sem o passo de vínculo.
3. `parar` e `voltar` (P14), janela de 24 horas e modelos (E10) são regras da Meta, repetidas pelo BSP. No Telegram não existem e as regras de produto devem ser revistas.

## 5. Árvore de decisão 🧭

1. **Agora:** seguir pelo plano A. Abrir o CNPJ (Matheus), completar perfil e pagamento, publicar o app (Luís).
2. **CNPJ aberto e verificação enviada, e o 130497 persiste 15 dias depois com ticket aberto:** pedir orçamento de dois BSPs e ativar o plano B para o piloto.
3. **A Meta recusa por política (4.7), ou os planos A e B falham em até 60 dias do passo 2:** plano C para validar com restaurantes e plano D como entrada de fato; reabrir o escopo do MVP (DD-16).
4. **O plano B passa a ser permanente (mais de 6 meses):** reavaliar o custo da seção 2 e cotar BSPs de mensalidade fixa.

Os prazos (15 e 60 dias) são proposta; os sócios ajustam.

## 6. O que fazer já, sem arrependimento

- [ ] Manter as portas do canal limpas: nenhum código de `apps/api` fora de `http/webhooks` e `infra` pode conhecer o formato da Meta.
- [ ] Criar uma conta Twilio e usar o **sandbox** para testar áudio e foto reais (pendência da E9) sem CNPJ e sem aprovação. Serve só a desenvolvimento; não é canal de cliente. Dono: Luís.
- [ ] Antes do piloto: reler a seção 4.7 e conferir o papel de Tech Provider (`politica-meta-whatsapp.md`).
- [ ] Confirmar com o Twilio a tarifa das mensagens de serviço e se há desconto por volume.
- [ ] Pedir orçamento de 360dialog e de um BSP brasileiro, só para ter o número.

## 7. A confirmar ⚠️

- Tarifa da Meta para mensagens de serviço no Brasil, em reais, e a regra das 1.000 gratuitas por número (cartão de tarifas oficial da Meta).
- Preço e modelo de cobrança do 360dialog, da Zenvia e da Gupshup.
- O que o BSP exige além do CNPJ para o número de produção.
- Câmbio usado (R$ 5,50 é suposição).
