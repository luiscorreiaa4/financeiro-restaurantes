# Pendências em aberto do projeto

Levantamento de **30/10/2026**, depois da E9 do canal WhatsApp. Reúne o que está aberto nos planos (`plano-dev-canal-whatsapp.md`, `plano-dev-frontend.md`), em `requisitos.md` (P01 a P15), no `TODOLIST.md` e o que ficou pendente nas etapas E6 a E9.

Este arquivo é um **índice**: a regra de negócio continua em `requisitos.md`, o porquê em `decisoes.md` e a ordem de execução nos planos. Ao fechar uma pendência, marque aqui e atualize a fonte.

Legenda: 🔴 bloqueia algo · 🟡 vale a proposta provisória até decidirem · ⚪ sem bloqueio

## Resumo: o que está feito e o que falta

| Frente | Situação |
|---|---|
| Canal WhatsApp E1 a E9 | Feitas (E3 com ressalva da mensagem real; E9 com a ressalva de áudio e foto nunca testados com mídia real) |
| Canal WhatsApp E10 a E13 | A fazer. A E10 é a que liga o WhatsApp real e está bloqueada pela Meta |
| Painel web F0 a F11 | Nada feito. A F0 pode começar já |
| Negócio, jurídico e validação | Quase tudo em aberto (seção 2) |

---

## 1. Bloqueios externos 🔴

| Item | Dono | O que bloqueia | Onde |
|---|---|---|---|
| **P15, parte 1**: publicar o app da Meta (modo Live) para as mensagens do celular chegarem ao webhook | Luís | Teste real da E3 e a E10 | `plano-dev-canal-whatsapp.md`, "Pendências da Meta" |
| **P15, parte 2**: resolver o erro 130497 (forma de pagamento, perfil completo, verificação da empresa com o CNPJ) | Luís e Matheus (CNPJ) | Envio real de respostas e a E10 | idem |
| Número de WhatsApp definitivo e nome de exibição | Luís | E10 | idem |
| Abrir o CNPJ | Matheus | Verificação da empresa na Meta | `TODOLIST.md`, seção 2 |
| Criar a **chave da OpenAI** (`OPENAI_API_KEY`) | Luís | Só o **áudio** (transcrição). Texto e foto funcionam só com a chave da Anthropic | `TODOLIST.md`, seção 3 |

> Sem a chave da OpenAI não dá para testar áudio, só ele. O texto, a correção, o desfazer, os limites e a foto (leitura pela IA e QR) usam apenas a Anthropic.

---

## 2. Decisões do Matheus (P01 a P11) 🟡

Nenhuma bloqueia o desenvolvimento (DN-11): onde há `[PROVISÓRIO – Pxx]`, o código usa a proposta escrita, isolada em constante única.

| ID | Pendência | Proposta que está valendo | Onde está no código |
|---|---|---|---|
| P01 | Plano de categorias definitivo; categoria única "Vendas" separada por canal | Lista provisória do seed (DE-02) | `packages/db/src/system-categories.ts` |
| P02 | Regra de investimento × despesa (valor mínimo, vida útil) e quando a IA pergunta | Itens de equipamento e reforma como investimento; sem pergunta | Ainda não implementado |
| P03 | Planos, preços, limites por plano, duração do teste (**Ambos**) | 180 s de áudio, 5 MB de imagem, 60 mensagens por usuário por hora, 1.000 por empresa por dia; 300 e 1.000 consultas | `packages/core/src/media/limits.ts` |
| P04 | Quais faltas geram pergunta antes de gravar | Valor, tipo não inferível, data ambígua e **quantidade só para carne, peixe, fruto do mar e hortifruti por peso** (DE-15, proposta nossa) | `packages/core/src/entry/interpret.ts`, `packages/ai/src/extraction/prompt.ts` |
| P05 | Impostos sobre faturamento por regime | Lançados como despesa, sem cálculo | Painel (F4) |
| P06 | Comissão do aplicativo × taxa da forma de pagamento | Canal com comissão substitui a taxa da forma (DE-19) | `packages/core/src/entry/catalog.ts` |
| P07 | Formas de pagamento e canais padrão, taxas típicas | Dinheiro, Pix, Débito, Crédito, Voucher; Salão, Delivery próprio, iFood, Retirada | `packages/db/src/dev-seed.ts` (só dev; o cadastro real é da F6) |
| P08 | Revisão dos textos do WhatsApp e contato de suporte real | Rascunhos conforme os RFs | `apps/api/src/modules/inbound/messages.ts`, `apps/api/src/modules/entries/messages.ts`; `SUPPORT_CONTACT` vazio |
| P09 | Indicadores do dono além de margem, CMV % e folha % | Só esses três no MVP | Painel (F4) |
| P10 | Resumos predefinidos pelo WhatsApp entram no MVP? (**Ambos**) | Antecipar se couber | E12 |
| P11 | Viabilidade da NF-e por certificado A1 | Só depois de validar (Fase 2) | RF32 |

