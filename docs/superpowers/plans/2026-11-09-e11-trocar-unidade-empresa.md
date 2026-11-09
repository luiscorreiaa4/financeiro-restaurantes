# E11: trocar unidade, trocar empresa e empresa citada Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar a E11 do canal: `trocar unidade`, `trocar empresa` e a empresa ou unidade citada no texto, mais a rodada de evals.

**Architecture:** A escolha mora no vínculo (`memberships.default_unit_id` e a coluna nova `preferred_at`). A lista numerada é uma pergunta pendente de tipo `choice`, respondida pelo número sem IA. A empresa ou unidade citada é casada por uma função pura do `core` antes de atribuir a mensagem; o nome de unidade dentro da mesma empresa vem do campo `unit_hint` da extração.

**Tech Stack:** TypeScript strict, Drizzle + drizzle-kit, Fastify, Zod, Vitest (unitário e `*.int.test.ts` com Testcontainers), Biome.

**Spec:** `docs/superpowers/specs/2026-11-09-e11-trocar-unidade-empresa-design.md`. Decisão: DE-25 em `docs/decisoes.md`. Regras: `docs/requisitos.md` RF19 (CA03), RF11.R5 e R7, RF15.

## Global Constraints

- Código e identificadores em inglês; textos para o usuário em português do Brasil, com `[PROVISÓRIO – P08]` no comentário (DE-12).
- A IA nunca decide a empresa nem faz conta (CLAUDE.md, regra 3). O casamento de empresa é código, sem IA.
- Toda gravação de dados de cliente roda em `withTenant` do tenant gravado (regra 2). Nenhum grant novo.
- Nunca logar conteúdo de mensagem (regra 9).
- Tabela ou coluna nova segue `.claude/rules/tabela-nova.md` (`schema.test.ts`, `fixtures.ts`, SQL revisado).
- Migration seguinte à `0010_tax_estimate.sql` é a `0011`.
- Commits em Conventional Commits, com o rodapé de coautoria da sessão.
- `packages/core` não importa infra.

## Review Focus

- Pessoa com duas empresas escreve "centro" e o apelido existe nas duas: não troca de empresa, vale a padrão. Teste na Task 2.
- A empresa citada é a mesma da padrão: nenhuma troca, só a unidade vale. Teste na Task 2.
- Resposta `choice` com número fora da lista, texto livre ou "0": repete a lista sem gravar nada. Teste na Task 3.
- `trocar unidade` com uma pergunta de esclarecimento aberta: a antiga é cancelada para a nova abrir (índice único de pergunta aberta). Teste na Task 5.
- Unidade padrão fora das unidades de acesso (dado velho): nunca é usada. Teste na Task 2.
- Pergunta `choice` aberta em uma empresa e a próxima mensagem cita a outra: a pergunta fica sem ser vista e vence em 24 h. Aceito e registrado na DE-25; teste de que nada é gravado na Task 6.

---

### Task 1: Comandos `switch_unit` e `switch_tenant`

**Files:**
- Modify: `packages/core/src/conversation/commands.ts`
- Test: `packages/core/src/conversation/commands.test.ts`, `packages/core/src/conversation/routing.test.ts`

**Interfaces:**
- Produces: `type Command = "undo" | "help" | "cancel" | "support" | "switch_unit" | "switch_tenant"`. `parseCommand("Trocar unidade!")` devolve `"switch_unit"`; `parseCommand("trocár  EMPRESA")` devolve `"switch_tenant"`.

- [ ] **Step 1: Write the failing tests**
  - `commands.test.ts`: `"trocar unidade"`, `" Trocar Unidade! "` → `switch_unit`; `"trocar empresa"`, `"TROCAR EMPRESA."` → `switch_tenant`; `"trocar unidade do almoço"` → `null`.
  - `routing.test.ts`: texto `"trocar empresa"` com remetente conhecido devolve `{ kind: "command", command: "switch_tenant", replyTarget: null }`, mesmo com `hasPendingQuestion: true` (comando vem antes da pergunta pendente, RF11.R7 (c)).
