# F7 — PWA e responsividade: plano

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development nas tarefas CRÍTICAS e superpowers:executing-plans nas demais. Os passos têm checkbox `- [ ]`. Não faça commit sem o Luís pedir.

**Goal:** deixar o painel instalável, com manifest, ícones e service worker que mostra o aviso sem conexão. Também entram toque de 44 px em tela de toque, ajuda para instalar e uma varredura que prova que nenhuma tela rola na horizontal a partir de 360 px.

**Architecture:**
- Tudo fica em `apps/web`.
- Os estáticos ficam em `public/`: `sw.js`, `offline.html` e `icons/`.
- O manifest segue a convenção do Next.
- A identidade fica em `lib/app-identity.ts` e os cabeçalhos em `lib/security-headers.ts`.
- A lógica pura fica em `lib/install-prompt.ts` e `lib/use-online-status.ts`.
- O toque usa a variante `pointer-coarse`.
- Há duas specs novas (`pwa` e `mobile-review`), com um helper em `e2e/helpers/layout.ts`.

**Tech Stack:** Next 16.4.6 (App Router, `MetadataRoute.Manifest`), Tailwind 4.3.4, Playwright (Chromium e CDP), Vitest com jsdom.

**Spec:** `docs/superpowers/specs/2026-11-26-f7-pwa-responsividade-design.md`.

## Global Constraints

- **RNF09.R2:** nenhuma rolagem horizontal a partir de **360 px**.
- **RNF09.R3:** WCAG 2.2 AA. O alvo de toque confortável é **44 px** em tela de toque (DD-44). O mínimo absoluto é **24 px** (WCAG 2.5.8): a caixa de marcação tem 16 px visíveis, e a área ampliada pelo `after:` e pelo `label` completa o mínimo.
- **RNF10.R2:** PWA instalável no celular e no computador.
- **RNF10.R3:** sem funcionamento offline. Sem conexão, aparece uma **tela de aviso**.
- **RNF10.CA01:** instala no Android e no iPhone e abre em **tela cheia** (`display: standalone`).
- **RF27.CA05:** o dashboard não rola na horizontal em **360 px**.
- **RF22.Obs4:** cartões e filtros em folha lateral (já atendido; a varredura preserva).
- **Regra 1 do `apps/web/CLAUDE.md`:** o service worker guarda só `/offline.html` e `/icons/icon-192.png`.
- **Sem dependência nova.**

## Review Focus

Cada linha vira teste na tarefa dona.

1. **Download de exportação com o service worker ativo.** `/api/*` não pode passar por `respondWith`. Teste em T5: "download continua com service worker".
2. **`install` de quem não tem sessão grava o login no lugar do `offline.html`.** Testes em T4 (`proxy.test.ts`) e em T5 ("cache guarda só a tela de aviso").
3. **Deploy novo e app instalado preso na versão velha.** Teste em T4 (`security-headers.test.ts`: `Cache-Control` do `/sw.js`) e em T5 (cabeçalho servido).
4. **Computador com mouse muda de tamanho.** Teste em T6: "no desktop o botão padrão continua com 32 px".
5. **`beforeinstallprompt` disparado no `/login` antes da casca montar.** Teste em T7: "evento capturado antes do assinante continua disponível".

## Desvios do desenho aprovado

Nenhum.

## Itens ⚠️

**CDP `Page.getInstallabilityErrors` no Chromium do Playwright**
- Quando: primeiro passo de T5.
- Plano B: conferir os critérios na spec (manifest com `name`, `start_url`, `display` e ícones de 192 e 512; service worker com `fetch`) e confirmar no aparelho pelo roteiro.

**`pointer-coarse:` no Tailwind 4.3 e `pointer: coarse` no Pixel 7 emulado**
- Quando: primeiro passo de T6. Checar `matchMedia("(pointer: coarse)").matches` no `Mobile Chrome`.
- Plano B, Tailwind: `@custom-variant pointer-coarse (@media (pointer: coarse));` no `globals.css`.
- Plano B, emulação: CDP `Emulation.setTouchEmulationEnabled` e `Emulation.setEmitTouchEventsForMouse` na spec.