Também com o Matheus, fora do P01 a P11:
- [ ] Coletar 20 a 50 mensagens reais (texto, **áudio de cozinha**, foto de nota) para os evals (RNF07).
- [ ] Conferir a **tolerância de 1 centavo** na conta quantidade × preço × total (D6, E1).

---

## 3. Decisões conjuntas e negócio (Ambos e Matheus)

Do `TODOLIST.md`; nenhuma tem prazo de código, mas várias travam o piloto.

**Decisões conjuntas**
- [ ] Nome do produto (domínio, redes sociais, INPI) e identidade visual básica.
- [ ] Divisão societária e responsabilidades formais (quem é o DPO).
- [ ] Escolher os 2 ou 3 restaurantes do "mágico de Oz" e os 5 a 10 do piloto.
- [ ] Critérios de sucesso do piloto (hábito, 4 dias por semana, precisão acima de 90%).
- [ ] Revisão semanal de 30 minutos do `TODOLIST.md`.

**Jurídico e operação**
- [ ] Advogado: Termos de Uso, Política de Privacidade e DPA (aceite no cadastro, RF01.R13).
- [ ] Política de retenção e cancelamento (90 dias de acesso após cancelar; áudio por 90 dias).
- [ ] Plano de resposta a incidentes (ANPD e clientes).
- [ ] Meio de cobrança (Pix recorrente, Asaas, Stripe) e nota fiscal do nosso serviço (RF37).
- [ ] Preço de fundador para os pilotos e canal de suporte com horário.

**Pesquisa e validação**
- [ ] 10 a 15 restaurantes para entrevista, roteiro e consolidação.
- [ ] Open Finance (Pluggy, Belvo), formatos de exportação dos sistemas contábeis, PDVs mais usados, concorrentes e tamanho de mercado.
- [ ] Teste "mágico de Oz" de 2 a 4 semanas.
- [ ] Conteúdo do DRE gerencial, do pacote para o contador, do resumo semanal e dos alertas.

**Go-to-market**
- [ ] Página de captura, demo de 3 minutos, programa de indicação para contadores, material de onboarding.

**Em aberto sem responsável**
- [ ] Falar com o Leo.

---

## 4. Canal WhatsApp: pendências técnicas por etapa

### E3 (webhook)
- [ ] 🔴 Mensagem real do celular virar linha em `inbound_messages` e o reenvio não duplicar (depende de P15).
- [ ] Trocar as fixtures sintéticas pelos payloads reais anonimizados (texto recebido e `status: failed` 130497).
- [ ] Conferir o `redact` do Pino na documentação.
- [ ] Script de carga do webhook em rajada (antes do piloto).

### E4 (fila)
- [ ] Confirmar a política de retry (5 tentativas, backoff de 10 s a 160 s) e o lote de 5.
- [ ] Rodar o worker uma vez contra o Postgres do Compose (os testes usam Testcontainers).
- [ ] Teste real de queda do processo (`kill`) em staging.
- [ ] Alerta e monitoramento da DLQ (E10).

### E5 (identificação)
- [ ] Definir o `SUPPORT_CONTACT` real (junto do P08).
- [ ] Confirmar a regra do "vínculo mais antigo" com usuário em dois restaurantes (DE-07).
- [ ] Conferir a regra de "IA de propósito geral" da Meta antes da E10 (a página consultada não a traz; a recusa fora do escopo é decisão nossa).

### E6 a E9 (feitas em 30/10/2026)
- [ ] **Testar áudio de verdade** (chave da OpenAI, ffmpeg instalado e um áudio real de cozinha). Hoje só foi testado com ffmpeg e transcritor de mentira.
- [ ] **Testar foto de verdade** com cupom fiscal real e com QR legível.
- [ ] Confirmar o **preço do `gpt-transcribe`** (hoje estimativa de US$ 0,006 por minuto em `pricing.ts`) e o preço de escrita e leitura de cache do Haiku 5.5.
- [ ] Instalar o **ffmpeg** no servidor da API e do worker (dependência de sistema).
- [ ] **S3** (`S3MediaStore`) e a **retenção de 90 dias do áudio** por regra de ciclo de vida do bucket (RF13.R4). Hoje a mídia vai para disco só em desenvolvimento.
- [ ] **Consulta à SEFAZ** pelo QR (RF14.R5): depende do estado do piloto. Hoje a nota é lida só pela IA e fica `needs_recheck = true`.
- [ ] `trocar unidade`, `trocar empresa` e **empresa citada no texto** (RF11.R5, RF19): dependem das Unidades de Acesso (E11, P13).
- [ ] Correção por reply **não cria fornecedor novo**; só aceita fornecedor já cadastrado.
- [ ] A pergunta de volta vencida só vira `expired` quando outra pergunta abre; falta um job que feche as vencidas (RF15.R4).
- [ ] Rodar os **evals no CI** (precisa do segredo da Anthropic) e trocar os 39 casos inventados pelos reais; o 100% atual é otimista.
- [ ] Revisar os limites de 180 s, 5 MB, 60 por hora e 1.000 por dia (P03).