- [ ] **Step 2: Run** `pnpm --filter @app/core test -- commands routing`. Expected: FAIL.
- [ ] **Step 3: Implement** acrescentando as duas entradas ao dicionário `COMMANDS` e ao tipo `Command`.
- [ ] **Step 4: Run** o mesmo comando. Expected: PASS; `pnpm typecheck` mostra o `switch` de `route-inbound.ts` não exaustivo (corrigido na Task 6; o erro é esperado até lá).
- [ ] **Step 5: Commit** `feat(core): comandos trocar unidade e trocar empresa`.

### Task 2: Vínculo com `preferredAt`, ordenação e `matchCitedPlace`

**Files:**
- Modify: `packages/core/src/conversation/sender.ts`
- Create: `packages/core/src/conversation/cited-place.ts`
- Modify: `packages/core/src/conversation/index.ts` (exportar)
- Test: `packages/core/src/conversation/sender.test.ts`, `packages/core/src/conversation/cited-place.test.ts`

**Interfaces:**
- Consumes: `normalizeName` de `../entry/catalog`.
- Produces, em `sender.ts`:
  - `SenderMembership` ganha `readonly preferredAt: Date | null` e `readonly tenantUnits: readonly { id: string; name: string; aliases: readonly string[]; status: CatalogStatus }[]` (`tenantUnitIds` continua, derivado).
  - `SenderResolution` known ganha `readonly citedUnitId: string | null` e `readonly activeMemberships: readonly SenderMembership[]`.
  - `resolveSender(memberships: readonly SenderMembership[], options?: { text?: string | null }): SenderResolution`.
  - `defaultUnitId` só devolve unidade acessível: `membership.defaultUnitId` se estiver em `accessibleUnitIds`; senão a única acessível; senão `null`.
- Produces, em `cited-place.ts`: `matchCitedPlace(text: string, candidates: readonly SenderMembership[], current: SenderMembership): { membership: SenderMembership; unitId: string | null } | null`.

- [ ] **Step 1: Write the failing tests** (`sender.test.ts`)
  - dois vínculos, o mais novo com `preferredAt` preenchido: vale o mais novo; sem `preferredAt` em nenhum, vale o mais antigo (DE-07); `preferredAt` empatado desempata por `createdAt`.
  - `defaultUnitId` apontando para unidade fora de `unitIds`: resolução devolve `null` quando há duas unidades acessíveis, e a única acessível quando há uma.
- [ ] **Step 2: Write the failing tests** (`cited-place.test.ts`; todos com vínculos de duas empresas "Bistrô Centro" e "Bistrô Praia", unidades "Matriz" (apelido "centro") e "Praia" (apelido "litoral"))
  - `"gastei 50 no litoral"` com a empresa padrão = Centro → devolve a empresa Praia e `unitId` da unidade "Praia".
  - `"Gastei 50 no LITORAL!"` (caixa e pontuação) → mesmo resultado.
  - `"litoralzinho"` (não é palavra inteira) → `null`.
  - apelido "centro" existente nas duas empresas → `null` (ambíguo).
  - texto cita a unidade da própria empresa padrão → `{ membership: current, unitId }`, sem trocar de empresa.
  - texto cita unidade a que o vínculo não tem acesso (`unitIds` não a inclui) → `null`.
  - unidade inativa citada → `null`.
  - sem citação → `null`.
- [ ] **Step 3: Run** `pnpm --filter @app/core test -- sender cited-place`. Expected: FAIL.
- [ ] **Step 4: Implement** `matchCitedPlace`: normaliza o texto com `normalizeName`; para cada vínculo candidato monta os termos (nome da empresa; nome e apelidos das unidades acessíveis e ativas), casa cada termo como palavra inteira (limites por espaço, sem regex dinâmica sem escape); se os casamentos apontam para exatamente uma empresa, devolve-a; se apontam para mais de uma, `null`. `resolveSender` chama `matchCitedPlace` só quando `options.text` é informado e há mais de uma empresa ativa; o vínculo escolhido vira `sender` e `citedUnitId` recebe a unidade casada.
- [ ] **Step 5: Run** os mesmos testes. Expected: PASS.
- [ ] **Step 6: Commit** `feat(core): ordem por empresa preferida e casamento de empresa citada`.

### Task 3: Escolha numerada (`choice`)