**`context.setOffline(true)` alcança o `fetch` feito de dentro do service worker**
- Quando: segundo passo de T5.
- Plano B 1: `context.route("**/*", r => r.request().isNavigationRequest() ? r.abort("internetdisconnected") : r.continue())`.
- Plano B 2: CDP `Network.emulateNetworkConditions({ offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })` na sessão do service worker.
- Se nenhum funcionar, o caso vira passo do roteiro à mão.

---

### T1 — Decisão e requisitos (HAIKU)

**Files:** Modify `docs/decisoes.md`, `docs/requisitos.md`, `docs/planos/painel.md`, `docs/planos/andamento.md`.

- [ ] Em `docs/decisoes.md`, criar a **DD-44**: 26/11/2026, F7, Vigente. Ela traz as quatro "Decisões do Luís" do desenho e as chamadas 1 e 3. Referências: RNF09.R3, RNF10.R2, RNF10.R3 e F7.
- [ ] Em `docs/requisitos.md`, subir para **Versão 1.22 (26/11/2026)** e fazer três mudanças:
  - em RNF09, nova Obs: "Alvo de toque confortável = 44 px em tela de toque; no computador com mouse vale o tamanho padrão; mínimo de 24 px (WCAG 2.5.8). (DD-44)";
  - em RNF10, nova Obs: "A tela de aviso offline é a única coisa guardada no aparelho; nenhum dado de empresa nem resposta da API é guardado pelo service worker. (DD-44)";
  - uma linha no histórico de versões, se existir.
- [ ] Em `docs/planos/painel.md`, na seção F7, tirar os dois ⚠️ e citar DD-44. Na tabela de progresso, F7 passa a "Em andamento".
- [ ] Em `docs/planos/andamento.md`, linha 98, marcar o manifest do PWA como resolvido pela DD-44.
- [ ] Conferir: `git diff --stat` mostra só esses quatro arquivos.
- [ ] Sugerir commit: `docs: DD-44 e requisitos 1.22 para a F7`.

### T2 — Identidade e ícones (NATIVA)

**Files**
- Create: `apps/web/lib/app-identity.ts`, `apps/web/assets/icon.svg`, `apps/web/scripts/generate-icons.mjs` e os cinco PNG em `apps/web/public/icons/`.
- Test: `apps/web/lib/app-identity.test.ts`.

**Interfaces / Produces**
- `APP_NAME`, `APP_SHORT_NAME`, `THEME_COLOR`, `BACKGROUND_COLOR`, `ICON_BG`, `ICON_FG`: `string`, com os valores do desenho §1.
- `ICONS: readonly { src: string; sizes: string; type: "image/png"; purpose: "any" | "maskable" }[]`, com três entradas:
  - `/icons/icon-192.png`, `192x192`, `any`;
  - `/icons/icon-512.png`, `512x512`, `any`;
  - `/icons/icon-maskable-512.png`, `512x512`, `maskable`.

**Script**
1. Lê o SVG.
2. Abre `chromium.launch()` do `@playwright/test`.
3. Para cada tamanho, faz `page.setViewportSize`, `page.setContent` com o SVG em 100% e `page.screenshot({ path })`.
4. No maskable, o SVG fica em 80%, centralizado, sobre fundo `ICON_BG`.
5. Comando: `pnpm --filter @app/web exec node scripts/generate-icons.mjs`.

**Testes**
- "ícones do manifest existem em public": `fs.existsSync(path.join(publicDir, src))` para cada item.
- "há um maskable 512".
- "apple-touch e favicon existem".

**Verificação**
- [ ] `pnpm --filter @app/web exec vitest run lib/app-identity.test.ts` passa.
- [ ] `pnpm exec biome check` só nos arquivos tocados passa.
- [ ] `git status` lista os cinco PNG, prova de que o `.gitignore` não os exclui.
- [ ] Sugerir commit: `feat(web): identidade provisória e ícones do PWA`.

### T3 — Manifest, metadata e viewport (HAIKU)

**Files**
- Create: `apps/web/app/manifest.ts`.
- Modify: `apps/web/app/layout.tsx`.
- Test: `apps/web/app/manifest.test.ts`.

**Interfaces**
- Consumes: as constantes e `ICONS` da T2.
- Produces: `export default function manifest(): MetadataRoute.Manifest`, com os campos do desenho §3. No `layout.tsx`, `metadata` e `viewport` do desenho §4.

