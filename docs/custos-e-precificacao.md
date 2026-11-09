# Custos, viabilidade e precificação

> **Papel deste documento:** reunir em um lugar o custo de operar o produto, a margem por restaurante, o ponto de equilíbrio e o que os números pedem de preço. Antes dele, esses dados estavam espalhados (tabela abaixo). **Nenhum preço aqui está decidido**: a decisão é dos sócios (P03, `[PROVISÓRIO – P03]`). Regras de limites e de plano: RF21, RF37 e RNF08 em [`requisitos.md`](requisitos.md). Custo do canal e plano B: [`planos/contingencia-canal.md`](planos/contingencia-canal.md).

Escrito em 07/11/2026. Legenda: ✅ medido ou conferido em fonte · ⚠️ estimativa ou não conferido · 🧭 premissa nossa, a validar.

## 1. Onde cada número morava

| O quê | Onde estava |
|---|---|
| Faixa de preço (R$ 99 a 199), teste de 14 dias, piloto de 60 a 90 dias | `requisitos.md` (RF01.R15, RF37, P03), `produto.md` seção 6, `planos/matheus.md` |
| Custo variável de referência (até US$ 5 por restaurante) | `requisitos.md` RNF08.R2, `produto.md` seção 6 |
| Custo fixo (R$ 200 a 950 por mês) e abertura (R$ 3 a 10 mil) | `produto.md` seção 6 |
| Preço dos modelos de IA e da transcrição | `packages/ai/src/pricing.ts` (versionado), `planos/luis.md` seção 5 |
| Custo medido da IA (US$ 0,0004 por mensagem de texto) | `planos/andamento.md`, `planos/luis.md` |
| Hospedagem (AWS `sa-east-1` ou Fly.io mais R2) | `planos/luis.md` seção 4, sem valores |
| Cotas e limites de uso | `requisitos.md` RF21 |
| WhatsApp (Meta e Twilio) | `planos/contingencia-canal.md` seção 2 |

A planilha de custo por restaurante que o `luis.md` pede (seção 5) ainda não existia. A seção 3 deste documento é a primeira versão dela.

## 2. Premissas do modelo

| Premissa | Valor | Origem |
|---|---|---|
| Lançamentos por restaurante por mês | Leve 300 (10 por dia), Intenso 600 (20 por dia), Intenso com perguntas e correções 720 | `luis.md` (10 a 20 mensagens por dia) e RNF08.R2 (300 no uso típico) |
| Mensagens enviadas pelo produto | Uma por mensagem recebida (a confirmação, RF16) | Regra inegociável 7 |
| Mix | 50% por áudio (de cerca de 20 s), 20% com foto, 10% geram consulta | RNF08.R2 (metade por áudio, 60 fotos e 30 consultas em 300) |
| IA, texto | US$ 0,0015 por mensagem: US$ 0,0004 medido ✅ com Haiku, subindo para considerar 15% de casos no Sonnet (20 vezes mais caro) 🧭 | `andamento.md`, `pricing.ts`, `luis.md` |
| IA, áudio | US$ 0,002 por áudio de 20 s ⚠️ (US$ 0,006 por minuto, preço do `gpt-transcribe` não confirmado) | `pricing.ts` |
| IA, foto e consulta | US$ 0,005 e US$ 0,02 ⚠️, **não medidos** | 🧭 |
| WhatsApp, Meta | US$ 0,0068 por mensagem **enviada**; a recebida não custa ⚠️ | `contingencia-canal.md` seção 2 (páginas da Meta e do Twilio, 07/11/2026, leitura automática) |
| WhatsApp, Twilio (plano B) | US$ 0,005 por mensagem, entrada e saída ✅ | idem |
| Câmbio | R$ 5,50 por dólar 🧭 | suposição |
| Pagamento e impostos sobre a receita | 10% 🧭 (gateway mais imposto do regime da empresa) | **Validar com o Matheus** |

Não entram: o trabalho dos sócios, marketing, suporte e a hospedagem do ambiente de piloto além do intervalo de custo fixo.