**Files:**
- Create: `packages/core/src/conversation/choice.ts`
- Modify: `packages/core/src/conversation/index.ts`
- Test: `packages/core/src/conversation/choice.test.ts`

**Interfaces:**
- Produces:
  - `ChoiceDraftSchema` (Zod) e `type ChoiceDraft = { target: "unit" | "tenant"; options: { n: number; id: string; label: string }[] }`.
  - `buildChoice(target: "unit" | "tenant", items: readonly { id: string; label: string }[]): { draft: ChoiceDraft; text: string }`, em que `text` é a lista numerada a partir de 1 mais a linha de cancelar.
  - `parseChoiceAnswer(draft: ChoiceDraft, answer: string): { kind: "chosen"; id: string; label: string } | { kind: "invalid" }`.

- [ ] **Step 1: Write the failing tests**
  - `buildChoice("unit", [{id:"a",label:"Matriz"},{id:"b",label:"Praia"}]).text` contém "1. Matriz" e "2. Praia".
  - `parseChoiceAnswer(draft, "2")` → `chosen` com id `"b"`; `" 2. "` e `"2 "` também.
  - `"0"`, `"3"`, `"praia"`, `""`, `"1 2"` → `invalid`.
  - `ChoiceDraftSchema.safeParse` rejeita opção com `n` repetido.
- [ ] **Step 2: Run** `pnpm --filter @app/core test -- choice`. Expected: FAIL.
- [ ] **Step 3: Implement** em `choice.ts`. A resposta válida é só dígitos depois de tirar espaços e ponto final.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): escolha numerada para trocar unidade e empresa`.

### Task 4: `unit_hint`, `findUnit`, prompt e casos de eval

**Files:**
- Modify: `packages/core/src/entry/extraction.ts`, `packages/core/src/entry/catalog.ts`, `packages/ai/src/extraction/prompt.ts`, `packages/ai/src/evals/context.ts`, `packages/ai/src/evals/dataset.jsonl`
- Test: `packages/core/src/entry/catalog.test.ts`, `packages/core/src/entry/extraction.test.ts`, testes do prompt existentes em `packages/ai`

**Interfaces:**
- Produces:
  - `ExtractionResultSchema` ganha `unit_hint: z.string().nullable()` no nível do resultado (uma unidade por mensagem; as fixtures existentes ganham `unit_hint: null`).
  - `findUnit(catalog: CatalogSnapshot, hint: string, accessibleIds: readonly string[]): CatalogUnit | null`: casa nome ou apelido (`matches`), só unidades ativas e acessíveis.

- [ ] **Step 1: Write the failing tests**
  - `catalog.test.ts`: `findUnit(catalog, "Litoral", ids)` acha a unidade de apelido "litoral"; unidade fora de `accessibleIds` → `null`; inativa → `null`.
  - `extraction.test.ts`: resultado sem `unit_hint` é rejeitado; com `null` e com texto é aceito.
- [ ] **Step 2: Run** `pnpm --filter @app/core test -- catalog extraction`. Expected: FAIL.
- [ ] **Step 3: Implement** o campo e `findUnit` (padrão de `findSalesChannel`). No prompt, nova regra no padrão da regra 6: preencher `unit_hint` só quando o usuário cita uma das unidades listadas; caso contrário `null`. Atualizar o JSON schema de saída estruturada se for derivado à mão.
- [ ] **Step 4: Eval data.** Em `context.ts` incluir uma segunda unidade "Restaurante Praia" com apelido "litoral". Em `dataset.jsonl`, três casos novos: "gastei 80 de gelo no litoral" (esperado `unit_hint` "litoral"), "vendi 300 no pix na praia" (esperado `unit_hint` "praia") e um caso sem unidade citada (esperado `null`). Seguir o formato das linhas existentes.
- [ ] **Step 5: Run** `pnpm --filter @app/core test && pnpm --filter @app/ai test`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(core,ai): unit_hint na extração e busca de unidade por nome`.

### Task 5: Migration `0011` e adaptadores do banco