**Testes**
- `display === "standalone"`, `start_url === "/"`, `scope === "/"`, `lang === "pt-BR"`.
- `icons` igual a `ICONS`.
- `theme_color === THEME_COLOR`, `name === APP_NAME`.

**Verificação**
- [ ] `vitest run app/manifest.test.ts` passa.
- [ ] `pnpm --filter @app/web typecheck` passa.
- [ ] `pnpm --filter @app/web exec next build` passa, prova de que manifest e viewport convivem com `cacheComponents`.
- [ ] Sugerir commit: `feat(web): manifest e metadata do PWA`.

### T4 — Service worker, aviso offline, proxy e cabeçalhos (CRÍTICA, com revisor)

**Files**
- Create: `apps/web/public/sw.js`, `apps/web/public/offline.html`, `apps/web/components/service-worker-register.tsx`, `apps/web/lib/security-headers.ts`.
- Modify: `apps/web/proxy.ts`, `apps/web/next.config.ts` (`headers()` devolve `securityHeadersConfig()`) e `apps/web/components/providers.tsx`, que monta `<ServiceWorkerRegister />`.
- Test: `apps/web/proxy.test.ts` (ampliar) e `apps/web/lib/security-headers.test.ts` (criar).

**Interfaces**
- `securityHeadersConfig(): { source: string; headers: { key: string; value: string }[] }[]`. Devolve `/:path*` com os quatro cabeçalhos que hoje estão no `next.config.ts` e `/sw.js` com os três do guia.
- `ServiceWorkerRegister(): null`. No `useEffect`, faz `register("/sw.js", { scope: "/", updateViaCache: "none" })` e ignora erro, sem log de dado.
- O `sw.js` segue o desenho §5 à risca e o `offline.html` segue o §6.
- O `proxy.ts` ganha `"/offline.html"` na lista exata de `isPublic`.

**Testes**
- `proxy.test.ts`:
  - "/offline.html é público sem cookie";
  - "/qualquer.html continua exigindo sessão";
  - "/sw.js e /manifest.webmanifest são públicos".
- `security-headers.test.ts`:
  - `/sw.js` traz `Content-Type: application/javascript; charset=utf-8`, `Cache-Control: no-cache, no-store, must-revalidate` e `Content-Security-Policy: default-src 'self'; script-src 'self'`;
  - `/:path*` mantém `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options` e `Permissions-Policy` com os valores atuais.
- Revisor:
  - lê o `sw.js` contra os antiobjetivos;
  - confere que não há `cache.put` de resposta da rede;
  - confere que `/api/` e o que não for navegação saem antes do `respondWith`;
  - confere que o `install` recusa `redirected`.

**Verificação**
- [ ] `pnpm --filter @app/web exec vitest run proxy.test.ts lib/security-headers.test.ts` passa.
- [ ] `pnpm --filter @app/web typecheck` passa.
- [ ] Sugerir commit: `feat(web): service worker com aviso offline`.

### T5 — Spec de PWA (NATIVA)

**Files:** Create `apps/web/e2e/pwa.spec.ts` e `apps/web/e2e/helpers/layout.ts`. Por enquanto o helper tem só `expectNoHorizontalScroll`.

**Passos iniciais (⚠️)**
1. Confirmar o `Page.getInstallabilityErrors` por `page.context().newCDPSession(page)`.
2. Confirmar se o `setOffline` alcança o service worker.
3. Se algum falhar, usar o plano B da seção ⚠️.

**Testes** (só no `Mobile Chrome`; no desktop, `test.skip`)
- "manifest público e válido".
- "ícones servidos como png".
- "sw.js com cabeçalhos sem cache".
- "offline.html público sem redirecionar".
- "sem erros de instalabilidade".
- "sem rede, recarregar mostra Sem conexão": aparecem `getByRole("heading", { name: "Sem conexão" })` e o botão "Tentar de novo".
- "download continua com service worker": reaproveita o fluxo de `exports.spec.ts`, com `POST http://localhost:4010/__reset` e um worker.
- "cache guarda só a tela de aviso": `page.evaluate` lista as URLs em todos os caches, que devem ser só `/offline.html` e `/icons/icon-192.png`.

**Verificação**
- [ ] `pnpm --filter @app/web exec playwright test e2e/pwa.spec.ts --project="Mobile Chrome"` passa.
- [ ] Ao concluir, o mesmo com `CI=true`.
- [ ] Sugerir commit: `test(web): PWA instalável e aviso offline`.

