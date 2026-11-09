import { expect, test } from "@playwright/test";

// Valores fixos da API falsa (e2e/fake-api.mjs).
const CODE = "123456";

test("sem sessão, abrir /lancamentos leva ao /login guardando a rota", async ({ page }) => {
  await page.goto("/lancamentos");

  await expect(page).toHaveURL(/\/login\?next=%2Flancamentos$/);
  await expect(page.getByRole("heading", { name: "Entrar" })).toBeVisible();
});

test("pede o código, digita e entra; 'Sair' volta ao /login", async ({ page }) => {
  await page.goto("/lancamentos");

  await page.getByLabel("E-mail").fill("dono@demo.dev");
  await page.getByRole("button", { name: "Enviar código" }).click();
  await expect(
    page.getByText("Se o e-mail estiver cadastrado, você receberá o código."),
  ).toBeVisible();
  await page.getByLabel("Código de 6 dígitos").fill(CODE);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();

  await expect(page).toHaveURL(/\/lancamentos$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  await page.getByRole("button", { name: "Sair" }).filter({ visible: true }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.goto("/lancamentos");
  await expect(page).toHaveURL(/\/login\?next=/);
});

test("código errado mostra o erro em português e não entra", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill("dono@demo.dev");
  await page.getByRole("button", { name: "Enviar código" }).click();
  await page.getByLabel("Código de 6 dígitos").fill("000000");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();

  await expect(page.locator("form").getByRole("alert")).toContainText("Código inválido");
  await expect(page).toHaveURL(/\/login$/);
});

test("entrar com senha funciona e a tela não tem rolagem horizontal", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Entrar com senha" }).click();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  await page.getByLabel("E-mail").fill("dono@demo.dev");
  await page.getByLabel("Senha").fill("demo12345");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();

  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});
