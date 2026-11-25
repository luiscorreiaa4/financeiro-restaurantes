import { expect, type Page, test } from "@playwright/test";
import { warmRoutes } from "./warm";

test.beforeAll(async () => {
  test.setTimeout(120_000);
  await warmRoutes();
});

// A API falsa (e2e/fake-entries.mjs) guarda o estado em memória: cada teste começa e termina com
// `POST /__reset`, para o lançamento de um não aparecer nas leituras dos outros.
const FAKE_API = "http://localhost:4010";
const T1 = "0190a000-0000-7000-8000-000000000001";
const PERIOD = "from=2026-10-01&to=2026-11-30";
// Data de competência fixa: o formulário usa o "hoje" real da máquina, que a lista do período
// acima nem sempre alcança.
const OCCURRED = "2026-11-10";

test.beforeEach(async ({ request }) => {
  await request.post(`${FAKE_API}/__reset`);
});
test.afterEach(async ({ request }) => {
  await request.post(`${FAKE_API}/__reset`);
});

// Sessão e contexto juntos: sem o `fr_ctx`, a primeira visita grava o contexto e recarrega.
async function signIn(page: Page, persona: string, unit = "all") {
  await page.context().addCookies([
    {
      name: "better-auth.session_token",
      value: `sessao-falsa-${persona}`,
      url: "http://localhost:3100",
    },
    { name: "fr_ctx", value: `${T1}.${unit}`, url: "http://localhost:3100" },
  ]);
}

async function openForm(page: Page) {
  await page.goto("/lancamentos/novo");
  await expect(page.getByRole("heading", { name: "Novo lançamento" })).toBeVisible();
  await expect(page.getByLabel("Valor", { exact: true })).toBeVisible();
}

/** Com "todas as unidades" a unidade começa vazia: escolhe a primeira oferecida. */
async function pickUnit(page: Page) {
  // O seletor de unidade da casca também se chama "Unidade": usa o id do formulário.
  const unit = page.locator("#create-unit");
  if ((await unit.inputValue()) === "") await unit.selectOption({ index: 1 });
}

async function fillExpense(page: Page, description: string, amount: string) {
  await page.getByLabel("Valor", { exact: true }).fill(amount);
  await page.getByLabel("Descrição").fill(description);
  await page.getByLabel("Categoria").selectOption({ label: "Mercearia" });
  await pickUnit(page);
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Linha da tabela no computador, cartão no celular, com o texto dado. */
function entryRow(page: Page, isMobile: boolean, text: string) {
  return isMobile
    ? page.locator("main ul > li", { hasText: text })
    : page.locator("table tbody tr", { hasText: text });
}

test("criar um lançamento leva ao detalhe, que mostra a origem e o histórico do Painel (RF26.CA02)", async ({
  page,
  isMobile,
}) => {
  await signIn(page, "dono");
  await openForm(page);
  await page.getByLabel("Data de competência").fill(OCCURRED);
  await fillExpense(page, "Compra E2E manual", "123,45");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();

  await expect(page).toHaveURL(/\/lancamentos\?entry=/);
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Compra E2E manual");
  await expect(dialog).toContainText("R$ 123,45");
  await dialog.getByRole("tab", { name: "Origem" }).click();
  await expect(dialog.getByRole("tabpanel", { name: "Origem" })).toContainText(
    "Lançado manualmente no painel por",
  );
  await dialog.getByRole("tab", { name: "Histórico" }).click();
  await expect(dialog.getByRole("tabpanel", { name: "Histórico" })).toContainText("Painel");

  await page.goto(`/lancamentos?${PERIOD}`);
  const row = entryRow(page, isMobile, "Compra E2E manual").first();
  await expect(row).toBeVisible();
  await expect(row).toContainText("Painel");
});

test("três notas em sequência com 'Salvar e lançar outro' aparecem na lista (RF26.CA08)", async ({
  page,
  isMobile,
}) => {
  await signIn(page, "dono");
  await openForm(page);
  await page.getByLabel("Data de competência").fill(OCCURRED);
  const notes = ["Nota E2E um", "Nota E2E dois", "Nota E2E três"];
  for (const [index, note] of notes.entries()) {
    await fillExpense(page, note, `${10 + index},00`);
    await page.getByRole("button", { name: "Salvar e lançar outro" }).click();
    await expect(page.getByRole("status").filter({ hasText: "salva" })).toContainText(
      `Despesa de R$ ${10 + index},00 salva`,
    );
    // Mantém data e unidade; limpa o resto e devolve o foco ao valor.
    await expect(page.getByLabel("Data de competência")).toHaveValue(OCCURRED);
    await expect(page.getByLabel("Descrição")).toHaveValue("");
    await expect(page.getByLabel("Valor", { exact: true })).toBeFocused();
  }

  await page.goto(`/lancamentos?${PERIOD}`);
  for (const note of notes) {
    await expect(entryRow(page, isMobile, note).first()).toBeVisible();
  }
});

test("contador e conta somente leitura não veem o botão, e o formulário recusa (RF26.Obs1)", async ({
  page,
}) => {
  for (const persona of ["accountant", "readonly"]) {
    await signIn(page, persona);
    await page.goto(`/lancamentos?${PERIOD}`);
    await expect(page.getByRole("heading", { name: "Lançamentos" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Novo lançamento" })).toHaveCount(0);
  }
  await signIn(page, "accountant");
  await page.goto("/lancamentos/novo");
  await expect(page.getByText("Você não tem acesso a esta página")).toBeVisible();
});

test("no celular o formulário não gera rolagem horizontal", async ({ page, isMobile }) => {
  test.skip(!isMobile, "verificação do projeto Pixel 7");
  await signIn(page, "dono");
  await openForm(page);
  await page.getByLabel("Tipo").selectOption("revenue");
  await expect(page.getByLabel("Canal de venda")).toBeVisible();
  await expectNoHorizontalScroll(page);
});