## 3. Custo variável por restaurante por mês

| Componente | Leve | Intenso | Intenso +20% |
|---|---|---|---|
| IA (extração, transcrição, foto, consulta) | US$ 1,65 | US$ 3,30 | US$ 3,96 |
| WhatsApp, Meta direta | US$ 2,04 | US$ 4,08 | US$ 4,90 |
| **Total com a Meta direta (plano A)** | **US$ 3,69 (R$ 20)** | **US$ 7,38 (R$ 41)** | **US$ 8,86 (R$ 49)** |
| WhatsApp, taxa do Twilio | US$ 3,00 | US$ 6,00 | US$ 7,20 |
| **Total com o Twilio (plano B)** | **US$ 6,69 (R$ 37)** | **US$ 13,38 (R$ 74)** | **US$ 16,06 (R$ 88)** |

**O que isso mostra:**
- O WhatsApp pesa mais que a IA: com a Meta direta, a mensagem enviada custa cerca de 55% do total; com o Twilio, o WhatsApp chega a cerca de 75%. O ganho de trocar o modelo de IA por um mais barato é pequeno perto disso.
- A referência de **US$ 5** do RNF08.R2 foi escrita quando o serviço era gratuito. Hoje, com o WhatsApp incluído, ela só se sustenta no uso leve (US$ 3,69 com a Meta direta).
- As 1.000 mensagens gratuitas por número por mês (Meta) quase não ajudam, porque o plano usa um número só para todos os restaurantes.

## 4. Custo fixo, abertura e piloto

| Item | Valor | Origem |
|---|---|---|
| Fixo mensal (infraestrutura, provedor, domínio, monitoramento) | R$ 200 a 950 | `produto.md` ⚠️ sem detalhe por item |
| Abertura (CNPJ, termos e política com advogado, identidade visual) | R$ 3 a 10 mil | `produto.md` ⚠️ |
| Piloto | 5 a 10 restaurantes, gratuito por 60 a 90 dias, depois preço de fundador | `produto.md` seção 7 |

**Quanto custa chegar à primeira receita** (abertura, mais fixo e variável durante o piloto gratuito):

| Cenário | Variável | Fixo | Abertura | Total |
|---|---|---|---|---|
| Enxuto: 5 restaurantes, 2 meses, uso leve, Meta direta | R$ 203 | R$ 400 | R$ 3.000 | **cerca de R$ 3.600** |
| Médio: 10 restaurantes, 3 meses, uso intenso, Meta direta | R$ 1.218 | R$ 1.725 | R$ 6.500 | **cerca de R$ 9.400** |
| Pesado: 10 restaurantes, 3 meses, intenso +20%, Twilio | R$ 2.649 | R$ 2.850 | R$ 10.000 | **cerca de R$ 15.500** |

## 5. Margem e preço

Margem de contribuição (receita menos 10% de pagamento e imposto, menos o custo variável), em porcentagem do preço:

| Preço | Uso | Meta direta | Com Twilio |
|---|---|---|---|
| R$ 99 | Leve | 70% | 53% |
| | Intenso | 49% | 16% |
| | Intenso +20% | 41% | **1%** |
| R$ 149 | Leve | 76% | 65% |
| | Intenso | 63% | 41% |
| | Intenso +20% | 57% | 31% |
| R$ 199 | Leve | 80% | 72% |
| | Intenso | 70% | 53% |
| | Intenso +20% | 66% | 46% |

**Preço mínimo para uma margem de 60%** (fórmula: custo variável em reais dividido por 0,30; com 50%, dividido por 0,40):

| Uso | Meta direta | Com Twilio |
|---|---|---|
| Leve | R$ 68 | R$ 123 |
| Intenso | R$ 135 | R$ 245 |
| Intenso +20% | R$ 162 | R$ 294 |

**Ponto de equilíbrio do custo fixo** (uso intenso; restaurantes pagantes para cobrir R$ 200 e R$ 950 por mês):

