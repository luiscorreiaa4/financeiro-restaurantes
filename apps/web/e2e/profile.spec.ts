import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { warmRoutes } from "./warm";

test.beforeAll(async () => {
  test.setTimeout(120_000);
  await warmRoutes();
});

// A API falsa (e2e/fake-api.mjs) guarda o perfil por valor de cookie: cada teste usa o seu.
async function signIn(page: Page) {
  await page.context().addCookies([
    {
      name: "better-auth.session_token",
      value: `sessao-falsa-${randomUUID()}`,
      url: "http://localhost:3100",
    },
    // Aparelho que já abriu o painel: sem isso a primeira visita grava o contexto e recarrega.
    {
      name: "fr_ctx",
      value: "0190a000-0000-7000-8000-000000000001.all",
      url: "http://localhost:3100",
    },
  ]);
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

test("sem sessão, /perfil leva ao /login guardando a rota", async ({ page }) => {
  await page.goto("/perfil");

  await expect(page).toHaveURL(/\/login\?next=%2Fperfil$/);
});

test("pelo menu do usuário abre 'Meu perfil', sem rolagem horizontal", async ({ page }) => {
  await signIn(page);
  await page.goto("/");
  // A casca grava o cookie de contexto e recarrega na primeira visita: só clique depois disso.
  await expect(page.getByRole("status").filter({ hasText: "Carregando…" })).toBeHidden();

  await page.getByRole("link", { name: "Meu perfil" }).filter({ visible: true }).click();

  await expect(page).toHaveURL(/\/perfil$/);
  await expect(page.getByRole("heading", { name: "Meu perfil", level: 1 })).toBeVisible();
  await expect(page.getByLabel("Nome", { exact: true })).toHaveValue("Dono Demo");
  await expectNoHorizontalScroll(page);
});

test("troca o nome e vê o nome novo", async ({ page }) => {
  await signIn(page);
  await page.goto("/perfil");

  await page.getByLabel("Nome", { exact: true }).fill("Maria Souza");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Nome salvo.")).toBeVisible();

  await page.reload();
  await expect(page.getByLabel("Nome", { exact: true })).toHaveValue("Maria Souza");
});

test("o nome novo aparece no menu sem recarregar a página", async ({ page }) => {
  await signIn(page);
  await page.goto("/perfil");
  await expect(page.getByLabel("Nome", { exact: true })).toHaveValue("Dono Demo");

  await page.getByLabel("Nome", { exact: true }).fill("Ana Lima");
  await page.getByRole("button", { name: "Salvar" }).click();
  await expect(page.getByText("Nome salvo.")).toBeVisible();

  await expect(page.locator("span:visible", { hasText: /^Ana Lima$/ })).toBeVisible();
});

test("troca a senha pela senha atual", async ({ page }) => {
  await signIn(page);
  await page.goto("/perfil");

  await page.getByLabel("Senha atual").fill("demo12345");
  await page.getByLabel("Nova senha", { exact: true }).fill("trocada12345");
  await page.getByLabel("Confirmar nova senha", { exact: true }).fill("trocada12345");
  await page.getByRole("button", { name: "Trocar senha" }).click();

  await expect(page.getByText("Senha alterada.")).toBeVisible();
});

test("senha atual errada mostra o erro", async ({ page }) => {
  await signIn(page);
  await page.goto("/perfil");

  await page.getByLabel("Senha atual").fill("errada12345");
  await page.getByLabel("Nova senha", { exact: true }).fill("trocada12345");
  await page.getByLabel("Confirmar nova senha", { exact: true }).fill("trocada12345");
  await page.getByRole("button", { name: "Trocar senha" }).click();

  await expect(page.locator("main").getByRole("alert")).toContainText("Senha atual incorreta.");
});

test("'Não lembro a senha atual' pede o link por e-mail", async ({ page }) => {
  await signIn(page);
  await page.goto("/perfil");

  await page.getByRole("button", { name: "Não lembro a senha atual: receber link" }).click();
  await page.getByRole("button", { name: "Receber link por e-mail" }).click();

  await expect(page.getByText(/Enviamos um link para o seu e-mail/)).toBeVisible();
  await expect(page.getByLabel("Senha atual")).toHaveCount(0);
  await expectNoHorizontalScroll(page);
});

test("encerra as outras sessões e a lista passa a ter só a atual", async ({ page }) => {
  await signIn(page);
  await page.goto("/perfil");

  const sessions = page.getByRole("list", { name: "Sessões ativas" }).getByRole("listitem");
  await expect(sessions).toHaveCount(3);
  await expect(sessions.first()).toContainText("Esta sessão");

  await page.getByRole("button", { name: "Encerrar as outras sessões" }).click();

  await expect(sessions).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Encerrar as outras sessões" })).toBeDisabled();
  await expectNoHorizontalScroll(page);
});
