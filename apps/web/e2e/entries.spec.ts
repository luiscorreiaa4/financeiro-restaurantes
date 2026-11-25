import { expect, type Locator, type Page, test } from "@playwright/test";
import { warmRoutes } from "./warm";

test.beforeAll(async () => {
  test.setTimeout(120_000);
  await warmRoutes();
});

// Dados fixos da API falsa (e2e/fake-entries.mjs): 60 lançamentos da empresa T1, de 01/10 a
// 29/11/2026, metade na Matriz (U1) e metade na Filial (U2). O período vai sempre explícito na
// URL: o padrão da tela é o mês corrente do relógio de verdade.
const T1 = "0190a000-0000-7000-8000-000000000001";
const U1 = "0190a000-0000-7000-8000-0000000000a1";
const U2 = "0190a000-0000-7000-8000-0000000000a2";
const OWNER_ID = "0190a600-0000-7000-8000-000000000001";
const PERIOD = "from=2026-10-01&to=2026-11-30";
const BOTH_UNITS = `unitIds=${U1}&unitIds=${U2}`;

// Sessão e contexto juntos: sem o `fr_ctx`, a primeira visita grava o contexto e recarrega.
async function signIn(page: Page, persona: string, unit: string) {
  await page.context().addCookies([
    {
      name: "better-auth.session_token",
      value: `sessao-falsa-${persona}`,
      url: "http://localhost:3100",
    },
    { name: "fr_ctx", value: `${T1}.${unit}`, url: "http://localhost:3100" },
  ]);
}

/** Descrições visíveis: linhas da tabela no computador, cartões no celular. */
function descriptions(page: Page, isMobile: boolean): Locator {
  return isMobile
    ? page.locator("main ul > li button > span:first-child > span:first-child")
    : page.locator('table tbody tr td button:not([role="checkbox"])');
}

/** Espera a lista chegar (o dado só vem depois da hidratação, então a tela já responde). */
async function waitForList(page: Page, isMobile: boolean) {
  await expect(descriptions(page, isMobile).first()).toBeVisible();
}

/** Onde estão os filtros: abertos na página no computador, na folha lateral no celular. */
async function openFilters(page: Page, isMobile: boolean): Promise<Locator> {
  if (!isMobile) return page.locator("main");
  const dialog = page.getByRole("dialog");
  await expect(async () => {
    if (!(await dialog.isVisible())) await page.getByRole("button", { name: "Filtros" }).click();
    await expect(dialog).toBeVisible({ timeout: 2_000 });
  }).toPass();
  return dialog;
}

async function closeFilters(page: Page, isMobile: boolean) {
  if (!isMobile) return;
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toBeHidden();
}

const totals = (page: Page) => page.getByRole("region", { name: "Totais do filtro" });

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test("filtros de tipo e categoria ficam na URL e sobrevivem a recarregar e ao voltar (RF22.CA01)", async ({
  page,
  isMobile,
}) => {
  await signIn(page, "dono", "all");
  await page.goto(`/lancamentos?${PERIOD}`);
  await waitForList(page, isMobile);

  let filters = await openFilters(page, isMobile);
  await filters.getByLabel("Tipo").selectOption("expense");
  await expect(page).toHaveURL(/type=expense/);
  await filters.locator("summary", { hasText: "Categorias" }).click();
  await filters.getByLabel("Mercearia", { exact: true }).check();
  await expect(page).toHaveURL(/categoryIds=0190a200-0000-7000-8000-000000000002/);
  await closeFilters(page, isMobile);

  await waitForList(page, isMobile);
  const filtered = await descriptions(page, isMobile).allTextContents();
  expect(filtered.length).toBeGreaterThan(0);
  expect(filtered.every((text) => text.startsWith("Mercearia"))).toBe(true);

  await page.reload();
  await waitForList(page, isMobile);
  await expect(page).toHaveURL(/type=expense/);
  expect(await descriptions(page, isMobile).allTextContents()).toEqual(filtered);
  filters = await openFilters(page, isMobile);
  await expect(filters.getByLabel("Tipo")).toHaveValue("expense");
  await closeFilters(page, isMobile);

  // Voltar desfaz o último filtro (categoria) e mantém o anterior (tipo).
  await page.goBack();
  await expect(page).toHaveURL(/type=expense/);
  await expect(page).not.toHaveURL(/categoryIds/);
  await expect(descriptions(page, isMobile).filter({ hasText: "Energia" }).first()).toBeVisible();
});

