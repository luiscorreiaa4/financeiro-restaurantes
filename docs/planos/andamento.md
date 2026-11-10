# Andamento do projeto

> **Papel deste documento:** o painel geral, para os dois sócios: o que já existe, o que vem agora, o que está travado e as pendências técnicas abertas. As tarefas de cada um estão em [`matheus.md`](matheus.md) e [`luis.md`](luis.md) (arquivos locais). A ordem das etapas de código está em [`canal-whatsapp.md`](canal-whatsapp.md) e [`painel.md`](painel.md). As regras continuam em [`../requisitos.md`](../requisitos.md) e o porquê em [`../decisoes.md`](../decisoes.md).
>
> Ao fechar uma pendência, marque aqui e atualize a fonte.

Atualizado em 10/11/2026 (F0, F1a, F1b e F1c do painel feitas, ajuste do cadastro DD-28 commitado, migrations 0015 e 0016 aplicadas no dev; a reunião de descoberta de 05/11/2026 ampliou o escopo). O escopo do MVP cresceu: ver [`../DESCOBERTA.md`](../DESCOBERTA.md) e as decisões DD-01 a DD-16 em [`../decisoes.md`](../decisoes.md).

Legenda: 🔴 trava algo · 🟡 vale a proposta provisória · `[ ]` a fazer · `[x]` feito

## 1. Resumo

| Frente | Situação |
|---|---|
| Fundação (fase 0) | Pronta. CI no GitHub rodou verde em 09/11/2026 (inclusive `e2e` e `integration`) |
| Canal WhatsApp E1 a E9 | **Feitas.** Ressalvas: E3 sem mensagem real do celular (Meta); E9 com áudio e foto testados só com simulação |
| Canal WhatsApp E10 a E14 | **E11 feita em 09/11/2026** (dados e domínio de 06/11/2026; `trocar unidade`, `trocar empresa` e empresa citada no texto, DE-25; contador só por e-mail e pendências do review, DE-26; evals resolvidos); a E10 está travada pela Meta. E12 (resumos fixos) e E14 (importações e XML) entraram no MVP |
| Painel web F0 a F13 | **F0 (06/11/2026), F1a, F1b e F1c (09/11/2026) feitas**; F2 a F13 a fazer, **F2 é a próxima**. F12 (imposto estimado e DRE) e F13 (contador, importações e XML) entraram no MVP |
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

1. ~~**E11 (canal): modelo de dados dos requisitos**~~ (feita em 09/11/2026, DE-25 e DE-26; mudança `e11-modelo-de-dados`, iniciada ainda no OpenSpec; o registro está em `openspec/changes/e11-modelo-de-dados/`). Quatro papéis (o contador já no MVP, vendo folha) e permissões adicionais, matriz de permissões como teste, unidades de acesso em lista (P13), campos novos de unidade (canal padrão), categoria e lançamento (`paid_on`, `orders`, `CANAL_A_REVISAR`), tabelas de imposto por vigência; destrava `trocar unidade`, `trocar empresa` e empresa citada no texto. Detalhe em [`canal-whatsapp.md`](canal-whatsapp.md).
2. ~~**F1b (painel): autocadastro do dono**~~ e ~~**F1c (recuperação, perfil e sessões)**~~ (feitas em 09/11/2026, DD-25, DD-26 e DD-27). Próxima do painel: **F2**; planejar com o Superpowers (`brainstorming` ou `grilling`, depois `writing-plans`). As etapas seguintes do painel (F3 a F6, F12 e F13) seguem o mesmo fluxo.
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
  - [x] **Contador criado só por e-mail, feito em 09/11/2026 (DE-26).** `validateAccess` exige celular de dono, gerente e lançador (`PhoneRequired`); `resolveSender` ignora vínculos de contador (quem só é contador é "desconhecido"); Contadora Demo (`contadora@demo.dev`, sem celular) no seed. Testes: `access.test.ts`, `sender.test.ts`, `dev-seed.int.test.ts`, `route-inbound.int.test.ts`.
  - [x] Pendências menores do review da `trocar unidade`/`trocar empresa` (DE-25), **corrigidas em 09/11/2026 (DE-26)**, menos o roteiro manual:
    - [x] "cancelar" com a lista numerada aberta agora responde "deixei a troca de lado" (`entry-handlers.ts`, `cancel`).
    - [x] A pergunta só fecha depois do "Pronto!" (`answerChoice`); se o envio falhar, o job repetido reaplica a escolha.
    - [x] `ChoiceStore.apply` não fecha mais a pergunta e exige unidade ativa (`choice-store.ts`).
    - [x] Nome de empresa só com palavras comuns ("Bar", "Sabor") não troca a empresa (`COMMON_COMPANY_WORDS` em `cited-place.ts`). Segue possível falso positivo com apelido genérico de unidade (DE-25).
    - [ ] Roteiro manual do `pnpm dev:chat` (`trocar unidade`, `trocar empresa`, "no litoral", `cancelar` com a lista aberta; passos na seção 3 do `guia-testes-manuais.md`) ainda não foi exercitado à mão; os mesmos cenários rodam em `switch-flow.int.test.ts`. Dono: Luís.
  - E11 marcada como "Feita" nos planos e no `CLAUDE.md` em 09/11/2026 (a pasta `openspec/changes/e11-modelo-de-dados/` fica como registro, sem arquivar).