### T6 — Toque de 44 px (NATIVA)

**Files**
- Modify: `apps/web/components/ui/button.tsx`, `apps/web/components/ui/input.tsx`, `apps/web/app/globals.css`, `apps/web/components/app-shell.tsx` (`NavLinks`), `apps/web/e2e/helpers/layout.ts` e `apps/web/CLAUDE.md`.
- Create: `apps/web/e2e/mobile-review.spec.ts`, com dois casos. A T8 completa.

**Passo inicial (⚠️):** confirmar `pointer-coarse` e a emulação.

**Interfaces**
- Classes exatas do desenho §8.
- `smallTouchTargets(page: Page, min: number, opts?: { checkboxMin?: number }): Promise<string[]>`:
  - devolve `"<nome acessível ou tagName+texto> (<w>x<h>)"` de cada alvo visível com altura ou largura menor que o mínimo;
  - seletores: `button:not([role=checkbox])`, `[role=button]`, `[role=combobox]`, `[role=tab]`, `input:not([type=hidden]):not([type=checkbox]):not([type=radio])`, `select`, `textarea`;
  - caixas de marcação (`[role=checkbox]`, `input[type=checkbox]` e `input[type=radio]`) contra `checkboxMin`, com padrão 16.

**Testes**
- "no celular, botões e campos do /lancamentos têm 44 px": `smallTouchTargets(page, 44)` igual a `[]`.
- "no desktop o botão padrão continua com 32 px": a altura do "Novo lançamento" é 32.

**Verificação e fechamento**
- [ ] A spec passa nos dois projetos.
- [ ] `entries.spec.ts` e `context.spec.ts` continuam passando no `Mobile Chrome`.
- [ ] Anotar no `apps/web/CLAUDE.md`, em "Estrutura e UI": "`button.tsx` e `input.tsx` (e qualquer outro de `components/ui` que a F7 ajustar) têm `pointer-coarse:` local (F7, DD-44); `shadcn add --overwrite` apaga isso."
- [ ] Sugerir commit: `feat(web): alvos de toque de 44 px em tela de toque`.

### T7 — Faixa offline e "Instalar o app" (NATIVA)

**Files**
- Create: `apps/web/lib/use-online-status.ts`, `apps/web/lib/install-prompt.ts` e `apps/web/components/install-dialog.tsx`.
- Modify: `apps/web/components/providers.tsx` (`useEffect(() => listenForInstallPrompt(window), [])`), `apps/web/components/app-shell.tsx` (faixa) e `apps/web/components/user-menu.tsx` (item e diálogo).
- Test: `apps/web/lib/install-prompt.test.ts`, `apps/web/lib/use-online-status.test.tsx` e `apps/web/components/install-dialog.test.tsx`.

**Interfaces**
- `type InstallMode = "installed" | "prompt" | "ios" | "manual"`
- `installMode(env: { standalone: boolean; hasPrompt: boolean; ios: boolean }): InstallMode`
- `isIos(ua: string, platform: string, maxTouchPoints: number): boolean`
- `listenForInstallPrompt(target: Window): () => void`
- `subscribeInstall(cb: () => void): () => void`
- `getInstallSnapshot(): { hasPrompt: boolean; installed: boolean }`
- `promptInstall(): Promise<"accepted" | "dismissed" | "unavailable">`
- `useOnlineStatus(): boolean`
- `InstallDialog({ mode, open, onOpenChange }: { mode: Exclude<InstallMode, "installed">; open: boolean; onOpenChange: (o: boolean) => void })`
- Textos exatos do desenho §7 e §9.

**Testes**
- `install-prompt.test.ts`:
  - tabela de `installMode` com as quatro saídas, e `standalone` vence `hasPrompt`;
  - `isIos` de iPhone, de iPad como `MacIntel` com 5 toques, e de Android;
  - "evento capturado antes do assinante continua disponível";
  - "appinstalled zera o prompt";
  - "promptInstall sem evento devolve unavailable".
- `use-online-status.test.tsx`: disparar `offline` e `online` no `window` muda o valor.
- `install-dialog.test.tsx`: cada modo mostra o seu texto; no modo `prompt`, "Instalar" chama `promptInstall`.
- Casca, no teste existente ou num novo: offline mostra `role=status` com "Sem conexão".
- `user-menu`: no modo `installed`, o item "Instalar o app" não aparece.