**Files:**
- Modify: `packages/db/schema/tenants.ts` (`memberships.preferredAt`), `packages/db/schema/messages.ts` (`pending_questions.kind`), `packages/db/src/sender-directory.ts`, `packages/db/src/entry-store.ts` (`findOpenPendingQuestion` devolve `kind`), `packages/db/src/tenant-conversation-repo.ts` se ler a pergunta
- Create: `packages/db/migrations/0011_*.sql` (gerada por `pnpm db:generate`), `packages/db/src/choice-store.ts`
- Modify: `packages/core/src/ports/ports.ts` (porta `ChoiceStore`; `PendingQuestionRecord.kind`), `packages/db/src/index.ts`
- Test: `packages/db/src/schema.test.ts`, `packages/db/test/choice-store.int.test.ts`, `packages/db/test/conversation.int.test.ts`

**Interfaces:**
- Produces, em `ports.ts`:
  - `PendingQuestionRecord` ganha `readonly kind: "clarify" | "choice"`.
  - `interface ChoiceStore { open(input: { tenantId: string; userId: string; inboundMessageId: string; id: string; draft: ChoiceDraft; question: string; expiresAt: Date }): Promise<void>; apply(input: { tenantId: string; userId: string; questionId: string; target: "unit" | "tenant"; chosenId: string; now: Date }): Promise<void>; }`.
  - `open` cancela a pergunta aberta do usuário (qualquer `kind`) e insere a nova, na mesma transação `withTenant`.
  - `apply` com `target: "unit"`: grava `memberships.default_unit_id = chosenId` do vínculo `(tenantId, userId)`; com `target: "tenant"`: grava `memberships.preferred_at = now` do vínculo `(chosenId, userId)`, em `withTenant(chosenId)`. Nos dois fecha a pergunta como `answered` no tenant da pergunta.
- `SenderMembership` preenchido pelo `sender-directory` com `preferredAt` e `tenantUnits` (nome, apelidos, status).

- [ ] **Step 1: Schema.** Adicionar `preferred_at timestamptz` (nulo) em `memberships`; `kind text not null default 'clarify'` em `pending_questions`, com `oneOf("pending_questions_kind_check", "kind", ["clarify","choice"])`. Rodar `pnpm db:generate`, revisar o SQL (sem `DROP`), nada de grant.
- [ ] **Step 2: Write the failing tests**
  - `schema.test.ts`: as duas colunas existem; `kind` recusa valor fora da lista.
  - `choice-store.int.test.ts` (padrão de `conversation.int.test.ts`):
    - `open` com uma pergunta `clarify` aberta: a antiga fica `cancelled` e a nova `open` com `kind = choice`.
    - `apply` de unidade grava `default_unit_id` e fecha a pergunta `answered`.
    - `apply` de empresa grava `preferred_at` só no vínculo escolhido; o vínculo do outro tenant não muda.
    - `apply` com `chosenId` de unidade de outro tenant falha por FK composta e não deixa a pergunta fechada (transação).
  - `conversation.int.test.ts`: `findMemberships` devolve `preferredAt` e `tenantUnits` com apelidos.
  - Teste de isolamento: `app` com tenant A não lê nem altera `pending_questions` e `memberships` de B (já coberto pela meta-suíte; confirmar que `fixtures.ts` não precisa de mudança).
- [ ] **Step 3: Run** `pnpm --filter @app/db test:int` (ou o script de integração do pacote). Expected: FAIL.
- [ ] **Step 4: Implement** `createChoiceStore(db: Database): ChoiceStore` e o preenchimento no `sender-directory`; `findOpenPendingQuestion` passa a devolver `kind`.
- [ ] **Step 5: Run** `pnpm db:migrate` local, depois a suíte do `db`. Expected: PASS (a contagem anterior era 179 testes).
- [ ] **Step 6: Commit** `feat(db): empresa preferida no vínculo e pergunta de escolha`.

### Task 6: Roteamento e handlers da API

**Files:**
- Modify: `apps/api/src/modules/inbound/route-inbound.ts`, `apps/api/src/modules/inbound/messages.ts`, `apps/api/src/composition.ts`
- Create: `apps/api/src/modules/inbound/switch-handlers.ts`
- Test: `apps/api/src/modules/inbound/route-inbound.test.ts`, `apps/api/test/route-inbound.int.test.ts`

