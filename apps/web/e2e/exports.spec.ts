import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { type APIRequestContext, expect, type Page, test } from "@playwright/test";
import { warmRoutes } from "./warm";

test.beforeAll(async () => {
  test.setTimeout(120_000);
  await warmRoutes();
});

// A API falsa (e2e/fake-exports.mjs) guarda os pedidos em memória: cada teste começa e termina com
// `POST /__reset`. Por isso a spec roda com um worker só (o CI já usa um).
const FAKE_API = "http://localhost:4010";
const T1 = "0190a000-0000-7000-8000-000000000001";
const PERIOD = "from=2026-10-01&to=2026-11-30";
const LIST = `/lancamentos?${PERIOD}`;
// A fila anda um passo a cada consulta (3 s): queued → generating → ready leva cerca de 6 s.
const DONE = { timeout: 25_000 };

test.beforeEach(async ({ request }) => {
  await request.post(`${FAKE_API}/__reset`);
});
test.afterEach(async ({ request }) => {
  await request.post(`${FAKE_API}/__reset`);
});

// Sessão e contexto juntos: sem o `fr_ctx`, a primeira visita grava o contexto e recarrega.
async function signIn(page: Page, persona: string) {
  await page.context().addCookies([
    {
      name: "better-auth.session_token",
      value: `sessao-falsa-${persona}`,
      url: "http://localhost:3100",
    },
    { name: "fr_ctx", value: `${T1}.all`, url: "http://localhost:3100" },
  ]);
}

/** Cria um pedido direto na API falsa e o deixa pronto (cada consulta da lista avança um passo). */
async function seedReadyExport(request: APIRequestContext, persona: string, q?: string) {
  const headers = {
    cookie: `better-auth.session_token=sessao-falsa-${persona}; fr_ctx=${T1}.all`,
    "x-context": `${T1}.all`,
    "content-type": "application/json",
  };
  await request.post(`${FAKE_API}/api/exports`, {
    headers,
    data: {
      format: "csv",
      content: "entries",
      filters: { from: "2026-10-01", to: "2026-10-31", ...(q ? { q } : {}) },
      clientRequestId: randomUUID(),
    },
  });
  for (let step = 0; step < 3; step++) {
    await request.get(`${FAKE_API}/api/exports`, { headers });
  }
}

async function openList(page: Page, persona: string) {
  await signIn(page, persona);
  await page.goto(LIST);
  await expect(page.getByRole("heading", { name: "Lançamentos" })).toBeVisible();
}

async function openExportDialog(page: Page) {
  await page.getByRole("button", { name: "Exportar" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Exportar lançamentos" })).toBeVisible();
  return dialog;
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test("o dono exporta em CSV, a faixa de pronta aparece e Baixar entrega o arquivo com BOM (RF29)", async ({
  page,
}) => {
  await openList(page, "dono");
  const dialog = await openExportDialog(page);
  await expect(dialog.getByText("Período: 01/10/2026 a 30/11/2026")).toBeVisible();
  await dialog.getByRole("radio", { name: "CSV" }).check();
  await dialog.getByRole("button", { name: "Exportar" }).click();

  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("status").filter({ hasText: "Exportação na fila" })).toBeVisible();

  const banner = page.getByRole("status").filter({ hasText: "Sua exportação está pronta." });
  await expect(banner).toBeVisible(DONE);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    banner.getByRole("button", { name: "Baixar" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^lancamentos_.*\.csv$/);
  const path = await download.path();
  const bytes = readFileSync(path);
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  expect(bytes.toString("utf8")).toContain("Data de competência");
});

test("só o dono vê o conteúdo COMPLETO; o contador exporta só lançamentos (RF29.R3)", async ({
  page,
}) => {
  await openList(page, "dono");
  const owner = await openExportDialog(page);
  await expect(owner.getByRole("radio", { name: /Completo/ })).toBeVisible();
  await expect(owner.getByText("Inclui lixeira e histórico.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();

  await page.context().clearCookies();
  await openList(page, "accountant");
  const accountant = await openExportDialog(page);
  await expect(accountant.getByRole("radio", { name: "CSV" })).toBeVisible();
  await expect(accountant.getByRole("radio", { name: /Completo/ })).toHaveCount(0);
});

test("o lançador não vê o botão, e /exportacoes diz que não há acesso (RF29.Obs1)", async ({
  page,
}) => {
  await openList(page, "staff");
  await expect(page.getByRole("button", { name: "Exportar" })).toHaveCount(0);
  await page.goto("/exportacoes");
  await expect(
    page.getByRole("heading", { name: "Você não tem acesso a esta página" }),
  ).toBeVisible();
});

test("a conta somente leitura também exporta: exportar é leitura (DD-42)", async ({ page }) => {
  await openList(page, "readonly");
  await expect(page.getByRole("button", { name: "Exportar" })).toBeVisible();
});

test("um pedido que falha termina em Falhou, com a faixa e a explicação (RF29.R4)", async ({
  page,
}) => {
  await signIn(page, "dono");
  await page.goto(`${LIST}&q=falhar`);
  await expect(page.getByRole("heading", { name: "Lançamentos" })).toBeVisible();
  const dialog = await openExportDialog(page);
  await dialog.getByRole("button", { name: "Exportar" }).click();

  const banner = page.getByRole("status").filter({ hasText: "A exportação falhou." });
  await expect(banner).toBeVisible(DONE);
  await banner.getByRole("link", { name: "Ver exportações" }).click();
  await expect(page).toHaveURL(/\/exportacoes$/);
  await expect(page.getByRole("heading", { name: "Exportações" })).toBeVisible();
  const table = page.locator("table");
  const failed = (await table.isVisible()) ? table : page.locator("main ul");
  await expect(failed.getByText("Falhou").first()).toBeVisible();
});

test("/exportacoes lista o pedido e não rola na horizontal no celular de 360 px", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await seedReadyExport(request, "dono");
  await signIn(page, "dono");
  await page.goto("/exportacoes");
  await expect(page.getByRole("heading", { name: "Exportações" })).toBeVisible();
  await expect(page.locator("main ul > li").getByText("Pronta")).toBeVisible();
  await expect(page.locator("main ul > li").getByRole("button", { name: "Baixar" })).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test("o axe não acha violação séria ou crítica na tela e no diálogo", async ({ page, request }) => {
  await seedReadyExport(request, "dono");
  await signIn(page, "dono");
  await page.goto("/exportacoes");
  await expect(page.getByRole("heading", { name: "Exportações" })).toBeVisible();
  await expect(page.getByText("Pronta").filter({ visible: true }).first()).toBeVisible();
  const screen = await new AxeBuilder({ page }).analyze();

  await page.goto(LIST);
  await expect(page.getByRole("heading", { name: "Lançamentos" })).toBeVisible();
  await openExportDialog(page);
  const dialog = await new AxeBuilder({ page }).analyze();

  for (const { violations } of [screen, dialog]) {
    const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  }
});