## 6. Painel

**F0 feita em 06/11/2026, F1a, F1b e F1c em 09/11/2026**; F2 a F13 a fazer, a **F2 é a próxima**. Plano completo em [`painel.md`](painel.md) (resumo do que a F0 entregou e deixou para a F1 logo antes de "Fechamento de etapa").

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
  - [x] F1b: INSERT em `users`, `memberships` e `tenants` para `app_auth`: feito na migration 0014 (09/11/2026, DD-25).
  - [ ] Fila de e-mail: o envio do código roda em memória por processo, sem fila persistente (DD-21); trocar na F8.
  - [ ] Minors do review da F1a (deferidos): juntar 0011 e 0012 numa migration antes de ir para produção; `email_hash` sem CHECK de formato e sem índice `(user_id, created_at)` em `auth_audit`; `users.updated_at` sem `$onUpdate`; UPDATE de `users` em nível de tabela para `app_auth`; `onError` que lança vira unhandled rejection; `apps/web/AGENTS.md` ainda não rastreado (decidir `.gitignore`).
  - [x] `users.phone_e164` opcional no esquema (DD-20) e o lado do canal (DE-26, seção 5).
- **Pendências deixadas pela F1b (09/11/2026, DD-25):**
  - [ ] Roteiro à mão do cadastro (Luís): `pnpm dev`, `http://localhost:3000/cadastro`, ler o código na pasta `DEV_MAIL_DIR`, concluir e entrar no painel.
  - [ ] `NEXT_PUBLIC_WHATSAPP_NUMBER` precisa estar em `apps/web/.env.local` (o web não lê o `.env` da raiz; sem ele o `/bem-vindo` mostra "não foi configurado"). Exigir a variável no deploy (F8/E10); hoje o build só recusa valor inválido. O `.env.example` já documenta.
  - [ ] **P07 (Matheus):** a lista padrão de formas e canais do RF08.Obs2 e RF09.Obs2 não traz "Não informada" nem "Não informado", que o RF08.Obs4, o RF12.R8 e o RF09.Obs3 usam. O cadastro cria as duas (`SIGNUP_DEFAULTS`); confirmar (nota na v1.4 de `requisitos.md`).
  - [ ] Texto final dos Termos e da Política de Privacidade (os de hoje são rascunho com aviso na página) e `LEGAL_VERSIONS` (placeholder "2026-11-09") em `packages/core/src/signup/signup-defaults.ts`; é dos sócios e do jurídico.
  - [ ] `trustProxy` no Fastify, para o cadastro (`/api/signup/*`, `/api/companies`) e para o login (`/api/auth/*`): atrás do rewrite do Next toda requisição chega com o IP do servidor do Next, e o limite "por IP" vira um limite global. Junto da F8.
  - [ ] Limpeza periódica de linhas vencidas de `signup_verifications` (hoje só crescem); job do pg-boss ou `DELETE` agendado (F8).
  - [ ] Sondagem de celular e CNPJ em uso: o comprovante só é gasto quando a conta é criada, então um comprovante válido permite sondar `PHONE_TAKEN` e `CNPJ_TAKEN` (409) sem limite durante 30 min; `POST /api/companies` também não tem limite para quem está logado. Plano, antes de ir ao ar: contar as criações recusadas por comprovante (queimar depois de N = 3) e pôr limite por IP nas duas rotas.
  - [ ] Sem conferência de `Origin` em `POST /api/signup` e `POST /api/companies` (mitigado pelo cookie `SameSite=Lax` e por só aceitarem JSON). Na F8, gancho `onRequest` que compara `Origin` com `APP_URL`.
  - [ ] `tax_settings.valid_from` usa a data em `America/Sao_Paulo` mesmo para unidades em Manaus ou Rio Branco (diferença de no máximo um dia na data de início).
  - [ ] GRANT e política de INSERT em `membership_units` para `app_auth` não são usados pelo código (o dono tem `all_units`); avaliar retirar numa migration futura (menor privilégio).
  - [ ] Consulta pública de CNPJ (RF01.R2, Obs1 "opcionalmente"): sugestão sem etapa; hoje o CNPJ só passa pelo dígito verificador.
  - [ ] `GET /api/me` devolve só `userId`, `name` e `email` e ignora `memberships.preferred_at`; na F2 (empresa ativa do painel) usar a empresa mais recente pelo `preferred_at`, como o canal (`resolveSender`).
  - [ ] `timezoneForUf` (cadastro) mapeia alguns estados para fusos próprios (AL, BA etc.) e o resto para `America/Sao_Paulo`; conferir o mapa com o RF04.R4.
  - [ ] Usuário só com vínculos desativados não cria empresa (`/api/companies` dá 401, igual ao `/api/me`); decisão de produto se precisar permitir.
  - [x] Teste instável `apps/api/test/signup-code.int.test.ts` ("auditoria e logs..."): com o relógio congelado os dois eventos tinham o mesmo `created_at` e o desempate pelo id (UUID v7 sem contador) era sorteado; o teste agora avança 1 s entre o envio e a verificação (revisão final da F1b).
  - [ ] A API falsa do E2E (`apps/web/e2e/fake-api.mjs`) não espelha todos os erros do cadastro (só `INVALID_CODE`, `RECEIPT_INVALID`, `cnpj_invalid` e 401 de `/api/companies`); os demais ficam nos testes unitários e de integração.
  - [ ] Constantes duplicadas a juntar no `core`: `hashSignupEmail` e `hashEmail` (`signup-hashing.ts` e `create-auth.ts`); `MAX_CODE_ATTEMPTS` (`signup-store.ts`) e `allowedAttempts: 3` (Better Auth); `SIGNUP_CODE_TTL_MS` e `expiresIn: 300`; `DAY_MS` e `SIGNUP_TIME_ZONE` copiados em `create-account.ts` e `create-company.ts`.
