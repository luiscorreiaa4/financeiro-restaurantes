# F7 — PWA e responsividade: desenho

Aprovado pelo Luís em 26/11/2026. O plano está em `docs/superpowers/plans/2026-11-26-f7-pwa-responsividade.md`.

## Contexto e porquê

O dono usa o painel principalmente no celular (RNF09.R2). A F7 do `docs/planos/painel.md` torna o painel um app instalável (RNF10.R2, RNF10.CA01, DN-01). Também entrega a tela de aviso sem conexão (RNF10.R3) e fecha a revisão mobile (RNF09.R2 e R3, RF22.Obs4, RF27.CA05).

**Pronto quando:** o dono instala o painel no celular e usa a lista e o dashboard sem rolagem horizontal.

## O que já existe (recon de 26/11/2026)

**Base**
- Next 16.4.6, React 19.3, Tailwind 4.3.4.
- Não há `public/`, manifest, ícones, `viewport` nem service worker.
- O `layout.tsx` tem só `title: "Finanças para restaurantes"`.

**Proxy e cabeçalhos**
- No `proxy.ts`, o `STATIC_FILE` (linha 7) já deixa passar sem cookie `.webmanifest`, `.js` e `.png`.
- Ele **não** deixa passar `.html` nem caminho sem extensão, como `/icon`.
- O `next.config.ts` tem `securityHeaders` em `/:path*`, mas nenhum bloco para `/sw.js`.

**Telas no celular**
- Lançamentos, lixeira e exportações já têm tabela no desktop (`hidden md:block`) e cartões no celular.
- Os filtros de lançamentos já abrem em Sheet no celular, o que atende ao RF22.Obs4.
- As configurações são listas de cartões com `flex-wrap`.
- Na casca do celular, o menu abre em Sheet pelo hambúrguer e o seletor de contexto fica no cabeçalho. O `UserMenu` (`components/user-menu.tsx`) aparece na lateral e no cabeçalho do celular.

**Alvos de toque**
- O `Button` padrão tem `h-8` (32 px) e o de ícone `size-8`.
- Inputs e selects nativos têm `h-9`, e os links do menu `py-2`.
- O `Checkbox` do shadcn é `button role=checkbox` com `size-4`, e a área de toque é ampliada por `after:-inset-*`.
- Só o cadastro usa 44 px (`TOUCH = "h-11"`).

**E2E**
- Projetos `Desktop Chrome` e `Mobile Chrome` (Pixel 7).
- Quinze specs conferem a rolagem horizontal, cada uma com a sua cópia de `expectNoHorizontalScroll`.
- Não há varredura de todas as rotas nem teste de PWA.

**Guia do Next empacotado** (`node_modules/next/dist/docs/01-app/02-guides/progressive-web-apps.md`):
- usa `app/manifest.ts` com `MetadataRoute.Manifest`;
- registra o service worker com `updateViaCache: 'none'`;
- recomenda para o `/sw.js`: `Content-Type: application/javascript; charset=utf-8`, `Cache-Control: no-cache, no-store, must-revalidate` e `Content-Security-Policy: default-src 'self'; script-src 'self'`;
- diz que a instalação não exige offline;
- avisa que o `beforeinstallprompt` não existe no Safari do iOS.

## Objetivos

1. **Instalável** no Android, no iPhone e no computador: abre em tela cheia, com ícone na tela inicial (RNF10.CA01).
2. **Sem conexão**, aparece uma tela de aviso, e nenhum dado de empresa fica guardado no aparelho (RNF10.R3; regra 1 do `apps/web/CLAUDE.md`).
3. **Toque confortável:** 44 px em tela de toque, sem mudar nada no computador com mouse (RNF09.R3).
4. **Nenhuma tela rola na horizontal a partir de 360 px**, provado por uma varredura automática (RNF09.R2, RF27.CA05).
5. **Ajuda para instalar**, aberta pelo menu do usuário.

## Não objetivos

- Identidade visual definitiva (D-F8; a pendência F0-1 continua).
- Funcionamento offline, cache de páginas e de dados, push e Background Sync.
- O `useOffline` experimental do Next.
- Serwist ou qualquer outra dependência nova.
- Capturas de tela com comparação visual.
- Refazer as quinze cópias de `expectNoHorizontalScroll` nas specs antigas.

## Antiobjetivos (reprovam a etapa mesmo funcionando)

