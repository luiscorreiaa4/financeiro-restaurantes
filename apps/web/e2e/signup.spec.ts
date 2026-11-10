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
  await expect(page.getByRole("button", { name: "Colar código" })).toBeVisible();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  // O sexto dígito confirma sozinho, sem clicar em "Confirmar código".
  await page.getByLabel("Código de 6 dígitos").fill(code);
}

/** Município vem da lista oficial do estado: digita para filtrar e escolhe a opção. */
async function pickCity(page: Page, name: string) {
  const city = page.getByLabel("Município");
  await expect(city).toBeEnabled();
  await city.fill(name);
  await page.getByRole("option", { name }).click();
  await expect(city).toHaveValue(name);
}

async function fillCompany(page: Page, cnpj: string) {
  await page.getByLabel("Nome fantasia").fill("Bar do Zé");
  await page.getByLabel("CNPJ (opcional)").fill(cnpj);
  await page.getByLabel("Segmento").selectOption({ label: "Bar" });
  await page.getByLabel("Estado (UF)").selectOption("AL");
  await pickCity(page, "Maceió");
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
  await page.getByLabel("Celular (WhatsApp)").fill("(11) 98765-4321");
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
  await page.getByLabel("Celular (WhatsApp)").fill("(11) 98765-4321");
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

test("masks format phone and CNPJ (numeric or alphanumeric) while typing, and blur flags a bad CNPJ", async ({
  page,
}) => {
  await confirmEmail(page);
  await expect(page.getByText("E-mail confirmado:")).toBeVisible();

  const phone = page.getByLabel("Celular (WhatsApp)");
  await phone.pressSequentially("11987654321");
  await expect(phone).toHaveValue("(11) 98765-4321");

  const cnpj = page.getByLabel("CNPJ (opcional)");
  await cnpj.pressSequentially("12abc34501de35");
  await expect(cnpj).toHaveValue("12.ABC.345/01DE-35");

  // Sai do campo com o dígito verificador errado: o erro aparece sem enviar o formulário.
  await cnpj.fill("");
  await cnpj.pressSequentially("11222333000182");
  await page.getByLabel("Segmento").focus();
  await expect(cnpj).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("CNPJ com dígito verificador inválido")).toBeVisible();
  await expect(page).toHaveURL(/\/cadastro$/);

  // Estado vem antes do município, e a tela não ganha rolagem horizontal.
  const city = await page.getByLabel("Município").boundingBox();
  const state = await page.getByLabel("Estado (UF)").boundingBox();
  expect(city && state && state.y < city.y).toBeTruthy();
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
});

test("município: lista do estado com busca sem acento, só aceita item da lista e cabe na tela", async ({
  page,
}) => {
  await confirmEmail(page);
  await expect(page.getByText("E-mail confirmado:")).toBeVisible();

  const city = page.getByLabel("Município");
  await expect(city).toBeDisabled();

  await page.getByLabel("Estado (UF)").selectOption("MG");
  await expect(city).toBeEnabled();
  await city.fill("sao joao del");
  await expect(page.getByRole("option", { name: "São João del Rei" })).toBeVisible();
  await expect(page.getByRole("option", { name: "Maceió" })).toHaveCount(0);
  // Com a lista aberta a tela não ganha rolagem horizontal (celular incluso).
  expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

  // Texto que não é município da lista não fica no campo.
  await city.fill("Cidade Inventada");
  await expect(page.getByText("Nenhum município encontrado neste estado.")).toBeVisible();
  await page.getByLabel("Segmento").focus();
  await expect(city).toHaveValue("");

  // Trocar o estado limpa o município escolhido.
  await pickCity(page, "Belo Horizonte");
  await page.getByLabel("Estado (UF)").selectOption("AL");
  await expect(city).toHaveValue("");
});
