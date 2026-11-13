# F2: Conta, unidade e permissões (desenho)

> Desenho aprovado em 10/11/2026. Cita RF e CA de `docs/requisitos.md` e não copia regra; a decisão nova é a DD-31 (primeira tarefa do plano).


## Contexto e porquê

O painel abre hoje sem noção de empresa ou unidade. O `/api/me` devolve só `{userId, name, email}`, a sessão não guarda empresa e a API do painel não tem o pool do papel `app` nem usa `withTenant`. Nenhuma tela de dados (F3 em diante) pode nascer sem três coisas: saber em qual empresa e unidade o usuário está, revalidar isso a cada requisição e aplicar papel e permissões. A F2 entrega essa base e fecha quatro heranças da F1:
- F1a-1: renovar o cookie de "manter conectado" e tratar 401 com ida para `/login`.
- F1b-12: o `/api/me` passa a respeitar o `preferred_at`.
- F1c-6: o perfil passa a ser lido no servidor.
- O Contador no MVP (DD-03).

**Requisitos:**
- RF02.R6 e RF02.CA05, CA06, CA07.
- RF06.R1, R2, R3 (só a base), R5 e R6; RF06.CA02 (base), CA04 (já no `core`) e CA06.
- RF05.R3 a R8 e RF05.CA09 (a parte "vale na próxima requisição").
- RF37 (situação da conta).
- RNF02.R6 e RNF02.CA01.
- RF36: o Contador entra no seletor; a lista e o convite ficam na F13.

## Objetivos
1. Empresa ativa e unidade ativa resolvidas pela API em toda requisição do painel e revalidadas contra `memberships` e `tenants.status` (RF02.R6).
2. Seletor de empresa e de unidade no topo, visível só para quem tem mais de uma opção. "Todas as unidades" aparece só para quem tem `all_units` (RF02.R6).
3. Menu e páginas filtrados por `can()` do `core`. A API repete a checagem com `requirePermission(action)` (RF06.R2, RF02.Obs2).
4. Trocar de empresa nunca mostra dado da anterior, nem em outra aba nem depois do botão voltar (RF02.CA05, RNF02.R6).
5. Faixa de "somente leitura" e de "conta cancelada" (RF37), com a regra de leitura e escrita no `core`.
6. Sessão renovada pelo navegador, e 401 em qualquer chamada leva a `/login?next=`.

## Fora da F2 (não objetivos)
- **Contador:** a tela-lista de empresas com busca por nome ou CNPJ e o convite com aviso de folha ficam na F13 (escolha sua). O resumo por empresa fica na v1.1.
- **Filtro de categoria sensível:** a filtragem de lançamentos na resposta (RF06.R3, CA02) é da F3, porque ainda não existe endpoint de lançamentos. A F2 entrega o ator pronto para isso.
- **Encerrar sessões ao rebaixar papel ou desativar vínculo** (RF05 "Alteração", CA09 "sessão encerrada"): é da F6, onde a edição acontece. A F2 garante que a próxima requisição já usa o papel novo e que vínculo desativado dá 401.
- Assinatura e mudança de situação da conta: F9.
- Pendências F1c-9, -10, -12 e -17 continuam abertas.

## Anti-objetivos (falha mesmo que "funcione")
- Um cookie ou cabeçalho do cliente decidir o tenant sem revalidação no servidor.
- Dado de tenant em `use cache` ou numa chave de query sem empresa e unidade.
- Trocar de empresa no painel mudar para onde vão as mensagens do WhatsApp.
- O painel calcular permissão que a API não repete.

## Abordagens consideradas
| | Abordagem | Troca |
|---|---|---|
| **Escolhida** | **Cookie de contexto** httpOnly gravado pela API, revalidado a cada requisição, com o cabeçalho `X-Context` do navegador e resposta 409 quando outra aba trocou | Segue o texto do RF02.R6 e do CA05 e não pede migration de sessão. As abas compartilham o contexto, e o 409 resolve isso |
| | Empresa na URL (`/e/{id}/...`) | Abas independentes, mas obriga a mover todas as rotas, e o botão voltar mostra a empresa anterior, contra a leitura literal do CA05 |
| | Colunas em `sessions` | Mesmo comportamento do cookie, com uma migration e uma escrita a mais |