**Interfaces:**
- Consumes: `resolveSender(memberships, { text })`, `buildChoice`, `parseChoiceAnswer`, `ChoiceStore`.
- Produces:
  - `RouteContext` ganha `readonly citedUnitId: string | null` e `readonly activeMemberships: readonly SenderMembership[]` (vínculos ativos do telefone, já filtrados por `resolveSender`, que passa a devolvê-los em `SenderResolution` known como `activeMemberships`).
  - `RouteHandlers` ganha `switchUnit(context)` e `switchTenant(context)`.
  - `createSwitchHandlers(deps: { choices: ChoiceStore; store: Pick<EntryStore,"findOpenPendingQuestion">; clock: Clock; newId: () => string })`: devolve `{ switchUnit, switchTenant, answerChoice }`, onde `answerChoice(context, pending): Promise<void>` trata a resposta de uma pergunta `choice`. `switchUnit` lista as unidades de `accessibleUnitIds(context.sender)` ativas (nomes em `sender.tenantUnits`); `switchTenant` lista os nomes de `context.activeMemberships`.
  - Textos em `messages.ts`: `onlyOneUnitText(name)`, `onlyOneCompanyText(name)`, `unitSwitchedText(unitName)`, `companySwitchedText(tenantName)`, `CHOICE_INVALID_TEXT`.

- [ ] **Step 1: Write the failing tests** (`route-inbound.test.ts`, com fakes)
  - `resolveSender` recebe o texto só quando a mensagem é de texto.
  - `trocar unidade` com uma unidade acessível → responde `onlyOneUnitText`, não abre pergunta.
  - `trocar unidade` com duas → `choices.open` chamado com `target: "unit"` e só as unidades acessíveis e ativas; resposta enviada com `purpose: "question"`.
  - `trocar empresa` com uma empresa → `onlyOneCompanyText`; com duas → `target: "tenant"` com os nomes das empresas.
  - resposta `"2"` a uma pergunta `choice` → `choices.apply` com o id da opção 2, resposta `unitSwitchedText`/`companySwitchedText`, **nenhuma** chamada à IA (`handlers.extract` e o extrator não são chamados).
  - resposta `"9"` → `CHOICE_INVALID_TEXT` com a lista de novo, nada gravado.
  - `cancelar` com a pergunta `choice` aberta → fechada como `cancelled` (reaproveita o `cancel` existente).
  - mensagem citando a unidade da outra empresa → `assignSender` chamado com o `tenantId` da outra empresa (RF11.R5).
  - áudio e foto → `resolveSender` chamado sem texto (limitação aceita na DE-25).
- [ ] **Step 2: Integration test** (`route-inbound.int.test.ts`), RF19.CA03: usuário com duas unidades escolhe a 2 em `trocar unidade`; a mensagem seguinte sem citar unidade aponta para a unidade 2. RF11.R5: usuário com duas empresas cita a unidade da segunda e o `inbound_messages.tenant_id` é o da segunda.
- [ ] **Step 3: Run** `pnpm --filter @app/api test` e o `test:int`. Expected: FAIL.
- [ ] **Step 4: Implement.**
  - Em `createRouteInbound`: `resolveSender(..., { text: message.type === "text" ? message.text : null })`; passar `citedUnitId` ao contexto; completar o `switch` de comandos.
  - `pendingAnswer`: se a pergunta aberta tem `kind === "choice"`, chamar `answerChoice` e não ir à IA. A decisão fica em `createRouteInbound` ou no handler composto, sem mudar `decideRoute`.
  - `ajuda`: acrescentar `trocar unidade` e `trocar empresa` à lista de comandos de `helpText` e ajustar o teste de `helpText`.
  - Ligar `createChoiceStore` e `createSwitchHandlers` em `composition.ts`.
- [ ] **Step 5: Run** os mesmos testes. Expected: PASS.
- [ ] **Step 6: Commit** `feat(api): trocar unidade, trocar empresa e empresa citada`.

### Task 7: Unidade do lançamento (`unit_hint` e correção do padrão)

**Files:**
- Modify: `apps/api/src/modules/entries/entry-handlers.ts` (linhas 243-255)
- Test: `apps/api/src/modules/entries/entry-handlers.test.ts` (criar se não existir, no padrão de `chat-session.test.ts`), `apps/api/test/entries-flow.int.test.ts`