**Verificação**
- [ ] `vitest run` desses arquivos passa.
- [ ] `pnpm --filter @app/web typecheck` passa.
- [ ] Sugerir commit: `feat(web): aviso de sem conexão e ajuda para instalar`.

### T8 — Varredura mobile e correções (NATIVA)

**Files**
- Modify: `apps/web/e2e/mobile-review.spec.ts`.
- Modify, conforme a varredura acusar: os suspeitos `features/settings/units/unit-form.tsx:138` e `features/settings/fee-reapply/fee-reapply-dialog.tsx:131`, e componentes de `components/ui` (`Select`, `Tabs` e `Combobox`) se forem acusados.

**Teste**
- Um caso por rota: `APP_ROUTES.map(concreteRoute)` mais as cinco rotas públicas.
- Rotas do app: login de dono como nas specs atuais, copiando o padrão de `routes.spec.ts`.
- `Mobile Chrome` com `page.setViewportSize({ width: 360, height: 780 })`: `expectNoHorizontalScroll` passa e `smallTouchTargets(page, 44)` devolve `[]`.
- `Desktop Chrome`: só `expectNoHorizontalScroll`.

**Correções**
- Grade de celular em uma coluna (`grid-cols-1 sm:grid-cols-3` e equivalentes).
- `flex-wrap` onde faltar.
- Nenhuma mudança de comportamento.

**Verificação**
- [ ] A spec passa nos dois projetos, e as specs das telas corrigidas também.
- [ ] Sugerir commit: `fix(web): telas sem rolagem horizontal e com toque confortável em 360 px`.

### T9 — Fechamento (HAIKU nas docs, NATIVA na verificação)

**Verificação de nível 3** (skill `testes-direcionados`; houve mudança de config e de casca)
- [ ] `pnpm typecheck && pnpm lint && pnpm test`.
- [ ] `CI=true pnpm --filter @app/web test:e2e` nos dois projetos.

**Docs**
- [ ] `docs/planos/painel.md`: F7 "Feita (data)", próxima F8.
- [ ] `docs/planos/andamento.md` e `docs/planos/pendencias.md`: a F0-1 continua, com a nota "ícone provisório em `apps/web/assets/icon.svg`; trocar e rodar `scripts/generate-icons.mjs`".
- [ ] `CLAUDE.md` da raiz, "Estado atual".
- [ ] `apps/web/CLAUDE.md`, seção nova "PWA (F7)", com:
  - o `sw.js` nunca guarda resposta nem age em `/api/`;
  - `/offline.html` é caminho exato no proxy;
  - os ícones saem de script;
  - o helper `e2e/helpers/layout.ts`;
  - o `pointer-coarse`;
  - `VERSION` do `sw.js` muda quando o `offline.html` muda.
- [ ] Propor (sem criar) regra, skill ou hook para o que repetiu, conforme o "Fechamento de etapa" do plano do painel.

**Roteiro à mão** em `docs/planos/f7-roteiro.md`:
1. Android/Chrome por HTTPS: instalar pelo menu do navegador e pelo item "Instalar o app". O app abre em tela cheia com o ícone "FR".
2. iPhone/Safari: seguir os passos do diálogo. O app abre sem a barra do Safari.
3. Computador (Chrome ou Edge): instalar.
4. Modo avião:
   - com o app aberto, aparece a faixa;
   - ao reabrir, aparece "Sem conexão";
   - com a rede de volta, "Tentar de novo" carrega o painel.
5. Baixar uma exportação no app instalado.
6. Abrir a lista e o dashboard no celular, sem rolagem horizontal.
7. A pendência herdada (`andamento.md`, linha 130): máscara do CPF e do celular em aparelho real e com leitor de tela.
8. HTTPS local: `pnpm --filter @app/web exec next dev --experimental-https`, ou staging na F8.

- [ ] Sugerir commit: `docs: F7 feita`.

## Contagem por classe

| Classe | Tarefas |
|---|---|
| HAIKU (3) | T1, T3, docs da T9 |
| NATIVA (5) | T2, T5, T6, T7, T8 |
| CRÍTICA (1) | T4 |