**Última usada (escolha sua):** o cookie lembra empresa e unidade **por aparelho** e dura 1 ano. Sem cookie, vale a empresa de `preferred_at` mais recente, a mesma ordem do canal (DE-25). O painel **não grava** `preferred_at`.

## Como funciona

### Cookie de contexto
- **Nome** (chamada minha): `fr_ctx` em HTTP e `__Secure-fr_ctx` em HTTPS, seguindo o padrão do cookie de sessão.
- **Atributos:** httpOnly, `SameSite=Lax`, `Path=/`, `Max-Age` de 1 ano, `Secure` em HTTPS.
- **Valor:** `<tenantId>.<unitId|all>`, sem assinatura. Não precisa de assinatura porque a API revalida cada valor: qualquer cookie forjado cai na mesma regra de "vínculo existe e está ativo" (RF02.CA06).
- **Quem grava:** só a API, em `POST /api/context` (pelo rewrite, então é cookie de primeira parte). O Next nunca grava.

### Resolução do contexto na API (a cada requisição)
1. `checkSession` valida a sessão, como hoje. Sem sessão, ou sem nenhum vínculo de painel válido, a resposta é 401 (DD-25, RF02.CA07).
2. `listPanelMemberships(userId)`, pelo papel `app_auth` numa consulta só, traz os vínculos `active` com `deactivated_at` nulo e liberação de painel (papel owner, manager ou accountant, ou `panel_access`). Cada um vem com `tenants.name`, `tenants.status`, `all_units`, `default_unit_id`, `permissions` e as unidades de `membership_units`.
3. `resolvePanelContext` (função pura no `core`) segue esta ordem:
   - Filtra pela situação da conta com `accountAllows` (abaixo).
   - Se o cookie aponta para um vínculo válido e a unidade é acessível (`all` só com `all_units`), o contexto vem do cookie.
   - Senão, vale o fallback: o vínculo de `preferred_at` mais recente, depois o mais antigo, depois o id. Como unidade, `all` se `all_units`; senão `default_unit_id`, se acessível; senão a primeira unidade acessível pelo id.
   - O resultado é `{ context, source: "cookie" | "fallback" | "invalid_cookie" }`, ou `no_access`.
4. **Rotas sem tenant** (`/api/me`, `/api/context`, perfil): aceitam qualquer `source` e devolvem o contexto efetivo.
5. **Rotas de dados de tenant** (as da F2 e as que vierem):
   - `source === "invalid_cookie"` responde **403 `context_invalid`**, sem revelar dado nenhum (RF02.CA06, RF06.R5).
   - Cabeçalho `X-Context` ausente ou diferente do contexto efetivo responde **409 `context_changed`**.
   - Tudo certo: roda em `withTenant(appDb, tenantId, ...)` com `request.panel = { tenantId, unitId, membershipId, actor, accountStatus }`.
6. `requirePermission(action)` usa `can(request.panel.actor, action, { unitId })` e responde 403 `forbidden`.

### Situação da conta (RF37), regra pura no `core`
`accountAllows(status, role)` devolve `{ read, write }`:

| Situação | Leitura | Escrita | O que acontece no painel |
|---|---|---|---|
| `active` | sim | sim | normal |
| `read_only` | sim | não | faixa "Conta em modo somente leitura" (RF37.R3) |
| `canceled` | só o owner | não | faixa para o dono; os outros papéis não veem a empresa (RF37.R6) |
| `closed` | não | não | a empresa some da lista |

Rotas de escrita de tenant (F3+) usam `requireWritable`, que responde 403 `account_read_only`. A F2 entrega o guard com teste, mas ainda não tem rota de escrita de tenant que o use. Se `hasActiveMembership` passar a considerar `tenants.status`, quem só tem empresas `closed` recebe 401.

### Rotas da API
- **`GET /api/me`** (estende a atual):
  - Devolve `{ userId, name, email, companies: [{ tenantId, name, role, accountStatus }], context: { tenantId, unitId, role, permissions, units, panelAccess, accountStatus, allowedActions: Action[] } , contextSource }`.
  - `allowedActions` é a lista de ações de `can()` sem unidade, para o menu. É conforto; a API repete a checagem.
  - O nome da unidade não vem aqui. Vem de `/api/units`, que roda sob RLS.
