import { readFileSync } from "node:fs";
import { expect, type Page, test } from "@playwright/test";
import { expectNoHorizontalScroll } from "./helpers/layout";
import { warmRoutes } from "./warm";

// F7 (RNF10, DD-44): PWA instalável, aviso sem conexão e service worker que não guarda dado.
// Só no celular (`Mobile Chrome`); no computador a spec não roda. A API falsa guarda os pedidos de
// exportação em memória: `POST /__reset` antes e depois, e um worker só (o CI já usa um).
const FAKE_API = "http://localhost:4010";
const WEB = "http://localhost:3100";
const T1 = "0190a000-0000-7000-8000-000000000001";
const LIST = "/lancamentos?from=2026-10-01&to=2026-11-30";
const DONE = { timeout: 25_000 };

test.skip(({ isMobile }) => !isMobile, "PWA é verificado no celular");

test.beforeAll(async () => {
  test.setTimeout(120_000);
  await warmRoutes();
});
test.beforeEach(async ({ request }) => {
  await request.post(`${FAKE_API}/__reset`);
});
test.afterEach(async ({ request }) => {
  await request.post(`${FAKE_API}/__reset`);
});

async function signIn(page: Page) {
  await page.context().addCookies([
    { name: "better-auth.session_token", value: "sessao-falsa-dono", url: WEB },
    { name: "fr_ctx", value: `${T1}.all`, url: WEB },
  ]);
}

/** Espera o service worker ativar e assumir a página (`clients.claim`). */
async function waitForServiceWorker(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
}

test("manifest público e válido", async ({ request }) => {
  const res = await request.get("/manifest.webmanifest", { maxRedirects: 0 });
  expect(res.status()).toBe(200);
  const manifest = await res.json();
  expect(manifest).toMatchObject({
    name: "Finanças para restaurantes",
    short_name: "Finanças",
    start_url: "/",
    scope: "/",
    display: "standalone",
    lang: "pt-BR",
  });
  const sizes = manifest.icons.map(
    (i: { sizes: string; purpose: string }) => `${i.sizes}/${i.purpose}`,
  );
  expect(sizes).toEqual(expect.arrayContaining(["192x192/any", "512x512/any", "512x512/maskable"]));
});

test("ícones servidos como png", async ({ request }) => {
  for (const icon of [
    "icon-192",
    "icon-512",
    "icon-maskable-512",
    "apple-touch-icon",
    "favicon-32",
  ]) {
    const res = await request.get(`/icons/${icon}.png`, { maxRedirects: 0 });
    expect(res.status(), icon).toBe(200);
    expect(res.headers()["content-type"], icon).toContain("image/png");
  }
});

test("sw.js com cabeçalhos sem cache", async ({ request }) => {
  const res = await request.get("/sw.js", { maxRedirects: 0 });
  expect(res.status()).toBe(200);
  const h = res.headers();
  expect(h["content-type"]).toContain("application/javascript; charset=utf-8");
  expect(h["cache-control"]).toBe("no-cache, no-store, must-revalidate");
  expect(h["content-security-policy"]).toBe("default-src 'self'; script-src 'self'");
});

test("offline.html público sem redirecionar", async ({ request }) => {
  const res = await request.get("/offline.html", { maxRedirects: 0 });
  expect(res.status()).toBe(200);
  expect(await res.text()).toContain("Sem conexão");
});

test("sem erros de instalabilidade", async ({ page }) => {
  await page.goto("/login");
  await waitForServiceWorker(page);
  const cdp = await page.context().newCDPSession(page);
  const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors");
  expect(installabilityErrors).toEqual([]);
});

test("sem rede, recarregar mostra Sem conexão", async ({ page, context }) => {
  await page.goto("/login");
  await waitForServiceWorker(page);
  await context.setOffline(true);
  try {
    await page.reload();
    await expect(page.getByRole("heading", { name: "Sem conexão" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Tentar de novo" })).toBeVisible();
    await expectNoHorizontalScroll(page);
  } finally {
    await context.setOffline(false);
  }
  await page.getByRole("button", { name: "Tentar de novo" }).click();
  await expect(
    page.getByRole("button", { name: /entrar|continuar|código/i }).first(),
  ).toBeVisible();
});

test("download continua com service worker", async ({ page }) => {
  await signIn(page);
  await page.goto(LIST);
  await expect(page.getByRole("heading", { name: "Lançamentos" })).toBeVisible();
  await waitForServiceWorker(page);

  await page.getByRole("button", { name: "Exportar" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Exportar lançamentos" })).toBeVisible();
  await dialog.getByRole("radio", { name: "CSV" }).check();
  await dialog.getByRole("button", { name: "Exportar" }).click();

  const banner = page.getByRole("status").filter({ hasText: "Sua exportação está pronta." });
  await expect(banner).toBeVisible(DONE);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    banner.getByRole("button", { name: "Baixar" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^lancamentos_.*\.csv$/);
  const bytes = readFileSync(await download.path());
  expect(bytes.toString("utf8")).toContain("Data de competência");
});

test("cache guarda só a tela de aviso", async ({ page }) => {
  await signIn(page);
  await page.goto(LIST);
  await expect(page.getByRole("heading", { name: "Lançamentos" })).toBeVisible();
  await waitForServiceWorker(page);
  const urls = await page.evaluate(async () => {
    const out: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const req of await cache.keys()) out.push(new URL(req.url).pathname);
    }
    return out.sort();
  });
  expect(urls).toEqual(["/icons/icon-192.png", "/offline.html"]);
});

test("o menu do celular tem o item Instalar o app e ele abre a ajuda", async ({ page }) => {
  await signIn(page);
  await page.goto("/dashboard");
  await expect(page.getByRole("status").filter({ hasText: "Carregando…" })).toHaveCount(0);
  const menu = page.getByRole("dialog", { name: "Menu" });
  await expect(async () => {
    if (!(await menu.isVisible())) await page.getByRole("button", { name: "Abrir menu" }).click();
    await expect(menu).toBeVisible({ timeout: 2_000 });
  }).toPass();
  await menu.getByRole("button", { name: "Instalar o app" }).click();
  const help = page.getByRole("dialog", { name: "Instalar o app" });
  await expect(help).toBeVisible();
  await expect(
    help.getByText(/Instalar app ou Adicionar à tela inicial|Compartilhar|em tela cheia/),
  ).toBeVisible();
});
