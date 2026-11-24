# F6b: colaboradores, plano de implementação

> **Para quem executa:** `superpowers:subagent-driven-development` nas tarefas CRÍTICAS e `superpowers:executing-plans` nas demais; TDD; skill `testes-direcionados`; nunca commitar sem o Luís pedir; não ler o `.env`. As convenções de classe, rotas, migrations e erros são as do plano F6a (`2026-11-23-f6a-catalogos-taxas.md`). **Pré-requisito:** F6a feita.

**Goal:** o dono cadastra, edita, desativa e reativa colaboradores, com texto pronto e link `wa.me`; o gerente consulta mascarado; reduzir acesso encerra sessões.
**Architecture:** `core/registry/member.ts`; `db` (`member-directory.ts` no `app_auth`, `members-repo.ts` no `app`, migration 0024 `display_name`); `api/http/settings/members-routes.ts`; `web/features/settings/members/*`.
**Tech Stack:** o da F6a.
**Spec:** `docs/superpowers/specs/2026-11-23-f6-configuracoes-design.md` (RF05 e RF06; CA: RF05.CA01–CA09).

## Global Constraints
- Nome 2–120 (RF05.R1). Celular E.164 brasileiro, com e sem o 9º dígito iguais (`normalizeBrazilianPhone`, CA01); obrigatório para dono, gerente e lançador (DD-20).
- E-mail obrigatório com painel (CA03); unidade padrão entre as de acesso (CA04); dono sempre TODAS; sempre um dono ativo (CA06).
- Gerente: só colaboradores com acesso a alguma unidade dele, celular só os 4 últimos dígitos, sem e-mail (CA08). Contador e lançador: 403.
- Nunca logar nome, telefone nem e-mail (regra 9 do `CLAUDE.md`).
- Número de outra empresa: nada da outra empresa aparece em resposta, erro ou log (CA02).

## Review Focus (cada linha vira teste na tarefa dona)
1. Dono da empresa A cadastra o celular de alguém que é dono na empresa B → só o vínculo em A; o nome em B não muda; a resposta não traz nada de B (B4/B5).
2. Gerente pede `GET /api/settings/members/:id` de colaborador de outra unidade → 404 (B5).
3. Dono rebaixa gerente a lançador enquanto o gerente tem sessão aberta → a próxima requisição do gerente dá 401 (B5, CA09).
4. Dois donos rebaixam um ao outro em paralelo → um falha com `LastActiveOwner` (B4).
5. Troca de celular para número com 8 dígitos que já existe com 9 em outro usuário → 422 `phone_in_use` (B4).

## Desvios do desenho aprovado
Nenhum.

## Tarefas

### B1. `display_name` e leitores de "lançado por" — CRÍTICA (contrato consumido por várias telas)
**Create:** migration `0024_membership_display_name.sql`. **Modify:** `packages/db/schema/tenants.ts` (`displayName: text("display_name")`, CHECK 2–120 quando não nulo), `packages/db/src/entry-reader.ts` (joins de `users` nas linhas ~341, 363, 701, 741, 780, 1079: `coalesce(m.display_name, u.name)` com `left join memberships m on m.user_id = u.id and m.tenant_id = e.tenant_id`), leitor da exportação (conferir de onde vem o autor em `packages/core/src/exports/columns.ts`), `entryReader.options` (membros).
- [ ] Testes: mesmo usuário com `display_name` diferente em A e B → cada empresa vê o seu nome na lista, detalhe, histórico e exportação; nulo → `users.name`.
- [ ] Run: `pnpm --filter @app/db test:int -- entry-reader` e o teste da exportação. Commit: `feat(db): nome do colaborador por empresa`.

