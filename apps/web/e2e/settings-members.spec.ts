import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { warmRoutes } from "./warm";

test.beforeAll(async () => {
  test.setTimeout(120_000);
  await warmRoutes();
});

// A API falsa (e2e/fake-settings.mjs) guarda os colaboradores em memória: cada teste começa e
// termina com `POST /__reset`. Por isso a spec roda com um worker só (o CI já usa um).
const FAKE_API = "http://localhost:4010";
const T1 = "0190a000-0000-7000-8000-000000000001";

test.beforeEach(async ({ request }) => {
  await request.post(`${FAKE_API}/__reset`);
});
test.afterEach(async ({ request }) => {
  await request.post(`${FAKE_API}/__reset`);
});

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

async function open(page: Page, persona: string) {
  await signIn(page, persona);
  await page.goto("/configuracoes/colaboradores");
  await expect(page.getByRole("heading", { name: "Colaboradores" })).toBeVisible();
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test("o dono cadastra um lançador e vê o texto pronto com o link do WhatsApp", async ({ page }) => {
  await open(page, "dono");
  await page.getByRole("button", { name: "Novo colaborador" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nome").fill("Bia Cozinha");
  await dialog.getByLabel("Celular (com DDD)").fill("11 97777-0004");
  await dialog.getByLabel("Matriz").check();
  await dialog.getByRole("button", { name: "Salvar" }).click();
  const invite = page.getByRole("dialog");
  await expect(invite.getByText(/Oi, Bia Cozinha!/)).toBeVisible();
  await expect(invite.getByRole("button", { name: "Copiar" })).toBeVisible();
  const link = invite.getByRole("link", { name: "Abrir no WhatsApp" });
  await expect(link).toHaveAttribute("href", /^https:\/\/wa\.me\/\d+\?text=/);
  await invite.getByRole("button", { name: "Fechar" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "Bia Cozinha" })).toBeVisible();
});

test("painel Sim sem e-mail mostra o erro antes de enviar", async ({ page }) => {
  await open(page, "dono");
  await page.getByRole("button", { name: "Novo colaborador" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nome").fill("Caio");
  await dialog.getByLabel("Celular (com DDD)").fill("11977770005");
  await dialog.getByLabel("Acesso ao painel").check();
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog.getByRole("alert")).toContainText("e-mail");
});

test("o gerente vê o celular mascarado e nenhum botão de gravar", async ({ page }) => {
  await open(page, "manager");
  await expect(page.getByRole("button", { name: "Novo colaborador" })).toHaveCount(0);
  const row = page.getByRole("listitem").filter({ hasText: "Lançador Demo" });
  await expect(row).toContainText("•••• 0003");
  await expect(page.getByText("+5511988880003")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Desativar|Reativar/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Ver Lançador Demo" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("note")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Salvar" })).toHaveCount(0);
});

test("o dono desativa e reativa um colaborador", async ({ page }) => {
  await open(page, "dono");
  await page.getByRole("button", { name: "Desativar Lançador Demo" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Desativar colaborador" }).click();
  const row = page.getByRole("listitem").filter({ hasText: "Lançador Demo" });
  await expect(row).toContainText("Desativado");
  await page.getByRole("button", { name: "Reativar Lançador Demo" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Reativar colaborador" }).click();
  await expect(row).not.toContainText("Desativado");
});

test("colaboradores não rolam na horizontal e passam no axe", async ({ page }) => {
  await open(page, "dono");
  await expectNoHorizontalScroll(page);
  const { violations } = await new AxeBuilder({ page }).analyze();
  const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
  await page.getByRole("button", { name: "Novo colaborador" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expectNoHorizontalScroll(page);
});
