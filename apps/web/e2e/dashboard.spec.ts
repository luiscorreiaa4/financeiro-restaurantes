import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { warmRoutes } from "./warm";

test.beforeAll(async () => {
  test.setTimeout(120_000);
  await warmRoutes();
});

// Dados fixos da API falsa (e2e/fake-reports.mjs). O período vai explícito na URL: o padrão da
// tela é o mês corrente do relógio de verdade.
const T1 = "0190a000-0000-7000-8000-000000000001";
const PERIOD = "from=2026-11-01&to=2026-11-17";

// Sessão e contexto juntos: sem o `fr_ctx`, a primeira visita grava o contexto e recarrega.
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

const card = (page: Page, name: string) => page.getByRole("group", { name, exact: true });

test("o dono vê os indicadores do servidor com os valores exatos", async ({ page }) => {
  await signIn(page, "dono");
  await page.goto(`/dashboard?${PERIOD}&compare=previous_period`);
  await expect(card(page, "Receita bruta")).toContainText("R$ 10.000,00");
  await expect(card(page, "Resultado")).toContainText("R$ 2.650,00");
  await expect(card(page, "Margem")).toContainText("26,5%");
  await expect(card(page, "Ticket médio")).toContainText("R$ 30,00");
  await expect(card(page, "Ticket médio")).toContainText("base: 60% da receita");
  await expect(card(page, "Ponto de equilíbrio")).toContainText("R$ 28.571,43");
  await expect(card(page, "Folha sobre a receita")).toBeVisible();
  await expect(card(page, "Receita bruta")).toContainText(
    "aumento de 11,1% em relação ao período anterior",
  );
});

test("o gerente sem VER_FOLHA não vê o cartão de folha e vê Pessoal (restrito)", async ({
  page,
}) => {
  await signIn(page, "manager");
  await page.goto(`/dashboard?${PERIOD}&compare=previous_period`);
  await expect(card(page, "Receita bruta")).toContainText("R$ 10.000,00");
  await expect(page.getByRole("group", { name: /Folha/ })).toHaveCount(0);

  const region = page.getByRole("region", { name: "Despesas por categoria" });
  await region.getByRole("tab", { name: "Tabela" }).click();
  await expect(region.getByRole("table")).toContainText("Pessoal (restrito)");
  await expect(region.getByRole("table")).not.toContainText("Salários");
});

test("o lançador em / vai para os lançamentos e o dashboard é negado", async ({ page }) => {
  await signIn(page, "staff");
  await page.goto("/");
  await expect(page).toHaveURL(/\/lancamentos/);
  await page.goto("/dashboard");
  await expect(
    page.getByRole("heading", { name: "Você não tem acesso a esta página" }),
  ).toBeVisible();
});

test("o dono em / vai para o dashboard", async ({ page }) => {
  await signIn(page, "dono");
  await page.goto("/");
  await expect(page).toHaveURL(/\/dashboard/);
});

test("um período sem lançamentos mostra o estado vazio com o link do WhatsApp", async ({
  page,
}) => {
  await signIn(page, "dono");
  await page.goto("/dashboard?from=2026-01-01&to=2026-01-31&compare=previous_period");
  await expect(page.getByText("Ainda não há lançamentos neste período")).toBeVisible();
  await expect(page.getByRole("link", { name: /WhatsApp/ })).toHaveAttribute(
    "href",
    "https://wa.me/5582999990000",
  );
});

test("trocar Comparar com muda a URL e o texto da variação", async ({ page }) => {
  await signIn(page, "dono");
  await page.goto(`/dashboard?${PERIOD}&compare=previous_period`);
  await expect(card(page, "Receita bruta")).toContainText("em relação ao período anterior");
  await page.getByLabel("Comparar com").selectOption("previous_year");
  await expect(page).toHaveURL(/compare=previous_year/);
  await expect(card(page, "Receita bruta")).toContainText(
    "em relação ao mesmo período do ano anterior",
  );
  await page.getByLabel("Comparar com").selectOption("none");
  await expect(page).toHaveURL(/compare=none/);
  await expect(page.getByText(/em relação ao/)).toHaveCount(0);
});

test("no celular de 360 px não há rolagem horizontal", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await signIn(page, "dono");
  await page.goto(`/dashboard?${PERIOD}&compare=previous_period`);
  await expect(card(page, "Receita bruta")).toContainText("R$ 10.000,00");
  await expect(page.getByRole("img", { name: "Despesas por categoria" })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test("o axe não acha violação séria ou crítica", async ({ page }) => {
  await signIn(page, "dono");
  await page.goto(`/dashboard?${PERIOD}&compare=previous_period`);
  await expect(card(page, "Receita bruta")).toContainText("R$ 10.000,00");
  await expect(page.getByRole("img", { name: "Despesas por categoria" })).toBeVisible();
  const { violations } = await new AxeBuilder({ page }).analyze();
  const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
});
