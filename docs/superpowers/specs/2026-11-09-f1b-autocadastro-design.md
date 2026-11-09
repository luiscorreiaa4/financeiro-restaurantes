# F1b: Autocadastro do dono (desenho)

Data: 09/11/2026. Etapa: F1b do painel (`docs/planos/painel.md`). Fluxo: Superpowers (DD-18).
Este documento **cita** RF/CA de `docs/requisitos.md` e não copia regra. Em conflito, vale `requisitos.md`.
Desenho-mãe: `docs/superpowers/specs/2026-11-07-f1-autenticacao-design.md` (F1a feita em 09/11/2026).

> Aprovado pelo Luís em 09/11/2026. Próximo passo: `superpowers:writing-plans`.

## Intenção

O dono do restaurante cria a própria conta no painel, sem a equipe do produto, e sai dela já logado, sabendo para qual número de WhatsApp mandar a primeira mensagem. Sem isso não há cliente novo: a F1a só deixa entrar quem já existe no banco.

Requisitos: RF01 (R1 a R13, R15, R16; Obs1 a Obs3), RF02.R1 e R4 (anti-enumeração e limites de código), RNF01, RNF04.R4. Critérios: RF01.CA01 a CA10.

## Objetivos

- Tela pública `/cadastro`: **e-mail primeiro** (código de 6 dígitos), depois um formulário único com dono, empresa, primeira unidade e aceite; ao concluir, entra logado.
- Gravação atômica (RF01.Obs2): empresa, unidade, dono, vínculo com todas as unidades, formas de pagamento e canais padrão. Plano TESTE, situação ATIVA (CA07).
- Tela final com o número de WhatsApp do produto, link `wa.me` e QR Code (RF01.Obs3, sem o assistente inicial).
- Campos opcionais da empresa no formulário: razão social, regime tributário, faixa de faturamento (R2, R5, R6).
- **"Criar outra empresa"** para quem já está logado (dono abrindo a segunda empresa, contador, colaborador): o mesmo formulário sem a parte do e-mail e da senha, gravando a empresa nova com o usuário atual como Dono.

## Fora de escopo (decidido com o Luís)

- **Código de indicação (R14):** vai para a F10 (precisa de tabela de códigos e de quem os cadastre no painel interno).
- **Sugestão de razão social por consulta pública de CNPJ (R2):** pendência sem etapa, registrada em `andamento.md`.
- Assistente inicial de colaboradores e taxas (RF01.Obs3, segunda parte): F6.
- Recuperação de senha, perfil e sessões: F1c. Envio real de e-mail: F8 (segue o `EmailSender` falso, DD-21).
- Alteração dos dados da empresa com histórico (RF01, "Alteração"): F6.

## Anti-objetivos

- Revelar se um e-mail ou celular já existe além do que o RF01 permite (R10, R11/CA05, RF02.R1).
- Deixar empresa, unidade ou usuário parcial no banco (CA08).
- Dar a qualquer papel de banco mais poder do que o cadastro precisa, ou abrir leitura de dados de tenant ao `app_auth`.
- Reaproveitar o `emailOTP` do Better Auth com `disableSignUp` desligado (o login comum nunca cria usuário, D-F1).

## Decisões do Luís (09/11/2026)

1. **Ordem:** e-mail e código primeiro; depois formulário único; conclui e já entra logado.
2. **Escopo:** entram campos opcionais da empresa e a tela final com WhatsApp; indicação para a F10; consulta de CNPJ fora.
3. **Abordagem A** (abaixo), com login automático ao concluir.
4. **E-mail já cadastrado:** recebe o aviso por e-mail, e a F1b já entrega "Criar outra empresa" para o usuário logado.

## Decisões minhas (para o Luís conferir)

- Formas e canais padrão seguem RF08.Obs2 (taxa zero) e RF09.Obs2; as taxas de exemplo ficam só no seed de desenvolvimento, aplicadas por cima da constante. **Conflito a registrar para o Matheus (P07):** o código de lançamento (`packages/core/src/entry/build-drafts.ts`) depende de "Não informada" e "Não informado", que os requisitos não listam; mantidos na constante.
- Regime tributário informado (diferente de NAO_SEI) vira uma linha em `tax_settings` (`packages/db/schema/tax.ts`) com o imposto desligado e `valid_from` = data do cadastro; nada de coluna `tenants.tax_regime` (uma fonte da verdade, RF39).
- O `app_auth` recebe só INSERT, nunca leitura nova de dados de tenant.
- E-mail já cadastrado não recebe código, e sim aviso; a tela não muda.
- Termos e privacidade com texto provisório marcado como rascunho.