- **Ajuste da tela de cadastro (DD-28) fechado em 10/11/2026** (commit `df12fa8`): `pnpm typecheck`, `pnpm lint` e `pnpm test` (1108), `pnpm test:int` (485: db 264, api 221) e E2E (58 passaram, 2 pulados por serem só do celular) verdes. Na rodada saíram o erro de tipo de `apps/web/e2e/login.spec.ts` (`noUncheckedIndexedAccess`) e o formato do Biome nos componentes novos (`combobox`, `input-group`, `textarea`); a árvore de trabalho foi normalizada para LF (F1c-11 segue aberta: falta um `.gitattributes`). O clique no adorno do `input-group.tsx` (foca o campo) não tem teste dedicado: conferir à mão.
- **Pendências deixadas pelo ajuste da tela de cadastro (10/11/2026, DD-28):**
  - [ ] CNPJ alfanumérico fora do cadastro: `accessKeyParts` da NFC-e (`packages/core/src/media/nfce.ts`, chave de acesso com 12 posições alfanuméricas no CNPJ do emitente), o chat de desenvolvimento (`apps/api/src/dev/chat-session.ts`) e `units.cnpj` (sem `check`, mas conferir leituras) ainda assumem CNPJ só numérico. Revisar na E9/E13 (RF14, RF31).
  - [ ] Roteiro à mão da tela de cadastro com leitor de tela (NVDA): ler dica e erro dos campos com máscara; conferir o cursor da máscara no celular real (Android e iOS).