### B2. Domínio e contrato de colaboradores — CRÍTICA (permissões)
**Create:** `packages/core/src/registry/member.ts` + teste. **Modify:** `contracts/settings.ts`, união `DomainError`.
**Produces:**
- `MemberInput = { displayName; phone: string; email: string | null; role: "owner" | "manager" | "staff"; allUnits; unitIds; defaultUnitId; panelAccess; permissions: AdditionalPermission[] }`.
- `planMemberCreate(input, ctx: { tenantUnitIds: readonly string[]; productPhoneE164: string | null; actorId; now }): Result<{ phone: { e164: string; lookupCandidates: string[] }; membership: MembershipDraft; audit: AuditDraft }, DomainError>` (usa `validateAccess`; `ProductNumber`, `ForeignPhone`, `PermissionNotForRole`).
- `planMemberUpdate(before: MemberState, patch: MemberPatch, ctx: { activeOwnerIds: readonly string[]; tenantUnitIds; actorId; now }): Result<{ after: MemberState; reducesAccess: boolean; phoneChange: { e164; lookupCandidates } | null; emailChange: string | null; audit: AuditDraft }, DomainError>` (`ensureActiveOwner`).
- `isAccessReduction(before: MemberState, after: MemberState): boolean` (papel abaixo na ordem owner > manager > staff, unidade retirada, TODAS → lista, painel retirado, permissão retirada, desativação).
- `maskPhone(e164: string): string` ("•••• 5647"); `maskEmail(email: string): string` ("f•••@dominio.com"); `buildInviteText(displayName: string, tenantName: string): string`.
- Contrato: `memberSettingsSchema` (`id, displayName, phoneMasked, phone?: string, email?: string | null, role, allUnits, unitIds, defaultUnitId, panelAccess, permissions, status, invitedAt, deactivatedAt`), `memberInputSchema`, `memberPatchSchema` (com `confirmPhoneChange: true` obrigatório quando `phone` vem), `memberCreatedSchema` (`member, inviteText`).
- [ ] Testes: CA01, CA03, CA04, CA06; VER_FOLHA em lançador recusado; `isAccessReduction` em cada caso e falso para promoção.
- [ ] Run: `pnpm --filter @app/core exec vitest run registry/member contracts/settings`. Commit: `feat(core): domínio de colaboradores`.

### B3. Variável do número do produto — HAIKU
**Modify:** `packages/config/env` (schema): `PRODUCT_WHATSAPP_NUMBER` opcional, string; aviso no log de inicialização quando ausente; `.env.example` com a linha comentada.
- [ ] Teste do schema de env aceita ausente e valida formato quando presente. Avisar o Luís para acrescentar no `.env` (não editar o `.env`). Commit: `chore(config): número do produto na API`.

### B4. Repositórios de colaboradores — CRÍTICA (RLS, papel `app_auth`)
**Create:** `packages/db/src/member-directory.ts` (`app_auth`), `packages/db/src/members-repo.ts` (`app`), testes de integração.
- [ ] ⚠️ Passo 0: conferir nas migrations o `GRANT` do `app_auth` em `users` (INSERT com `name, email, phone_e164`; UPDATE de `phone_e164`, `email`). Plano B: migration `0025_app_auth_user_contact.sql` com o `GRANT` de coluna que faltar (a migration da F6c passa a ser a 0026).
**Produces:**
- `createMemberDirectory(authDb): { findUserByPhone(candidates: readonly string[]): Promise<{ id; email: string | null } | null>; findUserIdByEmail(email): Promise<string | null>; createUser(u: { name; phoneE164; email: string | null }): Promise<string>; hasMembershipElsewhere(userId, tenantId): Promise<boolean>; updateUserContact(userId, c: { phoneE164?: string; email?: string | null }): Promise<void> }`.
- `createMembersRepo(db): { list(tenantId, scope: { unitIds: readonly string[] | "all"; includeContact: boolean }, f: MemberFilters); get(tenantId, id, scope); insert(tenantId, userId, plan): Promise<{ created: boolean; id: string }>; update(tenantId, id, step: (before: MemberState, activeOwnerIds: string[]) => Result<…>): Promise<…>; setStatus(tenantId, id, "deactivated" | "reactivate", actorId) }`. `update` trava com `FOR UPDATE` todos os vínculos de dono da empresa e o alvo. `reactivate` volta a `active` se há linha em `whatsapp_opt_ins` do usuário na empresa, senão `invited`. Toda escrita grava `audit_log` com `maskPhone`/`maskEmail`.
- [ ] Testes: Review Focus 1, 4 e 5; vínculo já existente → `created: false`; lista do gerente só com as unidades dele e sem celular inteiro; A não lê vínculo de B.
- [ ] Run: `pnpm --filter @app/db test:int -- members`. Commit: `feat(db): repositórios de colaboradores`.

