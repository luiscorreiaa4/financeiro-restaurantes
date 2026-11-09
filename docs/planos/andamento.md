# Andamento do projeto

> **Papel deste documento:** o painel geral, para os dois sócios: o que já existe, o que vem agora, o que está travado e as pendências técnicas abertas. As tarefas de cada um estão em [`matheus.md`](matheus.md) e [`luis.md`](luis.md) (arquivos locais). A ordem das etapas de código está em [`canal-whatsapp.md`](canal-whatsapp.md) e [`painel.md`](painel.md). As regras continuam em [`../requisitos.md`](../requisitos.md) e o porquê em [`../decisoes.md`](../decisoes.md).
>
> Ao fechar uma pendência, marque aqui e atualize a fonte.

Atualizado em 09/11/2026 (F0 e F1a do painel feitas; a reunião de descoberta de 05/11/2026 ampliou o escopo). O escopo do MVP cresceu: ver [`../DESCOBERTA.md`](../DESCOBERTA.md) e as decisões DD-01 a DD-16 em [`../decisoes.md`](../decisoes.md).

Legenda: 🔴 trava algo · 🟡 vale a proposta provisória · `[ ]` a fazer · `[x]` feito

## 1. Resumo

| Frente | Situação |
|---|---|
| Fundação (fase 0) | Pronta. CI no GitHub rodou verde em 09/11/2026 (inclusive `e2e` e `integration`) |
| Canal WhatsApp E1 a E9 | **Feitas.** Ressalvas: E3 sem mensagem real do celular (Meta); E9 com áudio e foto testados só com simulação |
| Canal WhatsApp E10 a E14 | **E11 quase feita** (dados e domínio de 06/11/2026; `trocar unidade`, `trocar empresa` e empresa citada no texto de 09/11/2026, DE-25; evals resolvidos em 09/11/2026; falta o contador só por e-mail e as pendências menores do review); a E10 está travada pela Meta. E12 (resumos fixos) e E14 (importações e XML) entraram no MVP |
| Painel web F0 a F13 | **F0 (06/11/2026) e F1a (09/11/2026) feitas**; F1b, F1c e F2 a F13 a fazer, **F1b é a próxima**. F12 (imposto estimado e DRE) e F13 (contador, importações e XML) entraram no MVP |
| Negócio, jurídico e validação | Quase tudo em aberto ([`matheus.md`](matheus.md)) |

## 2. O que já existe, de fato

Dá para "conversar" com o sistema pelo terminal (`pnpm dev:chat`), sem WhatsApp, e ver os lançamentos irem para o banco. Roteiro em [`guia-testes-manuais.md`](guia-testes-manuais.md).

- **Recebimento:** webhook do WhatsApp com assinatura conferida, sem gravar duas vezes a mesma mensagem, responde em menos de 1 s. Testado com o botão Teste da Meta.
- **Fila:** processamento em segundo plano, 5 novas tentativas em caso de falha, fila de mensagens que falharam de vez, desligamento sem perder mensagem.
- **Quem escreveu:** identifica o colaborador pelo telefone (com ou sem o 9º dígito), recusa número desconhecido ou desativado com a mesma resposta, registra o consentimento (opt-in).
- **IA:** entende texto livre e grava um ou vários lançamentos. Haiku 5.5 por padrão, Sonnet 5.5 nos casos difíceis. Cerca de **US$ 0,0004 por mensagem**, medido por empresa.
- **Lançamento:** grava com versão e origem, calcula taxa e líquido (a IA nunca faz conta), confirma, pergunta de volta quando falta algo essencial, aceita correção por resposta, `desfazer` (24 h), `cancelar`, `ajuda` e `suporte`, avisa possível duplicidade.
- **Áudio e foto:** transcrição de áudio (até 3 min), leitura de cupom fiscal pela IA, QR Code da NFC-e para não lançar a mesma nota duas vezes, itens agrupados por categoria, limites de uso.
- **Qualidade:** 39 casos de teste da IA com 100% de acerto (otimista: os casos foram inventados); centenas de testes automáticos no núcleo, no banco e na API; testes de arquitetura.
- **Banco:** 18 tabelas em 6 migrations (`0000` a `0005`), isolamento por empresa no próprio Postgres (RLS), testado tabela por tabela.

## 3. Próximos passos