test('a busca por "450,00" acha o lançamento de valor exato (RF22.CA05)', async ({
  page,
  isMobile,
}) => {
  await signIn(page, "dono", "all");
  await page.goto(`/lancamentos?${PERIOD}`);
  await waitForList(page, isMobile);

  const filters = await openFilters(page, isMobile);
  await filters.getByLabel("Buscar").fill("450,00");
  await filters.getByRole("button", { name: "Buscar" }).click();
  await expect(page).toHaveURL(/q=450%2C00/);
  await closeFilters(page, isMobile);

  await expect(descriptions(page, isMobile)).toHaveText(["Energia #3"]);
  await expect(totals(page)).toContainText("1 lançamento");
  await expect(totals(page)).toContainText("R$ 450,00");
});

test("ordenar por valor pede a ordem ao servidor e marca o cabeçalho", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "Os cabeçalhos ordenáveis são da tabela do computador.");
  await signIn(page, "dono", "all");
  await page.goto(`/lancamentos?${PERIOD}`);
  await waitForList(page, isMobile);

  const header = page.getByRole("columnheader", { name: /Valor/ });
  await header.getByRole("button").click();
  await expect(page).toHaveURL(/sort=amount/);
  await expect(header).toHaveAttribute("aria-sort", "descending");

  // Valor bruto de cada linha, na ordem em que o servidor mandou: nunca crescente.
  const cells = page.locator("table tbody tr td:nth-last-child(6) span:first-child");
  await expect(cells.first()).toBeVisible();
  const cents = (await cells.allTextContents()).map((text) => Number(text.replace(/\D/g, "")));
  expect(cents.length).toBeGreaterThan(5);
  expect(cents).toEqual([...cents].sort((a, b) => b - a));

  await header.getByRole("button").click();
  await expect(page).toHaveURL(/dir=asc/);
  await expect(header).toHaveAttribute("aria-sort", "ascending");
});

test('"Carregar mais" traz a página seguinte sem repetir lançamento (RF22.CA04)', async ({
  page,
  isMobile,
}) => {
  // Gerente com as duas unidades no filtro: 58 lançamentos (os 2 de folha ficam de fora).
  await signIn(page, "manager", U1);
  await page.goto(`/lancamentos?${PERIOD}&${BOTH_UNITS}`);
  await waitForList(page, isMobile);
  await expect(descriptions(page, isMobile)).toHaveCount(50);

  await page.getByRole("button", { name: "Carregar mais" }).click();
  await expect(descriptions(page, isMobile)).toHaveCount(58);
  const all = await descriptions(page, isMobile).allTextContents();
  expect(new Set(all).size).toBe(58);
  await expect(page.getByRole("button", { name: "Carregar mais" })).toBeHidden();
  await expect(totals(page)).toContainText("58 lançamentos");
});

test("lançador continua vendo só os próprios, mesmo com outro autor na URL (RF22.CA03)", async ({
  page,
  isMobile,
}) => {
  await signIn(page, "staff", U1);
  await page.goto(`/lancamentos?${PERIOD}&createdBy=${OWNER_ID}`);
  await waitForList(page, isMobile);

  await expect(totals(page)).toContainText("15 lançamentos");
  await expect(descriptions(page, isMobile)).toHaveCount(15);
  // Só a lista: o nome do usuário logado também aparece na casca.
  const list = isMobile ? page.locator("main ul") : page.locator("table tbody");
  await expect(list.getByText("Dono Demo")).toHaveCount(0);
  await expect(list.getByText("Lançador Demo").first()).toBeVisible();

  // O lançador não tem o filtro "Lançado por" (RF22.R3).
  const filters = await openFilters(page, isMobile);
  await expect(filters.getByLabel("Tipo")).toBeVisible();
  await expect(filters.getByLabel("Lançado por")).toHaveCount(0);
});

