import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { warmRoutes } from "./warm";

test.beforeAll(async () => {
  test.setTimeout(120_000);
  await warmRoutes();
});

// A API falsa (e2e/fake-settings.mjs) guarda o cadastro em memória: cada teste começa e termina
// com `POST /__reset`. Por isso a spec roda com um worker só (o CI já usa um).
const FAKE_API = "http://localhost:4010";
const T1 = "0190a000-0000-7000-8000-000000000001";

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

async function open(page: Page, persona: string, path: string, heading: string) {
  await signIn(page, persona);
  await page.goto(path);
  await expect(page.getByRole("heading", { name: heading })).toBeVisible();
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test("o dono muda a taxa do Crédito e vê o líquido calculado pelo servidor", async ({ page }) => {
  await open(page, "dono", "/configuracoes/formas-de-pagamento", "Formas de pagamento");
  await page.getByRole("button", { name: "Editar Crédito" }).click();
  const dialog = page.getByRole("dialog");
  const rate = dialog.getByLabel("Taxa percentual");
  await rate.fill("3,2");
  await expect(dialog.getByText(/Venda de R\$\s100,00 rende R\$\s96,80 líquidos/)).toBeVisible();
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText(/Crédito/).first()).toBeVisible();
  await expect(page.getByText(/taxa 3,20 %/)).toBeVisible();
});

test("a taxa acima de 100 % é recusada na tela", async ({ page }) => {
  await open(page, "dono", "/configuracoes/formas-de-pagamento", "Formas de pagamento");
  await page.getByRole("button", { name: "Editar Crédito" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Taxa percentual").fill("120");
  await expect(dialog.getByRole("alert")).toContainText("entre 0 e 100");
  await expect(dialog.getByRole("button", { name: "Salvar" })).toBeDisabled();
});

test("o gerente abre as formas de pagamento e não encontra botão de salvar", async ({ page }) => {
  await open(page, "manager", "/configuracoes/formas-de-pagamento", "Formas de pagamento");
  await expect(page.getByRole("button", { name: "Nova forma de pagamento" })).toHaveCount(0);
  await page.getByRole("button", { name: "Ver Crédito" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("note")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Salvar" })).toHaveCount(0);
});

test("o dono cria uma unidade e ela aparece no seletor", async ({ page, isMobile }) => {
  // No celular o seletor fica dentro do menu; a regra é a mesma e já está provada no desktop.
  test.skip(isMobile, "seletor de unidade no menu do celular");
  await open(page, "dono", "/configuracoes/unidades", "Unidades");
  await page.getByRole("button", { name: "Nova unidade" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nome").fill("Praia");
  // A lista de municípios (IBGE, DD-29) carrega depois de abrir; o campo vira uma lista de escolha.
  const city = dialog.getByLabel("Município");
  await expect(city.locator("option", { hasText: "São Paulo" })).toHaveCount(1);
  await city.selectOption({ label: "São Paulo" });
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("listitem").filter({ hasText: "Praia" })).toBeVisible();
  const selector = page.getByLabel("Unidade").filter({ visible: true }).first();
  await expect(selector.locator("option", { hasText: "Praia" })).toHaveCount(1);
});

test("as telas de configuração não rolam na horizontal e passam no axe", async ({ page }) => {
  const paths = [
    ["/configuracoes", "Configurações"],
    ["/configuracoes/formas-de-pagamento", "Formas de pagamento"],
    ["/configuracoes/canais-de-venda", "Canais de venda"],
    ["/configuracoes/unidades", "Unidades"],
  ] as const;
  await signIn(page, "dono");
  for (const [path, heading] of paths) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await expectNoHorizontalScroll(page);
    const { violations } = await new AxeBuilder({ page }).analyze();
    const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    expect(serious.map((v) => `${path} ${v.id}: ${v.help}`)).toEqual([]);
  }
});