**Interfaces:**
- Consumes: `findUnit(catalog, hint, accessibleUnitIds(context.sender))`, `context.citedUnitId`, `context.defaultUnitId`, `extracted.value.result.unit_hint`.

- [ ] **Step 1: Write the failing tests**
  - Precedência: `citedUnitId` vence `unit_hint`, que vence o padrão.
  - `unit_hint` que não casa com nenhuma unidade acessível → usa o padrão (a confirmação mostra o lugar).
  - Sem padrão e sem dica, vínculo restrito a duas unidades → usa a primeira unidade **acessível e ativa**, nunca `catalog.units[0]` quando ela está fora do acesso (bug de `entry-handlers.ts:243`).
  - Vínculo sem nenhuma unidade acessível → `UNIT_MISSING_TEXT`.
- [ ] **Step 2: Run** `pnpm --filter @app/api test -- entry-handlers`. Expected: FAIL.
- [ ] **Step 3: Implement** `chooseUnitId(context, catalog, hint): string | null` como função local do arquivo, e usá-la no lugar da linha 243.
- [ ] **Step 4: Run** a suíte unitária e `entries-flow.int.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `fix(api): lançamento só cai em unidade de acesso e aceita unidade citada`.

### Task 8: Seed de desenvolvimento e chat

**Files:**
- Modify: `packages/db/src/dev-seed.ts` se faltar usuário com duas empresas ou duas unidades com apelidos "centro" e "litoral"
- Test: `packages/db/test/dev-seed.int.test.ts`

- [ ] **Step 1:** Conferir se o seed já tem um usuário com vínculo em duas empresas e outro com duas unidades de acesso (apelidos "centro" e "litoral" já existem em `dev-seed.ts:55-56`). Se faltar, acrescentar e escrever o teste correspondente primeiro.
- [ ] **Step 2: Manual** (`pnpm db:seed:dev`, `pnpm dev`, `pnpm dev:worker`, `pnpm dev:chat`): rodar o roteiro da seção Verificação do plano aprovado.
- [ ] **Step 3: Commit** `chore(db): seed de desenvolvimento para trocar unidade e empresa` (só se houve mudança).

### Task 9: Evals

**Files:**
- Modify: `packages/ai/src/evals/baseline.json` (somente se nada piorar)

- [ ] **Step 1:** Rodar `pnpm --filter @app/ai eval` (gasta crédito; teto padrão de US$ 1 via `--max-usd`). Expected: sai com código 0, os três casos novos passam e nenhuma métrica fica abaixo do baseline.
- [ ] **Step 2:** Se algo piorar, diagnosticar a causa (prompt ou caso), sem enfraquecer o caso, e rodar de novo.
- [ ] **Step 3:** Passando, `pnpm --filter @app/ai eval --update-baseline` e registrar o custo da rodada na resposta final.
- [ ] **Step 4: Commit** `test(ai): casos de unit_hint e novo baseline dos evals`.

### Task 10: Fechamento da etapa e documentação

**Files:**
- Modify: `docs/planos/canal-whatsapp.md`, `docs/planos/andamento.md`, `docs/escopo-por-fase.md`, `docs/arquitetura.md`, `CLAUDE.md`, `docs/decisoes.md` (DE-25 com a data real e a situação)

- [ ] **Step 1: Verificação completa** (`superpowers:verification-before-completion`): `pnpm typecheck && pnpm lint && pnpm test`, mais `test:int` do `db` e da `api`. Registrar as contagens reais.
- [ ] **Step 2: Atualizar** E11 como "Feita" (tabela e "Situação"), `andamento.md` (seção 5: marcar as duas tarefas feitas; deixar o contador sem celular como pendência da F1a), `escopo-por-fase.md` (RF11 e RF19), `arquitetura.md` (linha de `inbound_messages` e as colunas `preferred_at` e `kind`) e `CLAUDE.md` ("Estado atual").
- [ ] **Step 3:** Seguir o "Fechamento de etapa" do plano do canal: propor, sem criar, regras, skills, hooks ou `CLAUDE.md` de módulo para o que repetiu.
- [ ] **Step 4: Commit** `docs: fecha a E11 do canal`.
