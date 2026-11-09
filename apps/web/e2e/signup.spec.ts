import { expect, type Page, test } from "@playwright/test";

// Valores fixos da API falsa (e2e/fake-api.mjs) e do web de teste (playwright.config.ts).
const CODE = "123456";
const WA_LINK = "https://wa.me/5582999990000";
const VALID_CNPJ = "11.222.333/0001-81";
const INVALID_CNPJ = "11.222.333/0001-82";

async function confirmEmail(page: Page, code = CODE) {
  await page.goto("/cadastro");
  await page.getByLabel("E-mail").fill("novo@demo.dev");
  await page.getByRole("button", { name: "Enviar código" }).click();
  await page.getByLabel("Código de 6 dígitos").fill(code);
  await page.getByRole("button", { name: "Confirmar código" }).click();
}

async function fillCompany(page: Page, cnpj: string) {
  await page.getByLabel("Nome fantasia").fill("Bar do Zé");
  await page.getByLabel("CNPJ (opcional)").fill(cnpj);
  await page.getByLabel("Segmento").selectOption({ label: "Bar" });
  await page.getByLabel("Município").fill("Maceió");
  await page.getByLabel("Estado (UF)").selectOption("AL");
  await page.getByRole("checkbox", { name: /Li e aceito/ }).check();
}

async function horizontalOverflow(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
}

test("owner signs up with email code, fills the form and lands on /bem-vindo with the wa.me link", async ({
  page,
}) => {
  await confirmEmail(page);
  await expect(page.getByText("E-mail confirmado:")).toBeVisible();

  await page.getByLabel("Nome completo").fill("Zé da Silva");
  await page.getByLabel("Celular (WhatsApp)").fill("(82) 99658-5647");
  await fillCompany(page, VALID_CNPJ);
  await page.getByRole("button", { name: "Criar conta" }).click();

  await expect(page).toHaveURL(/\/bem-vindo$/);
  await expect(page.getByRole("heading", { name: "Tudo pronto!" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Abrir o WhatsApp" })).toHaveAttribute(
    "href",
    WA_LINK,
  );
});

test("wrong code shows the error and keeps the step", async ({ page }) => {
  await confirmEmail(page, "000000");

  await expect(page.locator("form").getByRole("alert")).toContainText(
    "Código incorreto ou vencido",
  );
  await expect(page.getByLabel("Código de 6 dígitos")).toBeVisible();
  await expect(page.getByText("E-mail confirmado:")).toHaveCount(0);
});

test("invalid CNPJ keeps typed data", async ({ page }) => {
  await confirmEmail(page);
  await page.getByLabel("Nome completo").fill("Zé da Silva");
  await page.getByLabel("Celular (WhatsApp)").fill("(82) 99658-5647");
  await fillCompany(page, INVALID_CNPJ);
  await page.getByRole("button", { name: "Criar conta" }).click();

  await expect(page.getByText("CNPJ com dígito verificador inválido")).toBeVisible();
  await expect(page).toHaveURL(/\/cadastro$/);
  await expect(page.getByLabel("Nome completo")).toHaveValue("Zé da Silva");
  await expect(page.getByLabel("Nome fantasia")).toHaveValue("Bar do Zé");
  await expect(page.getByLabel("CNPJ (opcional)")).toHaveValue(INVALID_CNPJ);
  await expect(page.getByLabel("Município")).toHaveValue("Maceió");
});

test('logged user opens "Criar outra empresa" and finishes on /bem-vindo', async ({
  page,
  context,
  baseURL,
  isMobile,
}) => {
  await context.addCookies([
    { name: "better-auth.session_token", value: "sessao-falsa", url: baseURL as string },
  ]);
  await page.goto("/");

  if (isMobile) {
    await page.getByRole("button", { name: "Abrir menu" }).click();
    await page.getByRole("dialog").getByRole("link", { name: "Criar outra empresa" }).click();
  } else {
    await page
      .getByRole("navigation", { name: "Principal" })
      .getByRole("link", { name: "Criar outra empresa" })
      .click();
  }
  await expect(page).toHaveURL(/\/nova-empresa$/);

  await fillCompany(page, VALID_CNPJ);
  await page.getByRole("button", { name: "Criar empresa" }).click();

  await expect(page).toHaveURL(/\/bem-vindo$/);
  await expect(page.getByRole("link", { name: "Abrir o WhatsApp" })).toHaveAttribute(
    "href",
    WA_LINK,
  );
});

test("as telas novas não têm rolagem horizontal no celular", async ({
  page,
  context,
  baseURL,
  isMobile,
}) => {
  test.skip(!isMobile, "só no projeto de celular");
  for (const path of ["/cadastro", "/termos", "/privacidade"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await horizontalOverflow(page), path).toBeLessThanOrEqual(0);
  }

  await context.addCookies([
    { name: "better-auth.session_token", value: "sessao-falsa", url: baseURL as string },
  ]);
  for (const path of ["/bem-vindo", "/nova-empresa"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await horizontalOverflow(page), path).toBeLessThanOrEqual(0);
  }
});