## Abordagens consideradas

| | Descrição | Troca |
|---|---|---|
| **A (escolhida)** | Rotas próprias na API: `POST /api/signup/code`, `POST /api/signup/verify` (devolve comprovante de e-mail verificado) e `POST /api/signup` (transação única e sessão) | Controle total de atomicidade e de anti-enumeração; risco: abrir a sessão pelo adaptador interno do Better Auth |
| B | `emailOTP` do Better Auth com tipo `email-verification` | Precisa de usuário gravado antes (fere CA08) e de desligar `disableSignUp` |
| C | Server Action no Next gravando no banco | Fere "o painel não acessa o banco" (arquitetura) |

## Desenho

### Fluxo

1. Visitante informa o e-mail em `/cadastro` → `POST /api/signup/code`. Resposta sempre igual ("enviamos um código"). E-mail novo recebe o código (propósito `email-verification`); **e-mail já cadastrado recebe um aviso "você já tem conta, entre por aqui"** em vez do código (propósito novo no `EmailSender`), sem que a tela mude.
2. Visitante digita o código → `POST /api/signup/verify`. Código: 6 dígitos, 5 min, 3 tentativas, reenvio após 60 s, 5 envios/h por e-mail e 20/h por IP (RF01.R10, RF02.R4), reaproveitando `decideOtpSend` (`packages/core/src/auth/auth-policy.ts`). Acerto devolve um **comprovante opaco de uso único, válido por 30 min**, guardado com hash (em `verifications` com identificador próprio de cadastro, ou tabela própria: escolha do builder).
3. Formulário único (dono, empresa, unidade, aceite) → `POST /api/signup` com o comprovante. Validação com Zod do contrato e regras do `core`. Grava em uma transação; abre a sessão (cookie igual ao login, sem "manter conectado"); consome o comprovante.
4. Redireciona para `/bem-vindo`: número do WhatsApp do produto, link `wa.me` e QR Code, e botão "Ir para o painel".

**Aviso de e-mail já cadastrado:** "você já tem conta: entre por aqui; para abrir outra empresa, entre e use 'Criar outra empresa'; se não conseguir entrar, fale com o suporte" (cobre quem só tem vínculo desativado ou conta encerrada, que o login recusa).

**Criar outra empresa (usuário logado):** item "Criar outra empresa" na casca autenticada → `/nova-empresa` → `POST /api/companies` com sessão (sem comprovante). Mesmo formulário de empresa, unidade e aceite (o aceite é por empresa: o DPA é com cada controlador). Não cria usuário nem senha. Se o usuário não tem celular (contador, DD-20), o formulário pede e grava em `users.phone_e164`, porque o Dono precisa de celular. O vínculo novo nasce com `preferred_at` = agora, para que a empresa nova seja a ativa até o seletor da F2; conferir como o `/api/me` escolhe a empresa hoje. Termina em `/bem-vindo`. Mesma transação, mesmas validações e mesmos erros (CNPJ, celular) do cadastro.

### Banco (migration nova, seguindo `.claude/rules/tabela-nova.md`)

- `tenants` ganha: `legal_name`, `cnpj` (só dígitos), `segment`, `tax_regime`, `revenue_range`, `status`, `trial_started_at`, `trial_ends_at`, aceite (`terms_accepted_at`, `terms_version`, `privacy_version`, `dpa_version`, `terms_accepted_by`). **Índice único parcial em `cnpj` onde `status <> 'closed'`** (R3, CA04). Valores de enum em inglês conforme as notas de mapeamento em `requisitos.md`; `plan` mantém `trial` como TESTE. Antes, conferir `docs/arquitetura.md` (divergências) e se `tax_regime` já existe em `schema/tax.ts` (migration 0010): se existir, reaproveitar.
- **Papel da transação: `app_auth` ganha só `INSERT`** (com política `WITH CHECK true` para `app_auth`) em `tenants`, `users`, `units`, `memberships`, `payment_methods`, `sales_channels` e `tax_settings` (e `membership_units` só se o vínculo `all_units` exigir). Ordem de gravação: canais antes da unidade, por causa de `units.default_sales_channel_id`. Dono com `panel_access = true` e `all_units = true`. Sem `SELECT` novo em tabela de tenant: IDs gerados na aplicação (UUID v7), sem `RETURNING`. Motivo: o `app` não insere `tenants`/`users` por regra (`0001_rls_force_and_grants.sql:23-24`) e a transação precisa de um papel só; a pendência da F1a já apontava o `app_auth`. Não há variável de ambiente nova.
- Conflitos: `23505` em `cnpj` → "CNPJ já cadastrado" (CA04); em `phone_e164` → FE02, orientação para falar com o suporte sem revelar a conta (CA05); em `email` (corrida rara dentro dos 30 min) → mensagem genérica "não foi possível concluir; tente entrar".
- `auth_audit` ganha eventos de cadastro (código enviado, verificado, conta criada), com e-mail só em hash; o CHECK de eventos é estendido.
- Teste de isolamento: o `app_auth` continua sem conseguir ler dados de tenant.