- **`POST /api/context { tenantId, unitId | "all" }`**: valida com a mesma função pura e grava o cookie. Contexto inválido responde 403 `context_invalid`, e o cookie fica como estava.
- **`GET /api/units`**: unidades ativas da empresa ativa, filtradas pelo acesso do ator, via `withTenant` no papel `app`. Exige `X-Context`. É a primeira rota de tenant do painel e prova a cadeia inteira (RNF02.CA01).

### Banco
- **Migration 0017 (sem tabela nova)**:
  - `GRANT SELECT (id, name, status) ON tenants TO app_auth` e `GRANT SELECT ON membership_units TO app_auth`.
  - Políticas `tenants_auth_select` e `membership_units_auth_select` `FOR SELECT TO app_auth USING (true)`.
  - `GRANT SELECT (id, tenant_id, status) ON units TO app_auth`, com a política `units_auth_select` (chamada minha 1, em "Respostas da conferência").
  - **Chamada minha:** o `app_auth` já lê `memberships` e `users` inteiros. Ler nome e situação da empresa e a lista de unidades de acesso está no mesmo nível de exposição, e evita N transações por requisição para um contador com muitas empresas. Nomes de unidade continuam só pelo `app` sob RLS.
- **`hasActiveMembership`** passa a exigir `tenants.status` diferente de `closed`, e diferente de `canceled` quando o papel não é owner. Essa é a mesma regra de `accountAllows`.

### Web
- **`lib/auth/session.ts`:** `currentSession` passa a devolver o `Me` completo, com o contexto, e o schema Zod fica no contrato.
- **`lib/api/client.ts`:**
  - Opção `context?: () => string | null`: quando existe, envia `X-Context`.
  - Opção `onError?: (e: ApiError) => void`.
  - Cliente do navegador: 401 manda para `/login?next=<rota atual>`; 409 `context_changed` faz `window.location.reload()`.
  - O `QueryCache` global faz o mesmo para erros de query.
- **`lib/query/keys.ts`:** `tenantKey(ctx, ...parts)` gera `["t", tenantId, unitId, ...parts]`. Chave de dado de tenant sem essa fábrica é proibida (regra no `apps/web/CLAUDE.md`).
- **`<SessionKeeper>`** (client, na casca):
  - Uma vez por carregamento chama `GET /api/me` pelo navegador. Isso renova o cookie de sessão pelo rewrite e fecha a F1a-1.
  - Se `contextSource !== "cookie"`, chama `POST /api/context` com o contexto efetivo, para gravar o cookie.
  - No `pageshow` com `persisted`, recarrega a página, para o bfcache não mostrar a empresa anterior (RF02.CA05).
- **`<ContextSwitcher>`** no topo (desktop e celular):
  - Seletor de empresa, só se houver mais de uma.
  - Seletor de unidade, só se houver mais de uma opção, com "Todas as unidades" só para `all_units`.
  - Busca de texto quando há mais de 8 empresas. **Chamada minha**, sem dependência nova: campo de filtro com os componentes que já existem.
  - Trocar empresa ou unidade chama `POST /api/context` e depois `window.location.assign("/")`. O recarregamento completo é **chamada minha**: limpa o cache do router e o do TanStack de uma vez.
- **Menu:** `NavItem` ganha `action?: Action`. A casca filtra com `allowedActions`. Mapa (chamada minha, tirado da matriz 2.3):

| Item | Ação |
|---|---|
| Dashboard | `report:view` |
| Lançamentos | `entry:view` |
| Exportações | `export:data` |
| Configurações | `catalog:view` |
| Perfil, Nova empresa | sem ação |

- **`<RequireAction action>`:** componente de servidor que mostra "Você não tem acesso a esta página" quando falta a ação. É só conforto.
- **Faixas de RF37** na casca, a partir de `context.accountStatus`.
- **F1c-6:** `/perfil` faz o prefetch no servidor com `HydrationBoundary`.

## Restrições
- Regras inegociáveis 2 (RLS e `withTenant`), 6 e 9 do `CLAUDE.md`. Nunca logar o valor do cookie nem o e-mail.
- `apps/web/CLAUDE.md`: proibido `use cache` com dado de tenant, toda chamada passa por `createApiClient` com Zod, toda tela nova tem teste no Pixel 7.
- Nenhuma dependência nova.
- O `proxy.ts` continua só olhando se o cookie de sessão existe.

## Respostas da conferência (revisor independente, 10/11/2026)

