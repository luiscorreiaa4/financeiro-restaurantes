import { expect, type Page, test } from "@playwright/test";
import { warmRoutes } from "./warm";

test.beforeAll(async () => {
  test.setTimeout(120_000);
  await warmRoutes();
});

// Personas da API falsa (e2e/fake-api.mjs), escolhidas pelo valor do cookie de sessão.
const T1 = "0190a000-0000-7000-8000-000000000001";
const T2 = "0190a000-0000-7000-8000-000000000002";

const U1 = "0190a000-0000-7000-8000-0000000000a1";

// `ctx`: aparelho que já abriu o painel (cookie de contexto gravado). Sem ele, a primeira visita
// grava o contexto e recarrega, o que atrapalha testes que mexem na tela logo ao abrir.
async function signIn(page: Page, persona: string, ctx?: string) {
  await page.context().addCookies([
    {
      name: "better-auth.session_token",
      value: `sessao-falsa-${persona}`,
      url: "http://localhost:3100",
    },
    ...(ctx ? [{ name: "fr_ctx", value: ctx, url: "http://localhost:3100" }] : []),
  ]);
}

const visible = (page: Page, label: string) =>
  page.locator(`select[aria-label="${label}"]:visible`);

async function openNav(page: Page, isMobile: boolean) {
  // Na primeira visita a casca grava o contexto e recarrega; só mexa no menu depois disso.
  await expect(page.getByRole("status").filter({ hasText: "Carregando…" })).toBeHidden();
  // No celular a navegação fica atrás do botão do menu. Decida pelo projeto (`isMobile`), nunca por
  // `toggle.isVisible()`: a casca chega por streaming e, logo depois do `goto`, o botão ainda não
  // existe; a checagem única responde "não" e o menu do celular nunca é aberto (PF2-9).
  if (isMobile) {
    const toggle = page.getByRole("button", { name: "Abrir menu" });
    // Um clique antes da hidratação não abre nada: repete até o menu aparecer, sem fechar o aberto.
    const dialog = page.getByRole("dialog");
    await expect(async () => {
      if (!(await dialog.isVisible())) await toggle.click();
      await expect(dialog).toBeVisible({ timeout: 2_000 });
    }).toPass();
  }
  return page.getByRole("navigation", { name: /^(Principal|Menu)$/ });
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test("dono com 2 empresas troca e a tela mostra só a nova; voltar não mostra a anterior (RF02.CA05)", async ({
  page,
}) => {
  await signIn(page, "owner2");
  // Uma página anterior no histórico: ir para a mesma URL só substituiria a entrada.
  await page.goto("/lancamentos");
  // Sem cookie de contexto a casca grava o fallback e recarrega.
  await expect(visible(page, "Empresa")).toHaveValue(T1);

  // Antes da hidratação a troca não dispara o handler: repete a seleção até a tela navegar.
  await expect(async () => {
    if (!/\/$/.test(page.url())) await visible(page, "Empresa").selectOption(T2);
    await expect(page).toHaveURL(/\/$/, { timeout: 3_000 });
  }).toPass({ timeout: 25_000 });
  await expect(visible(page, "Empresa")).toHaveValue(T2);
  await page.goBack();
  await expect(page).toHaveURL(/\/lancamentos$/);
  await expect(visible(page, "Empresa")).toHaveValue(T2);
});

test("o cookie fr_ctx existe depois de abrir a casca (o rewrite repassa o Set-Cookie)", async ({
  page,
}) => {
  await signIn(page, "owner2");
  await page.goto("/");
  await expect(visible(page, "Empresa")).toBeVisible();

  const cookies = await page.context().cookies();
  expect(cookies.some((c) => c.name === "fr_ctx" && c.value.startsWith(T1))).toBe(true);
});

const MENU = [
  {
    persona: "default",
    links: [
      "Início",
      "Lançamentos",
      "Dashboard",
      "Exportações",
      "Configurações",
      "Criar outra empresa",
    ],
  },
  {
    persona: "manager",
    links: ["Início", "Lançamentos", "Dashboard", "Configurações", "Criar outra empresa"],
  },
  { persona: "staff", links: ["Início", "Lançamentos", "Criar outra empresa"] },
  {
    persona: "accountant",
    links: [
      "Início",
      "Lançamentos",
      "Dashboard",
      "Exportações",
      "Configurações",
      "Criar outra empresa",
    ],
  },
];

for (const { persona, links } of MENU) {
  test(`menu por papel: ${persona}`, async ({ page, isMobile }) => {
    const unit = persona === "manager" || persona === "staff" ? U1 : "all";
    await signIn(page, persona, `${T1}.${unit}`);
    await page.goto("/");

    const nav = await openNav(page, isMobile);

    await expect(nav.getByRole("link")).toHaveText(links);
  });
}

test("gerente não vê 'Todas as unidades'", async ({ page }) => {
  await signIn(page, "manager");
  await page.goto("/");

  const units = visible(page, "Unidade");
  await expect(units).toBeVisible();
  await expect(units.locator("option")).toHaveText(["Matriz", "Filial"]);
});

test("dono vê 'Todas as unidades' quando há mais de uma unidade", async ({ page }) => {
  await signIn(page, "owner2");
  await page.goto("/");

  await expect(visible(page, "Unidade").locator("option")).toHaveText([
    "Todas as unidades",
    "Matriz",
    "Filial",
  ]);
});

test("conta em somente leitura mostra a faixa", async ({ page }) => {
  await signIn(page, "readonly");
  await page.goto("/");

  await expect(page.getByRole("status").filter({ hasText: "somente leitura" })).toBeVisible();
});

test("401 numa chamada do painel leva a /login?next=", async ({ page }) => {
  await signIn(page, `expira-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await page.goto("/lancamentos");

  await expect(page).toHaveURL(/\/login\?next=%2Flancamentos$/);
});

test("duas abas: a aba esquecida recarrega ao receber 409", async ({ page }) => {
  await signIn(page, "owner2");
  await page.goto("/");
  await expect(visible(page, "Empresa")).toHaveValue(T1);

  const other = await page.context().newPage();
  await other.goto("/");
  await expect(visible(other, "Empresa")).toHaveValue(T1);

  await visible(page, "Empresa").selectOption(T2);
  await expect(visible(page, "Empresa")).toHaveValue(T2);

  // A aba 2 ainda mostra a empresa antiga: ao voltar o foco ou abrir o seletor, a consulta de
  // unidades sai com o X-Context velho, a API responde 409 e a aba recarrega na empresa nova.
  await visible(other, "Empresa").focus();

  await expect(visible(other, "Empresa")).toHaveValue(T2);
});

test("sem rolagem horizontal com o seletor de empresa e de unidade", async ({ page }) => {
  await signIn(page, "owner2");
  await page.goto("/");
  await expect(visible(page, "Empresa")).toBeVisible();
  await expect(visible(page, "Unidade")).toBeVisible();

  await expectNoHorizontalScroll(page);
});