- O service worker guardar ou servir resposta de `/api/*` ou HTML de tela com dado de empresa.
- O download de exportação (navegação para `/api/exports/...`) quebrar por causa do service worker.
- O computador com mouse mudar de aparência.
- O painel instalado abrir uma versão velha depois de um deploy.

## Abordagens consideradas

**Ícone**
- Escolhida: ícone provisório neutro, gerado num lugar só.
- Descartadas: definir a identidade agora (a etapa cresce e depende dos sócios) e esperar um ícone do Luís (o provisório resolve até lá).

**Offline**
- Escolhida: service worker mínimo feito à mão, que guarda só uma página estática de aviso, mais uma faixa na casca.
- Descartadas: Serwist (dependência nova, faz mais do que o pedido e corre o risco de guardar dado de empresa) e ficar sem service worker (abrir o app sem rede mostra o erro do navegador, o que não atende ao RNF10.R3).

**Toque**
- Escolhida: 44 px só com `pointer: coarse`.
- Descartadas: 40 px (abaixo do cadastro) e não mexer (não atende a "confortáveis").

**Instalação**
- Escolhida: item no menu do usuário.
- Descartadas: um aviso no `/bem-vindo` e nenhuma ajuda (o iPhone ficaria sem orientação).

## Decisões do Luís (26/11/2026)

1. **Ícone provisório neutro.** A identidade continua pendente (F0-1), e a troca depois é só de arquivos.
2. **Service worker mínimo feito à mão**, sem dependência, mais a faixa "Sem conexão" na casca.
3. **44 px em tela de toque** (`pointer-coarse`) nos componentes compartilhados. O computador não muda.
4. **Item "Instalar o app" no menu do usuário**, que some quando o app já está instalado. No Android e no Chrome, abre o pedido de instalação do navegador. No iPhone, mostra os passos do Safari.

## Desenho

### 1. Identidade num lugar só

O arquivo `apps/web/lib/app-identity.ts` exporta:

| Constante | Valor |
|---|---|
| `APP_NAME` | `"Finanças para restaurantes"` |
| `APP_SHORT_NAME` | `"Finanças"` |
| `THEME_COLOR` | `"#ffffff"` |
| `BACKGROUND_COLOR` | `"#ffffff"` |
| `ICON_BG` | `"#171717"` |
| `ICON_FG` | `"#ffffff"` |

Também exporta `ICONS`, a lista do manifest. O comentário do arquivo cita D-F8 e F0-1.

Quem lê dali: o manifest, o `layout.tsx` e o script de ícones. O `offline.html` é estático e repete o nome; um comentário no próprio arquivo diz isso.

### 2. Ícones provisórios

- **Fonte:** `apps/web/assets/icon.svg`, com "FR" branco em fundo `#171717`.
- **Geração:** `apps/web/scripts/generate-icons.mjs`, com o Chromium do Playwright, que já é devDependency.
- **Arquivos** em `public/icons/`:

| Arquivo | Uso |
|---|---|
| `icon-192.png` | `any` |
| `icon-512.png` | `any` |
| `icon-maskable-512.png` | `maskable`, com o SVG em 80% sobre `ICON_BG` |
| `apple-touch-icon.png` | iPhone, 180 px e opaco |
| `favicon-32.png` | favicon |

- **Commit:** os PNG entram no repositório e o script não roda no build.
- **Por que não `app/icon.tsx`:** ele serve em `/icon`, sem extensão. O `proxy.ts` mandaria esse caminho para o login quando não há cookie.

### 3. Manifest

O `app/manifest.ts` devolve `MetadataRoute.Manifest`, servido em `/manifest.webmanifest`. O proxy já deixa esse caminho público. Campos:

- `name`, `short_name` e `description` em pt-BR, com `lang: "pt-BR"`;
- `start_url: "/"`, `scope: "/"` e `id: "/"`;
- `display: "standalone"`;
- `background_color` e `theme_color` da identidade;
- os três ícones de `ICONS`.

O `/` já redireciona por permissão (F4), e quem não tem sessão vai a `/login`.

### 4. Metadata e viewport

No `layout.tsx`:

- `metadata.applicationName`;
- `metadata.appleWebApp = { capable: true, title: APP_SHORT_NAME, statusBarStyle: "default" }`;
- `metadata.icons = { icon: "/icons/favicon-32.png", apple: "/icons/apple-touch-icon.png" }`;
- `export const viewport = { themeColor: THEME_COLOR }`.