1. **E11 (canal): modelo de dados dos requisitos** (mudança `e11-modelo-de-dados`, iniciada ainda no OpenSpec; o registro está em `openspec/changes/e11-modelo-de-dados/`). Quatro papéis (o contador já no MVP, vendo folha) e permissões adicionais, matriz de permissões como teste, unidades de acesso em lista (P13), campos novos de unidade (canal padrão), categoria e lançamento (`paid_on`, `orders`, `CANAL_A_REVISAR`), tabelas de imposto por vigência; destrava `trocar unidade`, `trocar empresa` e empresa citada no texto. Detalhe em [`canal-whatsapp.md`](canal-whatsapp.md).
2. **F1b (painel): autocadastro do dono.** A F1a (login por código e por senha) está feita. A F1b precisa de migration com INSERT e política para `app_auth` em `users`, `memberships` e `tenants`. Planejar com o Superpowers (`brainstorming` ou `grilling`, depois `writing-plans`); a F1c (recuperação, perfil e lista de sessões) vem depois. As etapas seguintes do painel (F2 a F6, F12 e F13) seguem o mesmo fluxo.
3. ~~**Rodar o CI no GitHub**~~ (feito em 09/11/2026, tudo verde), agora também com os jobs novos `e2e` e `integration` (a suíte de integração nunca tinha rodado no CI; localmente passou: db 179 e api 88).
4. **Testar áudio e foto reais** (precisa da chave da OpenAI e do ffmpeg).
5. **Matheus:** CNPJ, nome, mensagens reais, textos do WhatsApp ([`matheus.md`](matheus.md), seção 1).
6. **Matheus (novas pendências da reunião de 05/11/2026):** P16 (parâmetros e fórmulas de imposto por regime e se a estimativa entra no Resultado), P17 (vigências da reforma tributária), P18 (regras do XML manual), P01 (lista de categorias com Natureza FIXA/VARIAVEL), P03 (planos e preços), P04 (essenciais, agora com canal e pedidos). Detalhe em [`../DESCOBERTA.md`](../DESCOBERTA.md).

## 4. Travado por fora 🔴

| Item | Dono | O que trava |
|---|---|---|
| **P15, parte 1:** publicar o app da Meta para as mensagens do celular chegarem | Luís | Teste real da E3 e a E10 |
| **P15, parte 2:** erro 130497 no envio | Luís; Matheus (CNPJ) | Respostas reais no WhatsApp e a E10 |
| Número de WhatsApp definitivo e nome de exibição | Luís | E10 |
| Abrir o CNPJ | Matheus | Verificação da empresa na Meta |
| Chave da OpenAI | Luís | Só o teste de áudio real |

Se o bloqueio da Meta durar, os planos B (provedor intermediário, como o Twilio), C (Telegram) e D (painel como entrada) e os gatilhos para acioná-los estão em [`contingencia-canal.md`](contingencia-canal.md) (DD-23).

## 5. Pendências técnicas do canal WhatsApp

### Das etapas feitas (E3 a E9)

- [ ] 🔴 E3: mensagem real do celular virar linha em `inbound_messages` sem duplicar no reenvio (P15).
- [ ] E3: trocar as fixtures sintéticas pelos payloads reais anonimizados (texto recebido e `status: failed` 130497).
- [ ] E3: conferir o `redact` do Pino na documentação; script de carga do webhook em rajada (antes do piloto).
- [ ] E4: confirmar a política de retry (5 tentativas, de 10 s a 160 s, teto de 300 s) e o lote de 5; rodar o worker contra o Postgres do Compose; teste real de queda do processo em staging.
- [ ] E5: confirmar a regra do "vínculo mais antigo" (DE-07); conferir a regra de "IA de propósito geral" da Meta antes da E10.
- [ ] E9: testar **áudio real** (cozinha, com ruído) e **foto real** de cupom com QR legível.
- [ ] E9: confirmar o preço do `gpt-transcribe` (estimativa de US$ 0,006 por minuto) e do cache do Haiku 5.5.
- [ ] Pergunta de volta vencida só vira `expired` quando outra abre; falta um job que feche as vencidas (RF15.R4).
- [ ] Correção por resposta não cria fornecedor novo (só aceita os já cadastrados). Confirmar se basta.
- [ ] Evals no CI (precisa do segredo da Anthropic) e casos reais no lugar dos inventados.

### Que já estão na E10 e na E11

