import { expect, type Page, test } from "@playwright/test";
import { warmRoutes } from "./warm";

test.beforeAll(async () => {
  test.setTimeout(120_000);
  await warmRoutes();
});

// Token que a API falsa (e2e/fake-api.mjs) aceita. Na vida real ele vem no link do e-mail.
const VALID_LINK = "/redefinir-senha#token=link-valido-123";

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

// O Next mantém a tela anterior oculta no DOM depois de uma navegação do cliente: só os visíveis valem.
function field(page: Page, label: string) {
  return page.getByLabel(label, { exact: true }).filter({ visible: true });
}

async function fillNewPassword(page: Page, password: string, confirm: string) {
  await field(page, "Nova senha").fill(password);
  await field(page, "Confirmar nova senha").fill(confirm);
}

function invalidLinkAlert(page: Page) {
  return page.getByRole("alert").filter({ hasText: "Link inválido ou expirado" });
}

test("/recuperar-senha abre sem sessão e cabe na tela", async ({ page }) => {
  await page.goto("/recuperar-senha");

  await expect(page).toHaveURL(/\/recuperar-senha$/);
  await expect(page.getByRole("heading", { name: "Recuperar senha" })).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test("do login, 'Esqueci a senha' pede o link; o link abre a nova senha e volta ao login", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Entrar com senha" }).click();
  await page.getByRole("link", { name: "Esqueci a senha" }).click();
  await expect(page).toHaveURL(/\/recuperar-senha$/);

  await field(page, "E-mail").fill("dono@demo.dev");
  await page.getByRole("button", { name: "Enviar link" }).click();
  await expect(
    page.getByText(
      "Se o e-mail estiver cadastrado, você receberá um link para criar uma nova senha. Ele vale por 30 minutos.",
    ),
  ).toBeVisible();
  await expectNoHorizontalScroll(page);

  // Abre o link como quem clicou no e-mail.
  await page.goto(VALID_LINK);
  await expect(page.getByRole("heading", { name: "Nova senha" })).toBeVisible();
  await expect(page).not.toHaveURL(/token/);
  await expectNoHorizontalScroll(page);

  await fillNewPassword(page, "recuperada123", "recuperada123");
  await page.getByRole("button", { name: "Alterar senha" }).click();

  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText("Senha alterada. Entre com a nova senha.")).toBeVisible();
  await expect(field(page, "Senha")).toBeVisible();

  await field(page, "E-mail").fill("dono@demo.dev");
  await field(page, "Senha").fill("recuperada123");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("senha diferente na confirmação mostra o erro e não conclui", async ({ page }) => {
  await page.goto(VALID_LINK);

  await fillNewPassword(page, "recuperada123", "outra123456");
  await page.getByRole("button", { name: "Alterar senha" }).click();

  await expect(page.locator("form").getByRole("alert")).toContainText("As senhas não conferem.");
  await expect(page).toHaveURL(/\/redefinir-senha$/);
});

test("link inválido ou vencido mostra o erro e o caminho para pedir outro", async ({ page }) => {
  await page.goto("/redefinir-senha#token=link-vencido");

  await fillNewPassword(page, "recuperada123", "recuperada123");
  await page.getByRole("button", { name: "Alterar senha" }).click();

  await expect(invalidLinkAlert(page)).toBeVisible();
  await page.getByRole("link", { name: "Pedir um novo link" }).click();
  await expect(page).toHaveURL(/\/recuperar-senha$/);
});

test("sem token na URL mostra o link inválido, sem formulário", async ({ page }) => {
  await page.goto("/redefinir-senha");

  await expect(invalidLinkAlert(page)).toBeVisible();
  await expect(page.getByLabel("Nova senha", { exact: true })).toHaveCount(0);
  await expectNoHorizontalScroll(page);
});
