import { expect, type Page, test } from "@playwright/test";
import { warmRoutes } from "./warm";

test.beforeAll(async () => {
  test.setTimeout(120_000);
  await warmRoutes();
});

// A API falsa (e2e/fake-entries.mjs) guarda o estado dos lançamentos em memória: cada teste
// começa e termina com `POST /__reset`, para a escrita de um não aparecer nas leituras dos outros.
const FAKE_API = "http://localhost:4010";
const T1 = "0190a000-0000-7000-8000-000000000001";
const PERIOD = "from=2026-10-01&to=2026-11-30";
const TRASH = "/lancamentos/lixeira?deletedFrom=2026-01-01&deletedTo=2026-12-31";

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

/** Botão da primeira linha: linha da tabela no computador, cartão no celular. */
function firstEntry(page: Page, isMobile: boolean) {
  return isMobile
    ? page.locator("main ul > li button").first()
    : page.locator('table tbody tr td button:not([role="checkbox"])').first();
}

async function openFirstEntry(page: Page, isMobile: boolean) {
  await page.goto(`/lancamentos?${PERIOD}`);
  const first = firstEntry(page, isMobile);
  await expect(first).toBeVisible();
  await first.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("tab", { name: "Dados" })).toBeVisible();
  return dialog;
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test("editar o valor mostra o novo valor e uma versão do Painel no histórico (RF23.CA01, CA03)", async ({
  page,
  isMobile,
}) => {
  await signIn(page, "dono");
  const dialog = await openFirstEntry(page, isMobile);

  await dialog.getByRole("button", { name: "Editar" }).click();
  await dialog.getByLabel("Valor bruto").fill("777,00");
  await dialog.getByRole("button", { name: "Salvar" }).click();

  await expect(dialog.getByRole("button", { name: "Editar" })).toBeVisible();
  await expect(dialog).toContainText("R$ 777,00");

  await dialog.getByRole("tab", { name: "Histórico" }).click();
  const history = dialog.getByRole("tabpanel", { name: "Histórico" });
  await expect(history).toContainText("Alteração");
  await expect(history).toContainText("Painel");
});

test("duas abas editam a mesma versão: a segunda recebe o aviso de conflito e recarrega (RF23.CA02)", async ({
  page,
  isMobile,
}) => {
  await signIn(page, "dono");
  const dialogA = await openFirstEntry(page, isMobile);
  const url = page.url();
  const other = await page.context().newPage();
  await other.goto(url);
  const dialogB = other.getByRole("dialog");
  await expect(dialogB.getByRole("tab", { name: "Dados" })).toBeVisible();

  await dialogA.getByRole("button", { name: "Editar" }).click();
  await dialogB.getByRole("button", { name: "Editar" }).click();

  await dialogA.getByLabel("Descrição").fill("Alterado na aba A");
  await dialogA.getByRole("button", { name: "Salvar" }).click();
  await expect(dialogA.getByRole("button", { name: "Editar" })).toBeVisible();

  await dialogB.getByLabel("Descrição").fill("Alterado na aba B");
  await dialogB.getByRole("button", { name: "Salvar" }).click();
  await expect(dialogB.getByRole("alert")).toContainText(
    /Este lançamento foi alterado por .+ às \d{2}:\d{2}\. Recarregar\?/,
  );
  // O que a aba B digitou continua no campo até ela recarregar.
  await expect(dialogB.getByLabel("Descrição")).toHaveValue("Alterado na aba B");

  await dialogB.getByRole("button", { name: "Recarregar" }).click();
  await expect(dialogB.getByLabel("Descrição")).toHaveValue("Alterado na aba A");
});

test("excluir com motivo, achar na lixeira e restaurar (RF24.CA01, CA02)", async ({
  page,
  isMobile,
}) => {
  await signIn(page, "dono");
  const dialog = await openFirstEntry(page, isMobile);
  const description = (await dialog.getByRole("heading").first().textContent())?.trim() ?? "";
  expect(description).not.toBe("");

  await dialog.getByRole("button", { name: "Excluir" }).click();
  const confirm = page.getByRole("alertdialog");
  await confirm.getByLabel("Motivo (opcional)").fill("lançado em duplicidade");
  await confirm.getByRole("button", { name: "Excluir" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();

  await page.goto(TRASH);
  const row = isMobile
    ? page.locator("main ul > li", { hasText: description })
    : page.locator("table tbody tr", { hasText: description });
  await expect(row).toBeVisible();
  await expect(row).toContainText("lançado em duplicidade");
  if (isMobile) await expectNoHorizontalScroll(page);

  await row.getByRole("button", { name: "Restaurar" }).click();
  await expect(row).toBeHidden();

  await page.goto(`/lancamentos?${PERIOD}`);
  await expect(firstEntry(page, isMobile)).toBeVisible();
});

test("exclusão em lote mostra a quantidade e a soma do servidor e manda tudo para a lixeira (RF24.Obs3)", async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, "a seleção de linhas só existe na tabela do computador");
  await signIn(page, "dono");
  await page.goto(`/lancamentos?${PERIOD}`);
  const rows = page.locator("table tbody tr");
  await expect(rows.first()).toBeVisible();

  await rows.nth(0).getByRole("checkbox").click();
  await rows.nth(1).getByRole("checkbox").click();
  await expect(page.getByText("2 selecionados")).toBeVisible();

  await page.getByRole("button", { name: "Excluir selecionados" }).click();
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText(/Excluir 2 lançamentos, somando R\$ [\d.]+,\d{2}\?/);
  await confirm.getByRole("button", { name: "Excluir" }).click();

  await expect(page.getByText("2 selecionados")).toBeHidden();
  await page.goto(TRASH);
  await expect(page.locator("table tbody tr")).toHaveCount(2);
});

test("contador só lê: não vê Editar, Excluir nem a lixeira", async ({ page, isMobile }) => {
  await signIn(page, "accountant");
  const dialog = await openFirstEntry(page, isMobile);
  await expect(dialog.getByRole("button", { name: "Editar" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Excluir" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("link", { name: "Lixeira" })).toHaveCount(0);
  if (!isMobile) {
    await expect(page.locator("table tbody tr").first().getByRole("checkbox")).toHaveCount(0);
  }
});

test("no celular o formulário e a lixeira não geram rolagem horizontal", async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, "verificação do projeto Pixel 7");
  await signIn(page, "dono");
  const dialog = await openFirstEntry(page, isMobile);
  await dialog.getByRole("button", { name: "Editar" }).click();
  await expect(dialog.getByLabel("Descrição")).toBeVisible();
  await expectNoHorizontalScroll(page);
  await page.goto(TRASH);
  await expect(page.getByRole("heading", { name: "Lixeira" })).toBeVisible();
  await expectNoHorizontalScroll(page);
});
