import { expect, test } from "@playwright/test";
import { warmRoutes } from "./warm";

test.beforeAll(async () => {
  test.setTimeout(120_000);
  await warmRoutes();
});

// As páginas do painel exigem sessão: a API falsa aceita este cookie fixo.
test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([
    { name: "better-auth.session_token", value: "sessao-falsa", url: baseURL as string },
  ]);
});

test("a página inicial abre e responde sem erro no console", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));

  const response = await page.goto("/");

  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle(/Finanças para restaurantes/);
  expect(errors).toEqual([]);
});

test("a casca navega pelo menu e marca a página atual", async ({ page, isMobile }) => {
  await page.goto("/");
  // A casca grava o cookie de contexto e recarrega na primeira visita: só clique depois disso.
  await expect(page.getByRole("status").filter({ hasText: "Carregando…" })).toBeHidden();

  if (isMobile) {
    // Um clique antes da hidratação não abre nada: repete até o menu aparecer, sem fechar o aberto.
    const dialog = page.getByRole("dialog");
    await expect(async () => {
      if (!(await dialog.isVisible()))
        await page.getByRole("button", { name: "Abrir menu" }).click();
      await expect(dialog).toBeVisible({ timeout: 2_000 });
    }).toPass();
    await page.getByRole("dialog").getByRole("link", { name: "Dashboard" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
  } else {
    const menu = page.getByRole("navigation", { name: "Principal" });
    await menu.getByRole("link", { name: "Lançamentos" }).click();
    await expect(page).toHaveURL(/\/lancamentos$/);
    await expect(menu.getByRole("link", { name: "Lançamentos" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  }
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("em viewport de celular a página não tem rolagem horizontal", async ({ page, isMobile }) => {
  test.skip(!isMobile, "só no projeto de celular");
  await page.goto("/");

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );

  expect(overflow).toBeLessThanOrEqual(0);
});

test("rota inexistente responde 404 e mostra a página de não encontrado", async ({ page }) => {
  const response = await page.goto("/rota-que-nao-existe");

  expect(response?.status()).toBe(404);
  await expect(page.getByText("Página não encontrada")).toBeVisible();
});

test("o web repassa /api/* para a API (rewrite)", async ({ request }) => {
  const response = await request.get("/api/health");

  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
});

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
};

for (const path of ["/", "/rota-que-nao-existe"]) {
  test(`${path} responde com os cabeçalhos de segurança`, async ({ request }) => {
    const response = await request.get(path);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(response.headers()[name]).toBe(value);
    }
  });
}