Não há `viewport-fit=cover`.

### 5. Service worker mínimo (`public/sw.js`)

É JavaScript puro, sem build. A constante `VERSION` dá nome ao cache: `fr-offline-${VERSION}`.

- **`install`:** busca `/offline.html` e `/icons/icon-192.png` e só grava no cache se `response.ok && !response.redirected`. Depois chama `skipWaiting()`.
- **`activate`:** apaga os caches `fr-offline-*` de outra versão e chama `clients.claim()`.
- **`fetch`:** só age quando a requisição é navegação, é `GET`, é da mesma origem e o caminho **não** começa com `/api/`.
  - Nesse caso responde `respondWith(fetch(request).catch(() => caches.match("/offline.html")))`.
  - Fora desse caso não chama `respondWith`.
  - Nunca grava no cache uma resposta da rede.

**Registro**
- `components/service-worker-register.tsx` (client), montado em `components/providers.tsx`.
- Chama `navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })` quando existe `"serviceWorker" in navigator`.
- Registra também no `next dev`.

**Cabeçalhos**
- Ficam em `lib/security-headers.ts`, uma função pura que o `next.config.ts` importa: `/:path*` com os quatro cabeçalhos atuais e `/sw.js` com os três do guia.

### 6. Página de aviso offline (`public/offline.html`)

- **Formato:** HTML autocontido, com estilo inline e sem Tailwind. Tem um único script inline, só para o botão.
- **Título:** "Sem conexão".
- **Corpo:** "O painel precisa de internet para mostrar os dados. Confira o Wi-Fi ou os dados móveis e tente de novo."
- **Botão:** "Tentar de novo", que chama `location.reload()`.
- **Ícone:** `/icons/icon-192.png`.

**Proxy**
- O `proxy.ts` ganha `/offline.html` como caminho público **exato** em `isPublic`.
- A extensão `.html` continua fora do `STATIC_FILE`.

### 7. Faixa "Sem conexão" na casca

- `lib/use-online-status.ts` é um hook com `useSyncExternalStore` sobre `navigator.onLine` e os eventos `online` e `offline`. No servidor, vale `true`.
- O `app-shell.tsx`, quando está offline, mostra uma faixa com `role="status"` e o texto "Sem conexão. Os dados podem estar desatualizados e nada pode ser salvo até a internet voltar.".
- A faixa fica no mesmo lugar e com o mesmo estilo das faixas de situação da conta (DD-31).
- Os erros de API continuam como estão (`ApiError` com `status` 0).

### 8. Toque de 44 px (`pointer-coarse`)

**`components/ui/button.tsx`** (edição local do shadcn):
- `pointer-coarse:h-11` em `default`, `xs`, `sm` e `lg`;
- `pointer-coarse:size-11` em `icon`, `icon-xs`, `icon-sm` e `icon-lg`.

**`components/ui/input.tsx`:** `pointer-coarse:h-11`.

**`app/globals.css`:** uma regra de base com `@media (pointer: coarse)` que dá `min-height: 2.75rem` aos campos nativos: `input` (menos `checkbox`, `radio`, `hidden`, `range` e `file`), `select` e `textarea`. Ela cobre os selects nativos espalhados pelas telas, inclusive o `ContextSwitcher`.

**Menu:** os links do `NavLinks` (`app-shell.tsx`) ganham `pointer-coarse:py-3`.

**Componentes do shadcn sem ajuste prévio:** `Select`, `Tabs` e `Combobox` recebem `pointer-coarse:h-11` no próprio componente, se a varredura os acusar.

**Caixas de marcação:** o `Checkbox` do shadcn e as nativas ficam como estão. A área de toque útil vem do `after:` e do `label` que as envolve. A varredura exige 16 px da caixa visível.

### 9. Item "Instalar o app"

**Captura do evento (`lib/install-prompt.ts`)**
- Guarda o `beforeinstallprompt` numa variável de módulo, com `preventDefault`, e ouve `appinstalled`.
- O ouvinte é registrado em `components/providers.tsx`, na raiz, porque o evento pode disparar ainda no `/login`.

**Escolha do modo**
- A função pura `installMode({ standalone, hasPrompt, ios })` devolve `"installed" | "prompt" | "ios" | "manual"`, nesta ordem de prioridade.
- `standalone` é `matchMedia("(display-mode: standalone)")` ou `navigator.standalone`.
- `ios` é verdadeiro com iPhone, iPad ou iPod no UA, ou com `MacIntel` e `maxTouchPoints > 1`.