### Domínio (`packages/core`)

- Validação do cadastro (função pura, com testes): R1, R7 (nome da unidade pré-preenchido com o nome fantasia na tela), R9, CNPJ com `isValidCnpj` (`packages/core/src/registry/unit.ts`) e recusa de sequência repetida, celular com `normalizeBrazilianPhone` (`packages/core/src/phone/phone.ts`, CA09), senha opcional R12 (8 a 64, letras e números, diferente do e-mail, igual à confirmação; CA10), aceite obrigatório (CA06).
- **Constante única de padrões da conta nova** (`[PROVISÓRIO – P07]`): formas de pagamento e canais que hoje estão só em `packages/db/src/dev-seed.ts:135-165` (Dinheiro, Pix, Débito, Crédito como cartão padrão, Voucher, Não informada; Salão como canal padrão da unidade, Delivery próprio, iFood, Retirada, Não informado). O seed de desenvolvimento passa a usar a constante.
- Constantes `[PROVISÓRIO – P03]`: duração do teste (14 dias). Constante das versões vigentes dos termos, privacidade e DPA.
- Fuso da unidade sugerido pela UF (R8): reaproveitar se já existir mapeamento; senão, criar no `core`.

### API (Fastify)

- Três rotas públicas novas, com Zod na entrada e limites de envio da F1a. Hash de senha pelo mesmo mecanismo do Better Auth (gravando em `accounts`, como no login por senha).
- Abertura da sessão após o commit pelo adaptador interno do Better Auth. ⚠️ Confirmar na documentação atual antes de implementar; **plano B:** redirecionar para `/login` com o e-mail preenchido.
- Erros de domínio tipados, mensagens em pt-BR. Nada de e-mail, celular, CNPJ ou senha em log (regra 9).

### Web (Next.js)

- `app/(public)/cadastro/` e `app/(public)/bem-vindo/` (esta exige sessão), em `features/signup/`. Celular primeiro (RNF09), estados de erro: código errado, expirado, excesso de tentativas, CNPJ inválido (CA01, mantendo os demais dados), CNPJ já cadastrado, celular já em uso.
- Páginas `/termos` e `/privacidade` com texto **provisório marcado como rascunho**; o texto final é dos sócios.
- Número do WhatsApp do produto por variável pública validada com Zod; QR Code gerado no navegador, sem serviço externo.
- Link "Criar conta" na tela de login.

## Testes

- **Unitário (core):** validações, CNPJ, celular (CA09), senha (CA10), padrões da conta.
- **Integração (API + Testcontainers, padrão de `apps/api/test/auth-login.int.test.ts`):** CA02 (sem comprovante não grava), CA03 (código vencido, reenvio após 60 s), CA04 (dois cadastros simultâneos com o mesmo CNPJ: uma conta), CA05, CA06, CA07 (consulta completa da conta criada), CA08 (falha injetada no meio da transação não deixa resto), CA10 (nenhuma senha em texto puro); e-mail já cadastrado recebe aviso e a resposta HTTP é idêntica; comprovante não serve duas vezes nem depois de 30 min; código de cadastro não serve para login e vice-versa; limites de envio somados por e-mail.
- **Banco:** migration, isolamento (`app_auth` sem leitura de tenant), meta-teste e contagens de `schema.test.ts`/`fixtures.ts`.
- **Criar outra empresa:** sem sessão é recusado; com sessão cria a empresa com o usuário atual como Dono, sem usuário novo; contador sem celular precisa informar o celular; o vínculo novo vira o preferido.
- **E2E (Playwright, desktop e Pixel 7):** cadastro completo até `/bem-vindo` e entrada no painel; "Criar outra empresa" logado; rotas novas na API falsa (`apps/web/e2e/fake-api.mjs`).

## Fica a cargo de quem implementa