test("gerente sem VER_FOLHA vê o aviso de valores restritos e nada de Salários (RF22.Obs7)", async ({
  page,
  isMobile,
}) => {
  await signIn(page, "manager", U1);
  await page.goto(`/lancamentos?${PERIOD}&${BOTH_UNITS}`);
  await waitForList(page, isMobile);

  await expect(totals(page)).toContainText("Há valores restritos que não entram nestes totais.");
  await page.getByRole("button", { name: "Carregar mais" }).click();
  await expect(descriptions(page, isMobile)).toHaveCount(58);
  await expect(page.getByText(/Salários/).filter({ visible: true })).toHaveCount(0);

  // Nem como opção de filtro.
  const filters = await openFilters(page, isMobile);
  await filters.locator("summary", { hasText: "Categorias" }).click();
  await expect(filters.getByLabel("Mercearia", { exact: true })).toBeVisible();
  await expect(filters.getByLabel("Salários", { exact: true })).toHaveCount(0);
});

test("abrir o lançamento mostra origem como texto e o histórico; voltar fecha (RF25.CA01, CA03)", async ({
  page,
  isMobile,
}) => {
  // Nenhum diálogo do navegador pode abrir: o texto original traz um <script>.
  page.on("dialog", () => {
    throw new Error("o texto da origem foi executado como HTML");
  });
  await signIn(page, "manager", U1);
  // O lançamento 18 (Filial) é o que tem <script> no texto original.
  await page.goto(`/lancamentos?${PERIOD}&${BOTH_UNITS}&q=%2318`);
  await expect(descriptions(page, isMobile)).toHaveCount(1);

  await descriptions(page, isMobile).first().click();
  await expect(page).toHaveURL(/entry=0190a700-0000-7000-8000-000000000018/);
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByRole("tab", { name: "Dados" })).toBeVisible();

  await drawer.getByRole("tab", { name: "Origem" }).click();
  await expect(drawer.getByText("<script>alert(1)</script>")).toBeVisible();
  await expect(drawer.getByText(/Canal: WhatsApp/)).toBeVisible();
  expect(await page.locator("[role=dialog] script").count()).toBe(0);

  await drawer.getByRole("tab", { name: "Histórico" }).click();
  await expect(drawer.getByText(/Criação · WhatsApp/)).toBeVisible();

  if (isMobile) await expectNoHorizontalScroll(page);

  await page.goBack();
  await expect(drawer).toBeHidden();
  await expect(page).not.toHaveURL(/entry=/);
});

test('endereço com lançamento invisível mostra só "Lançamento não encontrado"', async ({
  page,
  isMobile,
}) => {
  await signIn(page, "manager", U1);
  // O lançamento 9 é de folha (Salários): o gerente não o vê nem pelo endereço.
  await page.goto(`/lancamentos?${PERIOD}&entry=0190a700-0000-7000-8000-000000000009`);
  await waitForList(page, isMobile);
  const drawer = page.getByRole("dialog");
  await expect(drawer.getByText("Lançamento não encontrado")).toBeVisible();
  await expect(drawer.getByText(/Salários/)).toHaveCount(0);
});

test("no celular os filtros abrem em folha lateral e nada rola na horizontal (RF22.Obs4)", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "Só no projeto de celular.");
  await signIn(page, "dono", "all");
  await page.goto(`/lancamentos?${PERIOD}`);
  await waitForList(page, isMobile);
  await expectNoHorizontalScroll(page);
  await expect(page.locator("table")).toBeHidden();

  const filters = await openFilters(page, isMobile);
  await expect(filters.getByLabel("Tipo")).toBeVisible();
  await expect(filters.getByLabel("Período")).toBeVisible();
  await expectNoHorizontalScroll(page);
});
