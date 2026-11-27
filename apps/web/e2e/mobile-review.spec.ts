import { expect, type Page, test } from "@playwright/test";
import { expectNoHorizontalScroll, smallTouchTargets } from "./helpers/layout";
import { APP_ROUTES, concreteRoute } from "./routes";
import { warmRoutes } from "./warm";

// F7 (DD-44, RNF09.R2 e R3): nenhuma rolagem horizontal a partir de 360 px e alvos de toque de
// 44 px em tela de toque. A varredura de todas as rotas entra na T8.
const T1 = "0190a000-0000-7000-8000-000000000001";
const MOBILE_VIEWPORT = { width: 360, height: 780 };

test.beforeAll(async () => {
  test.setTimeout(120_000);
  await warmRoutes();
});

async function signInAsOwner(page: Page) {
  await page.context().addCookies([
    { name: "better-auth.session_token", value: "sessao-falsa-dono", url: "http://localhost:3100" },
    { name: "fr_ctx", value: `${T1}.all`, url: "http://localhost:3100" },
  ]);
}

async function settle(page: Page) {
  await expect(page.getByRole("status").filter({ hasText: "Carregando…" })).toHaveCount(0);
}

// Varredura (T8): cada rota, sem rolagem horizontal; no celular de 360 px, também sem alvo de toque
// menor que 44 px. Diálogos e folhas abertos ficam de fora (filtros e detalhe têm spec própria).
// `/` não renderiza página: redireciona o dono para `/dashboard`, que já está na lista.
const OWNER_ROUTES = APP_ROUTES.filter((route) => route !== "/").map(concreteRoute);
const PUBLIC_ROUTES = ["/login", "/cadastro", "/recuperar-senha", "/termos", "/privacidade"];

async function scan(page: Page, isMobile: boolean) {
  await settle(page);
  await page.waitForLoadState("networkidle");
  await expectNoHorizontalScroll(page);
  if (isMobile) expect(await smallTouchTargets(page, 44)).toEqual([]);
}

for (const route of OWNER_ROUTES) {
  test(`varredura do dono em ${route}`, async ({ page, isMobile }) => {
    if (isMobile) await page.setViewportSize(MOBILE_VIEWPORT);
    await signInAsOwner(page);
    await page.goto(route);
    await scan(page, isMobile);
  });
}

for (const route of PUBLIC_ROUTES) {
  test(`varredura pública em ${route}`, async ({ page, isMobile }) => {
    if (isMobile) await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto(route);
    await scan(page, isMobile);
  });
}

test("no celular, botões e campos do /lancamentos têm 44 px", async ({ page, isMobile }) => {
  test.skip(!isMobile, "alvo de toque só vale em tela de toque");
  await page.setViewportSize(MOBILE_VIEWPORT);
  await signInAsOwner(page);
  await page.goto("/lancamentos?from=2026-10-01&to=2026-11-30");
  await expect(page.getByRole("link", { name: "Novo lançamento" }).first()).toBeVisible();
  await settle(page);
  await expectNoHorizontalScroll(page);
  expect(await smallTouchTargets(page, 44)).toEqual([]);
});

test("no celular, o formulário de /lancamentos/novo também tem alvos de 44 px", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "alvo de toque só vale em tela de toque");
  await page.setViewportSize(MOBILE_VIEWPORT);
  await signInAsOwner(page);
  await page.goto("/lancamentos/novo");
  await expect(page.getByRole("button", { name: "Salvar", exact: true })).toBeVisible();
  await settle(page);
  expect(await smallTouchTargets(page, 44)).toEqual([]);
});

test("no desktop o botão padrão continua com 32 px e o pequeno com 28 px", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "tamanho padrão é do computador com mouse");
  await signInAsOwner(page);
  await page.goto("/lancamentos?from=2026-10-01&to=2026-11-30");
  const novo = page.getByRole("link", { name: "Novo lançamento" }).first();
  await expect(novo).toBeVisible();
  expect((await novo.boundingBox())?.height).toBe(28); // size="sm"

  await page.goto("/lancamentos/novo");
  const salvar = page.getByRole("button", { name: "Salvar", exact: true });
  await expect(salvar).toBeVisible();
  expect((await salvar.boundingBox())?.height).toBe(32); // size="default"
});

// Diálogos com grade de colunas (suspeitos da T8): abertos no celular, sem rolagem interna na
// horizontal e com alvos de 44 px.
async function expectDialogFits(page: Page) {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // O diálogo abre com zoom: mede só depois de a animação acabar.
  await dialog.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  const overflow = await dialog.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow, "o diálogo rola na horizontal").toBeLessThanOrEqual(0);
  await expectNoHorizontalScroll(page);
  expect(await smallTouchTargets(page, 44)).toEqual([]);
}

test("no celular, o diálogo de nova unidade cabe em 360 px", async ({ page, isMobile }) => {
  test.skip(!isMobile, "varredura de diálogo é do celular");
  await page.setViewportSize(MOBILE_VIEWPORT);
  await signInAsOwner(page);
  await page.goto("/configuracoes/unidades");
  await settle(page);
  await page.getByRole("button", { name: /^Nova unidade/ }).click();
  await expectDialogFits(page);
});

test("no celular, o diálogo de reaplicar taxa cabe em 360 px", async ({ page, isMobile }) => {
  test.skip(!isMobile, "varredura de diálogo é do celular");
  await page.setViewportSize(MOBILE_VIEWPORT);
  await signInAsOwner(page);
  await page.goto("/configuracoes/formas-de-pagamento");
  await settle(page);
  await page
    .getByRole("button", { name: /^Reaplicar taxa de/ })
    .first()
    .click();
  await expectDialogFits(page);
});