**Tela**
- No `components/user-menu.tsx`, o item aparece quando o modo não é `installed` e abre um diálogo. Cada instância do menu tem o seu diálogo, e só uma fica visível em cada largura.
- Conteúdo do diálogo por modo:

| Modo | O que mostra |
|---|---|
| `prompt` | Botão "Instalar", que chama `prompt()`. Se a resposta for `accepted`, o diálogo fecha e o item some. |
| `ios` | "Toque em Compartilhar (o quadrado com a seta) e depois em Adicionar à Tela de Início." |
| `manual` | "No menu do navegador, escolha Instalar app ou Adicionar à tela inicial." |

### 10. Revisão mobile e varredura

**Helper compartilhado (`e2e/helpers/layout.ts`)**
- `expectNoHorizontalScroll(page)`.
- `smallTouchTargets(page, min, { checkboxMin })`, que lista os alvos visíveis menores que o mínimo. Mede `button` (menos `role=checkbox`), `[role=button]`, `[role=combobox]`, `[role=tab]`, os campos nativos, `select` e `textarea`. Caixas de marcação usam `checkboxMin`, de 16 px.

**`e2e/mobile-review.spec.ts`**
- Percorre `APP_ROUTES`, com sessão de dono, e as rotas públicas `/login`, `/cadastro`, `/recuperar-senha`, `/termos` e `/privacidade`.
- No celular, em 360 × 780: nenhuma rolagem horizontal e nenhum alvo menor que 44 px.
- No desktop: nenhuma rolagem horizontal, e o botão padrão continua com 32 px.

**Correções**
- A varredura acusa e a tarefa corrige, sem mudar comportamento.
- Suspeitos: `features/settings/units/unit-form.tsx:138` (`grid-cols-3`) e `features/settings/fee-reapply/fee-reapply-dialog.tsx:131` (`grid-cols-2`).
- Diálogos e Sheets abertos ficam fora da varredura. Filtros e detalhe já têm spec.

### 11. Teste de PWA (`e2e/pwa.spec.ts`, no celular)

1. Sem cookie, o manifest é válido e os ícones respondem como `image/png`.
2. O `/sw.js` vem com os três cabeçalhos, e o `/offline.html` sem cookie dá 200 sem redirecionar.
3. O CDP `Page.getInstallabilityErrors` devolve uma lista vazia.
4. Sem rede, recarregar mostra "Sem conexão" e o botão "Tentar de novo".
5. A faixa da casca aparece e some junto com a rede.
6. O download de exportação continua funcionando com o service worker ativo.
7. O cache guarda só `/offline.html` e `/icons/icon-192.png`.

## Restrições

- Sem dependência nova.
- Nada de `use cache` em dado de tenant, e o service worker não guarda dado de tenant.
- Textos em pt-BR, curtos e sem jargão (RNF09.R1).
- O `packages/core` não muda.

## O que fica para o construtor

- O desenho exato do "FR".
- A ordem das correções que a varredura acusar.
- O texto fino do diálogo de instalação.

## Chamadas minhas (para o Luís conferir)

1. PNG estático gerado por script, em vez de `app/icon.tsx`, por causa do proxy.
2. O service worker registra também no `next dev`. Ele só age sem rede.
3. `/offline.html` entra como caminho público exato. A extensão `.html` não fica pública.
4. A regra global de `min-height` vale para os campos nativos. As caixas de marcação ficam com 16 px visíveis e a área do `after:` ou do `label`.
5. O ouvinte de `beforeinstallprompt` fica na raiz.
6. Sem `viewport-fit=cover`, com `statusBarStyle: "default"`.
7. As specs antigas mantêm a sua cópia do helper. Só as novas usam o compartilhado.
8. O nome é "Finanças para restaurantes", com o curto "Finanças". O `themeColor` é branco, porque não há tema escuro ativo.
9. O diálogo de instalação fica dentro do `user-menu.tsx`, um por instância.
10. `xs` e `icon-xs` também sobem para 44 px.
11. A tela de aviso cobre só a falta de rede. Um 5xx continua com as telas de erro atuais.
12. Os cabeçalhos ficam em `lib/security-headers.ts`, para o teste não carregar o `next.config.ts`.
