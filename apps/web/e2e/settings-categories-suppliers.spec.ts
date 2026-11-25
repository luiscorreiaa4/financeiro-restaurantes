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

test("o dono cria 'Frutos do mar do dia' em Carnes e a subcategoria herda do pai", async ({
  page,
}) => {
  await open(page, "dono", "/configuracoes/categorias", "Categorias");
  await page.getByRole("button", { name: "Nova subcategoria em Carnes" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(/Despesa/)).toBeVisible();
  await expect(dialog.getByText(/CMV/)).toBeVisible();
  await expect(dialog.getByText(/exige quantidade e unidade/i)).toBeVisible();
  await dialog.getByLabel("Nome").fill("Frutos do mar do dia");
  await dialog.getByLabel("Palavras de apoio").fill("camarão, lula");
  await dialog.getByRole("button", { name: "Salvar" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Frutos do mar do dia")).toBeVisible();
});

test("o gerente não vê 'Salários' nem na busca; o dono vê", async ({ page }) => {
  await open(page, "manager", "/configuracoes/categorias", "Categorias");
  await expect(page.getByText("Carnes", { exact: true })).toBeVisible();
  await expect(page.getByText("Salários")).toHaveCount(0);
  await page.getByLabel("Buscar categoria").fill("sal");
  await expect(page.getByText("Salários")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Nova subcategoria/ })).toHaveCount(0);

  await open(page, "dono", "/configuracoes/categorias", "Categorias");
  await page.getByLabel("Buscar categoria").fill("sal");
  await expect(page.getByText("Salários", { exact: true })).toBeVisible();
});

test("o gerente mescla dois fornecedores e o CPF aparece mascarado", async ({ page }) => {
  await open(page, "manager", "/configuracoes/fornecedores", "Fornecedores");
  await expect(page.getByText("•••.•••.247-25")).toBeVisible();
  await expect(page.getByText("52998224725")).toHaveCount(0);
  await page.getByRole("button", { name: "Mesclar Ceasa Norte" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Mesclar em").selectOption({ label: "Ceasa" });
  await expect(dialog.getByText(/3 lançamentos/)).toBeVisible();
  await expect(
    dialog.getByText(/lançamentos que você não vê também passam para o destino/i),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Mesclar", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("button", { name: "Mesclar Ceasa Norte" })).toHaveCount(0);
});

test("o contador consulta fornecedores sem botões de gravar", async ({ page }) => {
  await open(page, "accountant", "/configuracoes/fornecedores", "Fornecedores");
  await expect(page.getByText("Atacadão")).toBeVisible();
  await expect(page.getByRole("button", { name: /Mesclar|Editar/ })).toHaveCount(0);
});

test("categorias e fornecedores não rolam na horizontal e passam no axe", async ({ page }) => {
  const paths = [
    ["/configuracoes/categorias", "Categorias"],
    ["/configuracoes/fornecedores", "Fornecedores"],
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