- E10: `CloudMessageSender` e `MetaMediaDownloader` na composição (`CHANNEL_MODE=whatsapp`), janela de 24 h, templates, `parar` e `voltar` (P14), cotas e alerta de custo (RF21), S3 e retenção de 90 dias do áudio, consulta à SEFAZ, ffmpeg no servidor, decisão D4 (build), Sentry, backup, staging e produção.
- E11: ~~canal do tipo `APLICATIVO`~~ (feito em 06/11/2026).
- **E11, pendentes (mudança `e11-modelo-de-dados`, tarefas 3.8 e 7.3):**
  - [x] `trocar unidade`, `trocar empresa` e empresa citada no texto (RF11.R5, RF19): feito em 09/11/2026 (DE-25). A escolha mora no vínculo (`default_unit_id` e `preferred_at`), a lista numerada é pergunta pendente `choice` e a empresa citada é casada sem IA; áudio e foto não trocam de empresa pelo texto. Migration `0013`. Testes: `apps/api/test/switch-flow.int.test.ts` (RF19.CA03 e RF11.R5).
  - [x] **Evals da E11 resolvidos em 09/11/2026 (Luís), baseline atualizado.** A primeira rodada (50 casos) tinha `askRecall` 1 → 0,75: `a03` e `a08` eram gravados sem perguntar. Causas: (a03) a regra 12 (`paid_on`) usava "paguei dia 3" como exemplo e o modelo passou a pôr "paguei ... amanhã" em `paid_on`, que não passa pela checagem de data futura; o certo é perguntar (RF12.R2, RF12.CA07), então o dataset estava certo. (a08) provável diluição da regra 8 pelas regras 12 a 15, sem exemplo de carne com valor e sem peso (RF12.CA04); hipótese, o experimento com o prompt do baseline não foi necessário porque a correção resolveu. Correção só em `packages/ai/src/extraction/prompt.ts` (regras 8 e 12) e dois testes em `prompt.test.ts`. Rodada completa final: 50 casos, 100% em todas as métricas (`askRecall` 1, `n01` a `n04` ok), US$ 0,0102. Uma rodada intermediária falhou o `a05` ("vendi") uma vez na intenção; 3 reexecuções isoladas e a rodada final passaram, então foi oscilação do modelo (vigiar se repetir).
  - [ ] Contador criado só por e-mail: `users.phone_e164` passa a opcional na F1a (DD-20); falta o ajuste no canal (identificação, tipos, seed e testes) e a regra de domínio que exige celular do dono e dos colaboradores do WhatsApp.
  - [ ] Pendências menores do review da `trocar unidade`/`trocar empresa` (DE-25), nenhuma corrigida:
    - "cancelar" com a lista numerada aberta responde "descartei o lançamento pendente" (`entry-handlers.ts`, `cancel`); precisa de texto próprio para `kind = choice`.
    - Se o envio do "Pronto!" falhar e o job for repetido depois do `apply`, o número vai para a IA (a pergunta já está `answered`).
    - `ChoiceStore.apply` fecha a pergunta sem filtrar `status = 'open'` e não exige unidade ativa na escolha (`choice-store.ts`).
    - Nome de empresa com palavra comum ("Bar", "Sabor") pode desviar mensagens, além do apelido genérico já citado na DE-25.
    - Roteiro manual do `pnpm dev:chat` (`trocar unidade`, `trocar empresa`, "no litoral") não foi exercitado; os mesmos cenários rodam em `switch-flow.int.test.ts`.
  - Depois de fechar as três (a pasta `openspec/changes/e11-modelo-de-dados/` fica como registro, sem arquivar): marcar a E11 como "Feita" nos planos e atualizar o `CLAUDE.md`.

## 6. Painel

**F0 feita em 06/11/2026 e F1a em 09/11/2026**; F1b, F1c e F2 a F13 a fazer, a **F1b é a próxima**. Plano completo em [`painel.md`](painel.md) (resumo do que a F0 entregou e deixou para a F1 logo antes de "Fechamento de etapa").

- [ ] **P12:** os ajustes do plano (autocadastro, login por senha, papel Contador) foram escritos em 29/10; falta implementar na F1, F2 e F6.
- [ ] D-F7 (biblioteca de planilha) e as outras decisões D-F em aberto.
- **Pendências deixadas pela F0:**
  - [x] 🟡 Rodar no GitHub os jobs novos `e2e` e `integration`: **feito em 09/11/2026 (Luís), tudo verde.** É a primeira vez que a suíte de integração roda no CI; localmente passou (db 179, api 88). Se falhar, diagnosticar a causa real, sem enfraquecer teste. Dono: Luís (depende do push).
  - [ ] Decidir a **identidade visual** (marca, paleta, fonte). A F0 ficou neutra por decisão do Luís (D-F8); a troca é local, em `apps/web/app/globals.css`. Antes do piloto (F7 e F8).
  - [ ] Decidir o destino do `apps/web/AGENTS.md` (gerado pelo Next, não versionado): versionar, ignorar no `.gitignore` ou apagar.
  - [ ] Confirmar com o Luís que a base dos componentes do shadcn (`@base-ui/react`, preset `base-nova`) serve à F3 (tabela, formulário, drawer). Alternativa: refazer o `init` com `--base radix`.
  - [ ] Seguem ⚠️ no `painel.md`: prova de conceito do Better Auth com Fastify e `rewrites` (F1), `storageState` do Playwright (F1), manifest do PWA (F7), CSP e Web Vitals (F8), base do TanStack Table (F3).
  - [x] `apps/web/CLAUDE.md` criado (regras de cache, dinheiro, datas, testes e E2E do painel).