- **Pendências deixadas pela F1c (09/11/2026, DD-26):**
  - [x] **Migrations `0015` e `0016` aplicadas no banco de dev em 10/11/2026 (Luís)** (`DATABASE_ADMIN_URL=... pnpm db:migrate`, que não lê o `.env`). Em outro banco de dev, repetir: sem a `0015`, concluir a recuperação e trocar o nome no perfil gravam a troca e depois devolvem erro, porque a auditoria recusa os eventos novos.
  - [x] **Feito em 10/11/2026 (DD-30):** auditoria que falha depois de gravar a senha ou o nome passa a ser tratada como sucesso, com a falha só no log e alerta no Sentry (`recover-password.ts`, `profile-service.ts`). Antes, o usuário via erro mesmo com a troca feita e, na recuperação, o link já gasto mostrava "Link inválido".
  - [ ] Troca do próprio e-mail (RF02.Obs3), adiada da F1c (DD-26): candidata à F6.
  - [ ] Sem limite de tentativas na rota da senha atual (`/api/profile/password`).
  - [ ] `/api/profile` é lido no navegador (TanStack Query) até a F2 criar a leitura autenticada no servidor.
  - [ ] Envio real do aviso de troca de senha e `trustProxy`/IP real: F8.
  - [x] **Feito em 10/11/2026 (DD-30):** todos os erros de código no login por código (`/api/auth/sign-in/email-otp`) viram `INVALID_OTP`, iguais para e-mail com e sem conta, com texto "código incorreto ou vencido; peça um novo" na tela. Antes, `TOO_MANY_ATTEMPTS` e `OTP_EXPIRED` diferiam e permitiam descobrir se o e-mail tem conta (RF02.R1). Não impede queimar o código da vítima com tentativas erradas; a recuperação por link (DD-27) não tem o problema.
  - [ ] Rotas `/api/profile/*` sem checagem própria de content-type e `Origin` (CSRF só protegido por `SameSite=Lax`).
  - [ ] Nome do perfil aceita caracteres invisíveis (ex.: U+200B).
  - [ ] Nome no menu do usuário só atualiza ao recarregar a página depois de salvar o nome.
  - [ ] Lint do monorepo acusa CRLF em arquivos antigos no checkout do Windows (índice em LF): ambiente, não código.
  - [ ] E2E local em paralelo: o teste "Sair" de `login.spec.ts` falha de vez em quando por corrida de hidratação (passa com `--workers=1`, como no CI).
  - [ ] Cota de envio compartilhada: o link de recuperação usa a mesma cota do código de login (5 por hora por e-mail, RF02.R4); quem pede link ou código repetidamente para a vítima esgota a do login por código dela. Risco conhecido, junto com os limites reais da F8.
  - [ ] `background.run` descarta tarefas quando a fila enche (`maxPending`): uma inundação de pedidos pode suprimir links e códigos legítimos em silêncio (F8).
  - [x] **Feito em 10/11/2026 (DD-30):** um link de recuperação novo invalida os anteriores; só o mais recente vale (RF03.R2 já alterado na v1.9). Risco aceito: quem pede links repetidos para a vítima pode invalidar o legítimo; as cotas do RF02 limitam.
  - [ ] `peekResetToken` compara a validade com `Date.now()` e não com o relógio injetado; o Better Auth confere de novo no consumo, então não é falha, só limita o teste de vencimento.
  - [ ] Testes de borda do `AuthStore` que faltam (`packages/db/test/auth-store.int.test.ts`): `keepSessionId` de outro usuário, conta de outro provedor em `getPasswordHash`/`setPasswordHash` e `expiresAt` exatamente igual a `now` em `listSessions`.
- [ ] Reunião de 05/11/2026: F2 e F6 passam a cobrir o contador (convite com aviso de folha) e o canal padrão da unidade; F4 ganha ticket médio, ponto de equilíbrio e imposto estimado; F12 e F13 são etapas novas. Planejar com os sócios antes de abrir a F0 se quiserem encaixar as telas novas.
- [ ] Antes de iniciar a E11, sugerido reler `arquitetura.md` (divergências atualizadas) e abrir as migrations de `paid_on`, `orders`, canal padrão e `tax_*`.

## 7. Documentação

- [ ] Atualizar `arquitetura.md`: tabela `fiscal_documents`, colunas novas (`entries.flags`, `ai_usage.cache_*`, `pending_questions.status`), ação `restore` e os índices de envio único.
- [ ] Se os sócios aceitarem as propostas de P04 e P06, levar para `requisitos.md` (subindo a versão) e para `escopo-por-fase.md`. (P06 e P07 foram mantidas provisórias em 05/11/2026, DD-15.)
- [x] Fluxo de cada etapa trocado de OpenSpec para Superpowers em 06/11/2026 (DD-18); `CLAUDE.md`, planos, `README` e guias atualizados.
- [ ] Limpar o que sobrou do OpenSpec, se o Luís confirmar: `.claude/commands/opsx/`, `.claude/skills/openspec-*` e `openspec/` (config e specs). Manter `openspec/changes/e11-modelo-de-dados/` até fechar a E11, que guarda a pergunta de design aberta.
- [ ] `planos/guia/contabilidade-restaurante-plano-do-zero.md` (roteiro genérico, já marcado como superado) ainda traz exemplos com `/opsx:*`; reescrever ou apagar.
- [ ] Corrigido em 05/11/2026: o `andamento.md` citava "F0 a F11" e o `CLAUDE.md` "F0 a F10"; agora ambos dizem F0 a F13 e E1 a E14.