- Onde guardar o código e o comprovante (`verifications` com prefixo ou tabela própria) e o formato do comprovante.
- React Hook Form + resolver do Zod (painel.md 3.4) ou `useState` como no `login-form.tsx`; biblioteca de QR Code.
- Nomes exatos de colunas e enums, seguindo o mapeamento de `requisitos.md`.
- Texto das mensagens e dos e-mails, em pt-BR (RNF09).

## Riscos

- ⚠️ Abrir sessão do Better Auth fora do fluxo dele (plano B acima).
  - **Resultado do spike (F1b T5, 09/11/2026, better-auth 1.7.18): funciona, plano B descartado.** Um plugin interno (`signupSessionPlugin` em `apps/api/src/infra/auth/create-auth.ts`) declara o endpoint `createAuthEndpoint.serverOnly` (fora do roteador HTTP, só em `auth.api.openSignupSession`), que chama `ctx.context.internalAdapter.createSession(userId, true)` e `setSessionCookie(ctx, { session, user }, true)` de `better-auth/cookies`. Com `returnHeaders: true` a chamada devolve os mesmos `Set-Cookie` do login sem "manter conectado" (`__Secure-better-auth.session_token` e `dont_remember`, `HttpOnly; Secure; SameSite=Lax`, sem `Max-Age`). A sessão passa pelos `databaseHooks` (`keep_connected = false`, 12 h, IP e agente gravados) e o `GET /api/me` aceita o cookie. O hash de senha usa `(await auth.$context).password.hash`, o mesmo do login por senha.
- ⚠️ `INSERT` com RLS forçada e sem política de `SELECT`: confirmar que o Postgres aceita o `INSERT` sem `RETURNING` e que o erro `23505` chega com o nome da restrição.
- O limite de 20 envios por IP depende do IP real (pendência da F8, `trustProxy`).
- **Fatos de implementação (F1b, 09/11/2026).**
  - Ordem de inserção: `users` (e `accounts`) antes de `tenants`, e não depois, porque `tenants.terms_accepted_by` referencia `users` e `app_auth` não pode atualizar `tenants` depois. O resto segue o plano (`sales_channels`, `payment_methods`, `units`, `memberships`, `tax_settings`, auditoria).
  - O comprovante é consumido dentro da transação da conta (primeira instrução), por `consumeReceipt(..., tx)`; falha depois disso deixa o comprovante reutilizável. Se abrir a sessão falhar depois do commit, a resposta é 201 sem cookie.
  - Limite de envio: linhas de código e de aviso somam por e-mail dentro do cadastro; o login conta à parte (`otp_sent` na auditoria). Até 5 e-mails de login e 5 de cadastro por hora por endereço e 40 por hora por IP (20 de cada); 3 tentativas por código, logo até 5 códigos x 3 tentativas por hora por e-mail.
  - Valores em inglês de segmento e faixa de faturamento foram inventados (sem mapeamento oficial); situações da conta: `active`, `read_only`, `canceled`, `closed`. Versões legais são placeholders. DD-25.
  - Os dois riscos de RLS ficaram resolvidos por teste (migration 0014): `INSERT` sem `RETURNING` e chaves compostas passam sem `SELECT`; o `23505` traz o nome da restrição.
  - Usuário só com vínculos desativados não tem sessão e recebe 401 em `/api/companies` (nota de produto).

## Documentos a atualizar

- `docs/decisoes.md`: DD-25 (cadastro com `app_auth` só com INSERT; e-mail existente recebe aviso em vez de código; "Criar outra empresa" para usuário logado; regime em `tax_settings`; indicação para a F10). `docs/requisitos.md` (subindo a versão): nota em RF01.Obs4 sobre "Criar outra empresa" e a divergência de "Não informada/Não informado" no RF08/RF09 (P07).
- `docs/arquitetura.md` (divergências de `tenants`), `docs/planos/painel.md` (tabela, "Atualizado em", F10 recebe R14), `docs/planos/andamento.md` (pendências da F1b, consulta de CNPJ), `CLAUDE.md` (Estado atual).

## Verificação ao fim da F1b

`pnpm typecheck && pnpm lint && pnpm test`, `pnpm test:int` no `db` e na `api`, E2E do web; fluxo à mão: `pnpm dev`, cadastrar em `http://localhost:3000/cadastro` lendo o código em `DEV_MAIL_DIR`, cair em `/bem-vindo` e entrar no painel. Depois o "Fechamento de etapa" do `painel.md`.