- **Pendências deixadas pela F1a (09/11/2026):**
  - [x] **Fluxo à mão feito em 09/11/2026 (Luís):** `.env` preenchido (`AUTH_SECRET`, `DATABASE_AUTH_URL`, `DEV_MAIL_DIR`), papel `app_auth` criado, migrations 0011 a 0013 aplicadas, `pnpm db:seed:dev` rodado e login testado em `http://localhost:3000/login` (passos 3.1 a 3.5 do guia da próxima sessão). Detalhes do que apareceu na tela não foram registrados.
  - [x] **Volumes Postgres existentes** não recebem o papel `app_auth` sozinhos: resolvido em 09/11/2026 rodando o `init.sql` no banco dev (é idempotente). Em outro volume antigo, repetir o comando ou recriar o volume.
  - [ ] F2: renovar o cookie de "manter conectado" (o Next não grava cookie em layout/server component; até lá ele vence 30 dias após o login) e tratar 401 na camada de dados redirecionando para `/login`.
  - [ ] F8: `trustProxy` e o IP real atrás do rewrite do Next; produção só sobe com autenticação (`DATABASE_AUTH_URL`) e e-mail reais configurados (sem chave liga/desliga).
  - [ ] F1b: o autocadastro precisa de INSERT em `users`, `memberships` e `tenants` para `app_auth`.
  - [ ] Fila de e-mail: o envio do código roda em memória por processo, sem fila persistente (DD-21); trocar na F8.
  - [ ] Minors do review da F1a (deferidos): juntar 0011 e 0012 numa migration antes de ir para produção; `email_hash` sem CHECK de formato e sem índice `(user_id, created_at)` em `auth_audit`; `users.updated_at` sem `$onUpdate`; UPDATE de `users` em nível de tabela para `app_auth`; `onError` que lança vira unhandled rejection; `apps/web/AGENTS.md` ainda não rastreado (decidir `.gitignore`).
  - [x] `users.phone_e164` opcional no esquema (DD-20); falta o lado do canal (seção 5).
- [ ] Reunião de 05/11/2026: F2 e F6 passam a cobrir o contador (convite com aviso de folha) e o canal padrão da unidade; F4 ganha ticket médio, ponto de equilíbrio e imposto estimado; F12 e F13 são etapas novas. Planejar com os sócios antes de abrir a F0 se quiserem encaixar as telas novas.
- [ ] Antes de iniciar a E11, sugerido reler `arquitetura.md` (divergências atualizadas) e abrir as migrations de `paid_on`, `orders`, canal padrão e `tax_*`.

## 7. Documentação

- [ ] Atualizar `arquitetura.md`: tabela `fiscal_documents`, colunas novas (`entries.flags`, `ai_usage.cache_*`, `pending_questions.status`), ação `restore` e os índices de envio único.
- [ ] Se os sócios aceitarem as propostas de P04 e P06, levar para `requisitos.md` (subindo a versão) e para `escopo-por-fase.md`. (P06 e P07 foram mantidas provisórias em 05/11/2026, DD-15.)
- [x] Fluxo de cada etapa trocado de OpenSpec para Superpowers em 06/11/2026 (DD-18); `CLAUDE.md`, planos, `README` e guias atualizados.
- [ ] Limpar o que sobrou do OpenSpec, se o Luís confirmar: `.claude/commands/opsx/`, `.claude/skills/openspec-*` e `openspec/` (config e specs). Manter `openspec/changes/e11-modelo-de-dados/` até fechar a E11, que guarda a pergunta de design aberta.
- [ ] `planos/guia/contabilidade-restaurante-plano-do-zero.md` (roteiro genérico, já marcado como superado) ainda traz exemplos com `/opsx:*`; reescrever ou apagar.
- [ ] Corrigido em 05/11/2026: o `andamento.md` citava "F0 a F11" e o `CLAUDE.md` "F0 a F10"; agora ambos dizem F0 a F13 e E1 a E14.