### E10 (envio real e operação) 🔴
- [ ] `CloudMessageSender` e `MetaMediaDownloader` no lugar dos adaptadores de desenvolvimento (`CHANNEL_MODE=whatsapp`); o downloader já existe em `packages/whatsapp`, falta ligar na composição.
- [ ] Janela de 24 horas, templates aprovados, status de entrega, limites de mídia reais.
- [ ] Comandos `parar` e `voltar` com revogação do opt-in e prova de consentimento (P14).
- [ ] Cotas de consultas por plano com aviso em 80% e recusa em 100% (RF21.R3, P03) e alerta de custo de IA (RF21.R4).
- [ ] **D4**: build de produção da API e dos workers.
- [ ] Sentry, logs sem PII (RNF11), backup com teste de restauração (RNF06), deploy em staging e produção (hospedagem em São Paulo e S3 compatível).
- [ ] Rodar o roteiro do chat de desenvolvimento de novo, agora pelo celular, em staging.

### E11 a E13 (a fazer)
- [ ] **E11**: papéis e permissões adicionais, matriz da seção 2.3 como teste, **Unidades de Acesso em lista** (P13), tipo do canal `APLICATIVO`, campos de unidade, categoria e lançamento (RF04 a RF09). Fecha as divergências listadas em `arquitetura.md`.
- [ ] **E12** (v1.1): relatórios pelo WhatsApp por hierarquia (RF20); resumos predefinidos podem vir antes (P10).
- [ ] **E13** (v1.1): lançamentos recorrentes (RF33), resumo semanal e alertas (RF34), importação (RF35), NF-e por e-mail (RF31).

---

## 5. Painel web (F0 a F11): nada feito

| Etapa | O que entrega |
|---|---|
| F0 | Fundação do web (pode começar já) |
| F1 | Autenticação e sessão: autocadastro, senha ou código, recuperação (RF01 a RF03). Prova de conceito do Better Auth com Fastify antes |
| F2 | Conta, unidade e permissões (RF02.R6, RF06) |
| F3 | Lançamentos: lista, filtros, edição, lixeira de 30 dias, origem e histórico (RF22 a RF25). A ação `restore` já existe no `core` e no banco |
| F4 | Dashboard e indicadores (RF27; P05 e P09) |
| F5 | Exportação XLSX e CSV (RF29); escolher a biblioteca (D-F7) |
| F6 | Configurações: unidades, colaboradores, categorias, formas de pagamento, canais e fornecedores (RF04 a RF10) |
| F7 | PWA e responsividade |
| F8 | Endurecimento e lançamento |
| F9 | Assinatura, plano e encerramento da conta (RF37; P03) |
| F10 | Painel interno de custo de IA e saúde da fila (RF38) |
| F11 | v1.1: lançamento manual, DRE em PDF, perguntas em linguagem natural (RF26, RF28, RF30) |

- [ ] **P12**: ajustes do plano feitos em 29/10; falta **implementar** na F1, F2 e F6 (autocadastro, login por senha, papel Contador).
- [ ] D-F7 (biblioteca de planilha) e as decisões D-F marcadas como abertas.

---

## 6. Fundação e documentação

- [ ] **CI no GitHub Actions**: o workflow está escrito, falta rodar. Depois, os jobs de integração, evals e migrations (seção 5.3 do plano do canal).
- [ ] Contas: OpenAI, Sentry, hospedagem e S3.
- [ ] Estimar o custo de IA por restaurante com mensagens reais (referência: até US$ 5 por restaurante por mês, RNF08.R2).
- [ ] Atualizar `docs/arquitetura.md`: tabela `fiscal_documents`, colunas novas (`entries.flags`, `ai_usage.cache_*`, `pending_questions.status`), ação `restore` e os índices de envio único.
- [ ] Atualizar `docs/mvp.md` e `docs/requisitos.md` se os sócios aceitarem as propostas P04 e P06 (subir a versão no topo, conforme o CLAUDE.md).
- [ ] Mostrar o projeto ao sócio: ficará melhor depois que o painel existir (F0 a F4). Até lá, o `pnpm dev:chat` e o `docs/guia-testes-e6-e9.md` servem para o seu teste.
- [ ] Processo de mudar prompt: rodar o eval antes e depois e registrar no PR (RNF07.R4). O comando existe; falta o hábito no fluxo de PR.

---

## 7. Pós-MVP (sem dono ainda)

Perguntas em linguagem natural (RF30) · relatórios por hierarquia (RF20) · resumo semanal e alertas (RF34) · DRE e fechamento mensal em PDF (RF28) · recorrentes (RF33) · lançamento manual (RF26) · NF-e por e-mail (RF31) e por certificado A1 (RF32) · importação de planilhas, OFX e relatórios de PDV e iFood (RF35) · perfil Contador multicliente (RF36) · Open Finance e API do iFood · precificação sugerida por prato.