### B5. Rotas de colaboradores — CRÍTICA (permissões, sessão)
**Create:** `apps/api/src/http/settings/members-routes.ts`, `apps/api/src/modules/members/{create-member.ts,update-member.ts}`, testes. **Modify:** `composition.ts` (passar `authStore.deleteSessionsExcept`, `composition.ts:145`, e `EmailSender`), `app.ts`, `route-matrix.ts`.
**Produces:** `GET /api/settings/members` (`user:view`; gerente com recorte), `GET /:id`, `POST` (`user:manage`; 201 `memberCreatedSchema`; 409 `already_member`; 422 `contact_conflict`), `PATCH /:id` (422 `phone_shared`, `phone_in_use`), `POST /:id/deactivate`, `/:id/reactivate`. Depois da gravação: `reducesAccess` → `deleteSessionsExcept(userId, null)`; painel Sim no cadastro → e-mail de convite (falha só loga o código).
- [ ] Testes: Review Focus 2 e 3; CA02, CA05 (desativado: `resolveSender` trata como desconhecido), CA08, CA09; e-mail de convite gravado pelo envio falso; log sem telefone.
- [ ] Run: `pnpm --filter @app/api test:int -- settings-members`. Commit: `feat(api): colaboradores`.

### B6. Web: colaboradores — NATIVA
**Create:** `features/settings/members/*`, `app/(app)/configuracoes/colaboradores/page.tsx`. **Modify:** `e2e/routes.ts`.
- [ ] Lista (cartões no celular) com busca e filtros; formulário com papel, TODAS ou lista, unidade padrão automática com uma só, painel, permissões só do papel (`PERMISSIONS_BY_ROLE`); diálogo pós-cadastro com o texto e o link (`buildWhatsappLink` de `features/signup/welcome.tsx:9`, com `?text=`), "Copiar"; confirmação de troca de celular; desativar e reativar com confirmação. Gerente: somente leitura.
- [ ] Testes: painel Sim sem e-mail mostra o erro antes de enviar; gerente sem botões; permissões trocam com o papel.
- [ ] Run e commit: `feat(web): colaboradores`.

### B7. Assistente: passo de colaboradores — HAIKU
**Modify:** `features/settings/onboarding/*` (passo 3 abre `/configuracoes/colaboradores?novo=1`, sem "em breve").
- [ ] Teste do passo atualizado. Commit: `feat(web): assistente com colaboradores`.

### B8. API falsa: colaboradores — HAIKU
**Modify:** `apps/web/e2e/fake-settings.mjs` (`/api/settings/members*`: dono, gerente e um lançador; respostas mascaradas para `manager`; 403 na escrita para quem não é dono; `inviteText` fixo).
- [ ] Specs existentes verdes. Commit: `test(web): API falsa de colaboradores`.

### B9. E2E — NATIVA
**Create:** `apps/web/e2e/settings-members.spec.ts`.
- [ ] Dono cadastra lançador e vê o link `wa.me`; gerente vê celular mascarado e nenhum botão; dono desativa; celular sem rolagem; axe.
- [ ] Run e commit: `test(web): E2E de colaboradores`.

### B10. Fechamento da F6b — NATIVA
- [ ] Verificação completa; `painel.md` (F6b feita), `andamento.md` (F2-4 fechada); roteiro em `f6-roteiro.md` (seção F6b: "Pronto quando" do `painel.md`: dono cadastra funcionário, ele manda "Oi" no `pnpm dev:chat`, lança e aparece no painel com o nome dado pelo dono; rebaixar e ver a sessão cair). Propor regra/skill. Commit: `docs: F6b feita`.

**Contagem F6b:** HAIKU 3 · NATIVA 3 · CRÍTICA 4 (10 tarefas).

## Ordem e dependências
B1 → B2 → B3 → B4 → B5 → B6 → B7 → B8 → B9 → B10.