### Respondidas pelo projeto
- **Ordem do fallback:** `preferred_at DESC NULLS LAST`, depois `memberships.created_at ASC`, depois `id ASC`. É a mesma ordem do `resolveSender` (DE-25).
- **`allowedActions` sem unidade:** o `can()` ignora o escopo de unidade quando `unitId` não vem, e isso basta para o menu. `all` só existe para quem tem `all_units`, então o `requirePermission` passa `unitId: undefined`.
- **O que entra em `companies`:** os vínculos que passam por `accountAllows(...).read` e têm acesso ao painel. Cada um leva `accountStatus`, e o seletor mostra a etiqueta "cancelada" para o dono.
- **Exportação com a conta `canceled`:** conta como leitura. O RF37.R6 garante ao dono leitura e exportação por 90 dias.
- **Laço de 401:** não acontece. O `proxy.ts` não manda quem tem cookie para fora de `/login`. Vínculo perdido dá 401, o painel leva a `/login`, e o login é recusado por `sessionBlocked`, como já funciona hoje (DD-25, RF02.CA07).
- **Chamadas do servidor (SSR e prefetch):**
  - `serverApi()` repassa todos os cookies da requisição.
  - O `X-Context` sai do `currentSession()`, que tem `cache()` do React por requisição.
  - Um 409 durante a renderização no servidor cai no `error.tsx`, que já existe. Não deve acontecer, porque o cookie e o cabeçalho saem da mesma requisição.

### Chamadas minhas (confira)
1. **O `app_auth` também lê `units(id, tenant_id, status)`:** concessão de colunas mais política `USING (true)`. Sem isso, a API não consegue validar a unidade do cookie para quem tem `all_units`, nem descartar unidade inativa. O nome da unidade continua saindo só pelo `app`, sob RLS.
   - Em `PanelMembership.unitIds` vêm as unidades **acessíveis e ativas**: todas as ativas da empresa quando `all_units`; a interseção com `membership_units` nos outros casos.
2. **Fallback em dois níveis:**
   - Empresa do cookie válida e unidade inválida: a empresa se mantém e só a unidade é recalculada.
   - Empresa inválida: vale o fallback global.
   - Nos dois casos `source = "invalid_cookie"`.
3. **A casca espera o cookie:**
   - Quando `contextSource !== "cookie"`, a casca não renderiza a página. Mostra "Carregando…" enquanto o `<SessionKeeper>` grava o cookie com `POST /api/context` e recarrega.
   - Com isso, nenhuma consulta de tenant sai com cookie inválido, e o 403 `context_invalid` não precisa de tratamento global no cliente.
4. **Aviso de acesso perdido:** com `invalid_cookie`, o recarregamento vai para `?aviso=acesso-removido`. A casca mostra uma vez "Você não tem mais acesso à empresa ou unidade anterior", sem dizer o nome. Sem cookie (aparelho novo) não aparece aviso.
5. **Troca de usuário no mesmo aparelho:** as respostas de sucesso de `sign-in/*` e de `sign-out` em `/api/auth/*` passam a expirar o `fr_ctx`, com `Max-Age=0`. O cookie de um usuário nunca chega ao outro.
6. **Uma fonte só para a regra de acesso:**
   - `hasActiveMembership` (SQL, usada pelo login e pelo `checkSession`) ganha a mesma regra de `tenants.status`.
   - Um teste de integração confere que ela devolve `true` se e somente se `resolvePanelContext(listPanelMemberships(u))` dá `ok`, para todas as personas das fixtures.
7. **Vínculo sem nenhuma unidade acessível e ativa:** não serve ao painel naquela empresa e fica fora de `companies`.
8. **409 por tipo de chamada:**
   - Em leitura (GET, pelo `QueryCache`), o 409 recarrega a página.
   - Em mutação, ele **não recarrega**: vira a mensagem "A empresa foi trocada em outra aba. Recarregue para continuar.", e o formulário não se perde. Já fica assim no `client.ts` para valer da F3 em diante.
9. **"Nova empresa" continua para todo usuário logado,** como a F1b decidiu (DD-25 item 5). Não reabro.

## O que fica para quem constrói
Nomes internos de componentes e arquivos não fixados no plano, o texto exato das faixas e mensagens (português, curto) e o visual do seletor dentro do shadcn `base-nova`.

