import { expect, test } from "@playwright/test";
import { warmRoutes } from "./warm";

test.beforeAll(async () => {
  test.setTimeout(120_000);
  await warmRoutes();
});

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
  await expect(page.getByRole("button", { name: "Colar código" })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  // Seis caixas separadas, na mesma linha e do mesmo tamanho (alinhadas, inclusive no celular).
  const rects = await page
    .getByRole("textbox", { name: /^(Código de 6 dígitos|Dígito \d de 6)$/ })
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect()));
  expect(rects).toHaveLength(6);
  const [first] = rects;
  if (!first) throw new Error("nenhuma caixa de dígito encontrada");
  for (const rect of rects) {
    expect(Math.abs(rect.top - first.top)).toBeLessThan(1);
    expect(Math.abs(rect.width - first.width)).toBeLessThan(1);
    expect(rect.width).toBeGreaterThanOrEqual(36);
  }
  // O sexto dígito envia sozinho, sem clicar em "Entrar".
  await page.getByLabel("Código de 6 dígitos").fill(CODE);

  await expect(page).toHaveURL(/\/lancamentos$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // Na primeira visita a casca grava o contexto e recarrega: só clique em "Sair" depois disso.
  await expect(page.getByRole("status").filter({ hasText: "Carregando…" })).toBeHidden();
  // Um clique antes da hidratação não faz nada: repete o clique até a saída acontecer.
  await expect(async () => {
    if (!/\/login$/.test(page.url())) {
      await page.getByRole("button", { name: "Sair" }).filter({ visible: true }).click();
    }
    await expect(page).toHaveURL(/\/login$/, { timeout: 2_000 });
  }).toPass();

  await page.goto("/lancamentos");
  await expect(page).toHaveURL(/\/login\?next=/);
});

test("código errado mostra o erro em português e não entra", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill("dono@demo.dev");
  await page.getByRole("button", { name: "Enviar código" }).click();
  await page.getByLabel("Código de 6 dígitos").fill("000000");

  await expect(page.locator("form").getByRole("alert")).toContainText("Código inválido");
  // O botão continua valendo: clicar tenta de novo com o mesmo código.
  const retry = page.waitForResponse((r) => r.url().includes("/sign-in/email-otp"));
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await retry;
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