| Preço | Meta direta | Com Twilio |
|---|---|---|
| R$ 99 | 4 a 20 | 13 a 61 |
| R$ 149 | 2 a 10 | 3 a 16 |
| R$ 199 | 2 a 7 | 2 a 9 |

## 6. Leitura de viabilidade

- **O negócio fecha com a Meta direta.** A partir de R$ 149 a margem fica entre 57% e 76%, e cerca de dez restaurantes pagantes cobrem o custo fixo mais alto. A abertura se paga em poucos meses com 15 a 20 clientes.
- **R$ 99 só serve com uso controlado.** No uso intenso a margem cai a 49%, e com o Twilio fica abaixo de 20%. Se o preço de entrada for R$ 99, precisa de limite de mensagens.
- **O Twilio não pode ser a casa definitiva em planos baratos.** Ele é uma ponte para o piloto e para contingência. Como padrão, exige preço de R$ 199 ou mais e uso até o intenso.
- **O custo cresce com as mensagens enviadas, não com os clientes.** Um restaurante que manda 600 mensagens custa o dobro de um que manda 300, pelo mesmo preço. Hoje o RF21 limita mensagens por hora e por dia, mas não por mês, nem põe o custo do WhatsApp na cota.
- **A IA não é o problema.** Mesmo com 15% de casos no Sonnet, ela soma de US$ 1,65 a US$ 4.

## 7. Propostas para os sócios (decisão deles, P03)

1. **Preço de entrada de R$ 149** (Essencial) e R$ 199 ou mais (Profissional), em vez de R$ 99. O R$ 99 só entra com teto de mensagens.
2. **Cota mensal de mensagens enviadas por plano**, além da cota de consultas do RF21.R3. Exemplo: 600 no Essencial. Ao chegar a 80%, aviso no painel; ao chegar a 100%, o produto continua recebendo e as confirmações viram resumo único. Mudança de regra: entra primeiro em `decisoes.md` e `requisitos.md`.
3. **Reescrever a referência do RNF08.R2:** separar o custo de IA (alvo de US$ 2 a 4) do custo de WhatsApp (US$ 2 a 5), em vez de um teto único de US$ 5.
4. **Plano B apenas como ponte.** Cotar também BSPs de mensalidade fixa antes de qualquer migração permanente (`contingencia-canal.md`).
5. **Preço de fundador** sempre acima do custo variável do uso intenso com Twilio (R$ 74), para o piloto não virar prejuízo contínuo.

## 8. O que medir no piloto (alimenta as premissas)

- Mensagens recebidas e enviadas por restaurante por dia (premissa mais sensível).
- Quantas mensagens enviadas saem por mensagem recebida (perguntas de volta e correções).
- Mix real de texto, áudio e foto, e duração média do áudio.
- Porcentagem de casos que sobem para o Sonnet.
- Custo real por foto e por consulta (hoje estimados).
- Taxas reais do gateway de pagamento e do imposto (Matheus).

O painel interno (RF38, F10) já está previsto para mostrar custo de IA por empresa; falta incluir o WhatsApp.

## 9. A confirmar ⚠️

- Tarifa da Meta em reais para mensagens de serviço no Brasil e a regra das 1.000 gratuitas (cartão de tarifas oficial).
- Preço do `gpt-transcribe` e do cache do Haiku 5.5 (`pricing.ts`).
- Custo por foto e por consulta (medir com a chave da Anthropic já corrigida).
- Imposto e taxa de pagamento reais (Matheus, que é contador).
- Custos de hospedagem: AWS contra Fly.io mais R2 (`luis.md` seção 4), sem valores hoje.
- Preços de concorrentes (sistemas de gestão financeira para restaurante e contabilidade online): não pesquisados, são âncora de preço.

## 10. Como recalcular

Custo variável em dólares = IA + (mensagens enviadas × 0,0068) [+ (mensagens recebidas + enviadas) × 0,005 com Twilio]. Em reais, multiplicar pelo câmbio. Margem = (preço × 0,90 − custo em reais) ÷ preço. Preço mínimo = custo em reais ÷ (0,90 − margem desejada). Trocar as premissas da seção 2 e refazer as tabelas.
