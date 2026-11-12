import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { APP_ROUTES, concreteRoute } from "./routes";
import { warmRoutes } from "./warm";

test.beforeAll(async () => {
  test.setTimeout(120_000);
  await warmRoutes();
});

// Matriz "Rotas por estado de sessão" (A6 do desenho pós-F2), uma asserção por célula. As sessões
// vêm das personas da API falsa (e2e/fake-api.mjs), pelo valor do cookie. Cada teste usa cookie com
// sufixo único: o estado da API falsa (empresa criada, sessão que vira restrita) é por valor completo.
const BASE = "http://localhost:3100";
const T1 = "0190a000-0000-7000-8000-000000000001";
const FULL_CTX = `${T1}.all`;

type State = "none" | "full" | "restricted" | "invalid";

const STATES: Record<State, string | null> = {
  none: null,
  full: "sessao-falsa-full",
  restricted: "sessao-falsa-restrito-dono",
  // Valor que a API falsa não reconhece: /api/me responde 401, como cookie vencido na API real.
  invalid: "valor-invalido-ou-vencido",
};

async function setSession(page: Page, state: State) {
  const base = STATES[state];
  if (base === null) return;
  const value = state === "invalid" ? base : `${base}-${randomUUID()}`;
  await page.context().addCookies([
    { name: "better-auth.session_token", value, url: BASE },
    // Aparelho que já abriu o painel: sem isso a casca grava o contexto e recarrega (DD-31).
    ...(state === "full" ? [{ name: "fr_ctx", value: FULL_CTX, url: BASE }] : []),
  ]);
}

// Só o "Carregando…" da casca do (app) tem role status (ver .claude/rules/e2e-painel.md).
const loading = (page: Page) => page.getByRole("status").filter({ hasText: "Carregando…" });

/** Espera a URL chegar e se estabilizar: sem laço, nada muda por 1 s depois de chegar. */
async function expectStableUrl(page: Page, expected: RegExp | string) {
  await expect(page).toHaveURL(expected);
  const settled = page.url();
  await page.waitForTimeout(1_000);
  expect(page.url()).toBe(settled);
}

function pathOf(page: Page) {
  const url = new URL(page.url());
  return `${url.pathname}${url.search}`;
}

/**
 * Registra (em sessionStorage, que sobrevive à navegação) se algum dos seletores chegou a existir
 * visível no DOM de qualquer documento: prova "não piscou a tela errada" antes do redirect.
 */
async function watchFlash(page: Page, selectors: string[]) {
  await page.addInitScript((sels: string[]) => {
    const seen = () => {
      for (const sel of sels) {
        for (const el of Array.from(document.querySelectorAll(sel))) {
          if (el.closest("[hidden]")) continue;
          try {
            sessionStorage.setItem("flash", `${sel}@${location.pathname}`);
          } catch {
            // sem sessionStorage a prova some; o teste não conseguiria acusar nada.
          }
        }
      }
    };
    new MutationObserver(seen).observe(document, { childList: true, subtree: true });
    seen();
  }, selectors);
}

function flashed(page: Page) {
  return page.evaluate(() => sessionStorage.getItem("flash"));
}

/** Navegação no cliente (como o clique num Link): usa o roteador do App Router. */
async function clientNavigate(page: Page, href: string) {
  const has = await page.evaluate(
    () => typeof (window as unknown as { next?: { router?: unknown } }).next?.router === "object",
  );
  expect(has, "window.next.router indisponível").toBe(true);
  await page.evaluate((to) => {
    (window as unknown as { next: { router: { push: (h: string) => void } } }).next.router.push(to);
  }, href);
}

async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

// ---------------------------------------------------------------------------------------------
// Linha 1: grupo (app)
// ---------------------------------------------------------------------------------------------
for (const route of APP_ROUTES) {
  const url = concreteRoute(route);
  const encoded = encodeURIComponent(url);

  test(`(app) ${route}: sem sessão vai a /login?next=`, async ({ page }) => {
    await page.goto(url);
    await expectStableUrl(page, new RegExp(`/login\\?next=${encoded}$`));
  });

  test(`(app) ${route}: sessão completa abre`, async ({ page }) => {
    await setSession(page, "full");
    await page.goto(url);
    await expect(loading(page)).toBeHidden();
    await expect(
      page.getByRole("heading", { level: 1 }).filter({ visible: true }).first(),
    ).toBeVisible();
    expect(pathOf(page)).toBe(url);
  });

  test(`(app) ${route}: sessão restrita vai a /acesso-restrito`, async ({ page }) => {
    await setSession(page, "restricted");
    await page.goto(url);
    await expectStableUrl(page, /\/acesso-restrito$/);
  });

  test(`(app) ${route}: cookie inválido vai a /login sem laço`, async ({ page }) => {
    await setSession(page, "invalid");
    await page.goto(url);
    await expectStableUrl(page, /\/login$/);
    await expect(page.getByLabel("E-mail")).toBeVisible();
  });
}

// ---------------------------------------------------------------------------------------------
// Linha 2: /acesso-restrito*
// ---------------------------------------------------------------------------------------------
for (const route of ["/acesso-restrito", "/acesso-restrito/nova-empresa"]) {
  test(`${route}: sem sessão vai a /login?next=`, async ({ page }) => {
    await page.goto(route);
    await expectStableUrl(page, new RegExp(`/login\\?next=${encodeURIComponent(route)}$`));
  });

  test(`${route}: sessão completa vai a /`, async ({ page }) => {
    await setSession(page, "full");
    await page.goto(route);
    await expectStableUrl(page, `${BASE}/`);
  });

  test(`${route}: sessão restrita abre`, async ({ page }) => {
    await setSession(page, "restricted");
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    expect(pathOf(page)).toBe(route);
    await expect(page.getByRole("button", { name: "Sair" })).toBeVisible();
  });

  test(`${route}: cookie inválido vai a /login sem laço`, async ({ page }) => {
    await setSession(page, "invalid");
    await page.goto(route);
    await expectStableUrl(page, /\/login$/);
    await expect(page.getByLabel("E-mail")).toBeVisible();
  });
}

test("/acesso-restrito: texto do dono sem unidade, link de criar empresa e suporte", async ({
  page,
}) => {
  await setSession(page, "restricted");
  await page.goto("/acesso-restrito");
  await expect(
    page.getByRole("heading", { name: "Sua empresa não tem unidade ativa." }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Criar outra empresa" })).toHaveAttribute(
    "href",
    "/acesso-restrito/nova-empresa",
  );
  await expect(page.locator('a[href^="mailto:"]')).toBeVisible();
});

test("/acesso-restrito: texto de quem não tem vínculo ativo", async ({ page }) => {
  await page.context().addCookies([
    {
      name: "better-auth.session_token",
      value: `sessao-falsa-restrito-sem-vinculo-${randomUUID()}`,
      url: BASE,
    },
  ]);
  await page.goto("/acesso-restrito");
  await expect(
    page.getByRole("heading", { name: "Você não tem acesso ativo a nenhuma empresa." }),
  ).toBeVisible();
});

// ---------------------------------------------------------------------------------------------
// Linha 3: /login, /cadastro, /recuperar-senha
// ---------------------------------------------------------------------------------------------
for (const route of ["/login", "/cadastro", "/recuperar-senha"]) {
  test(`${route}: sem sessão abre o formulário`, async ({ page }) => {
    await page.goto(route);
    await expect(page.getByLabel("E-mail")).toBeVisible();
    expect(pathOf(page)).toBe(route);
  });

  test(`${route}: sessão completa vai a / (padrão de safeNext)`, async ({ page }) => {
    await setSession(page, "full");
    await page.goto(route);
    await expectStableUrl(page, `${BASE}/`);
  });

  test(`${route}: sessão restrita termina em /acesso-restrito (via /)`, async ({ page }) => {
    await setSession(page, "restricted");
    await page.goto(route);
    await expectStableUrl(page, /\/acesso-restrito$/);
  });

  test(`${route}: cookie inválido abre o formulário e a URL se estabiliza (sem laço)`, async ({
    page,
  }) => {
    await setSession(page, "invalid");
    let navigations = 0;
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) navigations += 1;
    });
    await page.goto(route);
    await expect(page.getByLabel("E-mail")).toBeVisible();
    await expectStableUrl(page, new RegExp(`${route}$`));
    expect(navigations).toBeLessThanOrEqual(2);
  });
}

test("/login?next= seguro com sessão completa vai ao destino pedido", async ({ page }) => {
  await setSession(page, "full");
  await page.goto("/login?next=%2Flancamentos");
  await expectStableUrl(page, /\/lancamentos$/);
});

test("/login?next=//evil.com com sessão completa termina em / (Review Focus 5)", async ({
  page,
}) => {
  await setSession(page, "full");
  await page.goto("/login?next=//evil.com");
  await expectStableUrl(page, `${BASE}/`);
});

test("/login?next=https://evil.com com sessão completa termina em /", async ({ page }) => {
  await setSession(page, "full");
  await page.goto(`/login?next=${encodeURIComponent("https://evil.com")}`);
  await expectStableUrl(page, `${BASE}/`);
});

// ---------------------------------------------------------------------------------------------
// Linha 4: /redefinir-senha
// ---------------------------------------------------------------------------------------------
const RESET = "/redefinir-senha#token=link-valido-123";

for (const state of ["none", "full", "restricted", "invalid"] as const) {
  test(`/redefinir-senha: abre com sessão ${state}`, async ({ page }) => {
    await setSession(page, state);
    await page.goto(RESET);
    await expect(page.getByLabel("Nova senha", { exact: true })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/redefinir-senha");
  });
}

for (const state of ["full", "restricted"] as const) {
  test(`/redefinir-senha: com sessão ${state}, ao concluir sai e vai a /login sem sessão`, async ({
    page,
  }) => {
    await setSession(page, state);
    await page.goto(RESET);
    const senha = `nova-${randomUUID()}`.slice(0, 20);
    await page.getByLabel("Nova senha", { exact: true }).fill(senha);
    await page.getByLabel("Confirmar nova senha", { exact: true }).fill(senha);
    await page.getByRole("button", { name: "Alterar senha" }).click();

    await expectStableUrl(page, /\/login$/);
    await expect(page.getByLabel("E-mail")).toBeVisible();
    const cookies = await page.context().cookies(BASE);
    expect(cookies.find((c) => c.name === "better-auth.session_token")).toBeUndefined();
    // Sem sessão de verdade: uma rota do painel volta ao login.
    await page.goto("/lancamentos");
    await expect(page).toHaveURL(/\/login\?next=%2Flancamentos$/);
  });
}

// ---------------------------------------------------------------------------------------------
// Linha 5: /termos e /privacidade
// ---------------------------------------------------------------------------------------------
for (const route of ["/termos", "/privacidade"]) {
  for (const state of ["none", "full", "restricted", "invalid"] as const) {
    test(`${route}: abre com sessão ${state}`, async ({ page }) => {
      await setSession(page, state);
      await page.goto(route);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(new URL(page.url()).pathname).toBe(route);
    });
  }
}

// ---------------------------------------------------------------------------------------------
// redirect() em Server Component dentro de <Suspense> com cacheComponents: carga direta e cliente
// ---------------------------------------------------------------------------------------------
test.describe("redirect() dentro de Suspense", () => {
  test("controle do detector: sem sessão, /login mostra o formulário e o detector registra", async ({
    page,
  }) => {
    await watchFlash(page, ["form"]);
    await page.goto("/login");
    await expect(page.getByLabel("E-mail")).toBeVisible();
    expect(await flashed(page)).toBe("form@/login");
  });

  test("carga direta: sessão completa em /login redireciona sem mostrar o formulário", async ({
    page,
  }) => {
    await setSession(page, "full");
    await watchFlash(page, ["form", "input"]);
    await page.goto("/login");
    await expectStableUrl(page, `${BASE}/`);
    expect(await flashed(page)).toBeNull();
  });

  test("cliente: sessão completa em /login redireciona sem mostrar o formulário", async ({
    page,
  }) => {
    await setSession(page, "full");
    await page.goto("/termos");
    await watchFlash(page, ["form"]);
    await clientNavigate(page, "/login");
    await expectStableUrl(page, `${BASE}/`);
    expect(await flashed(page)).toBeNull();
  });

  test("cliente por clique num Link: sessão completa em /login (de /cadastro) redireciona", async ({
    page,
  }) => {
    await page.goto("/cadastro");
    await expect(page.getByLabel("E-mail")).toBeVisible();
    await setSession(page, "full");
    await page.getByRole("link", { name: "Entrar" }).click();
    await expectStableUrl(page, `${BASE}/`);
  });

  test("carga direta: sessão restrita em rota de (app) redireciona sem mostrar a casca", async ({
    page,
  }) => {
    await setSession(page, "restricted");
    await watchFlash(page, ["nav", "aside"]);
    await page.goto("/lancamentos");
    await expectStableUrl(page, /\/acesso-restrito$/);
    expect(await flashed(page)).toBeNull();
  });

  test("cliente: sessão restrita em rota de (app) redireciona sem mostrar a casca", async ({
    page,
  }) => {
    await setSession(page, "restricted");
    await page.goto("/termos");
    await watchFlash(page, ["nav", "aside"]);
    await clientNavigate(page, "/lancamentos");
    await expectStableUrl(page, /\/acesso-restrito$/);
    expect(await flashed(page)).toBeNull();
  });

  test("cliente por clique num Link: sessão restrita em /login (de /cadastro) termina em /acesso-restrito", async ({
    page,
  }) => {
    await page.goto("/cadastro");
    await expect(page.getByLabel("E-mail")).toBeVisible();
    await setSession(page, "restricted");
    await page.getByRole("link", { name: "Entrar" }).click();
    await expectStableUrl(page, /\/acesso-restrito$/);
  });

  test("carga direta: sessão completa em /acesso-restrito redireciona sem mostrar o aviso", async ({
    page,
  }) => {
    await setSession(page, "full");
    await watchFlash(page, ['a[href="/acesso-restrito/nova-empresa"]']);
    await page.goto("/acesso-restrito");
    await expectStableUrl(page, `${BASE}/`);
    expect(await flashed(page)).toBeNull();
  });

  test("cliente: sessão completa em /acesso-restrito redireciona sem mostrar o aviso", async ({
    page,
  }) => {
    await setSession(page, "full");
    await page.goto("/termos");
    await watchFlash(page, ['a[href="/acesso-restrito/nova-empresa"]']);
    await clientNavigate(page, "/acesso-restrito");
    await expectStableUrl(page, `${BASE}/`);
    expect(await flashed(page)).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// Cadeias
// ---------------------------------------------------------------------------------------------
test("sessão que vira restrita no meio do caminho: 401 -> /login -> destino -> /acesso-restrito, sem laço", async ({
  page,
}) => {
  await page.context().addCookies([
    {
      name: "better-auth.session_token",
      value: `sessao-falsa-vira-restrito-${randomUUID()}`,
      url: BASE,
    },
    { name: "fr_ctx", value: FULL_CTX, url: BASE },
  ]);
  const visited: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) visited.push(new URL(frame.url()).pathname);
  });

  await page.goto("/lancamentos");

  await expectStableUrl(page, /\/acesso-restrito$/);
  await expect(
    page.getByRole("heading", { name: "Sua empresa não tem unidade ativa." }),
  ).toBeVisible();
  expect(visited).toContain("/login");
  expect(visited.filter((p) => p === "/login").length).toBeLessThanOrEqual(2);
});

test("restrito cria empresa: /lancamentos -> /acesso-restrito -> nova empresa -> /bem-vindo", async ({
  page,
}) => {
  await setSession(page, "restricted");
  await page.goto("/lancamentos");
  await expectStableUrl(page, /\/acesso-restrito$/);

  await page.getByRole("link", { name: "Criar outra empresa" }).click();
  await expect(page).toHaveURL(/\/acesso-restrito\/nova-empresa$/);

  await page.getByLabel("Nome fantasia").fill("Bar do Zé");
  await page.getByLabel("CNPJ (opcional)").fill("11.222.333/0001-81");
  await page.getByLabel("Segmento").selectOption({ label: "Bar" });
  await page.getByLabel("Estado (UF)").selectOption("AL");
  const city = page.getByLabel("Município");
  await expect(city).toBeEnabled();
  await city.fill("Maceió");
  await page.getByRole("option", { name: "Maceió" }).click();
  await page.getByRole("checkbox", { name: /Li e aceito/ }).check();
  await page.getByRole("button", { name: "Criar empresa" }).click();

  await expect(page).toHaveURL(/\/bem-vindo$/);
  await expect(page.getByRole("link", { name: "Abrir o WhatsApp" })).toBeVisible();
  // A sessão agora é completa: a tela restrita manda de volta a /.
  await page.goto("/acesso-restrito");
  await expectStableUrl(page, `${BASE}/`);
});

// ---------------------------------------------------------------------------------------------
// Celular (Pixel 7): telas novas sem rolagem horizontal
// ---------------------------------------------------------------------------------------------
test("telas restritas sem rolagem horizontal no celular", async ({ page, isMobile }) => {
  test.skip(!isMobile, "só no projeto de celular");
  await setSession(page, "restricted");
  for (const route of ["/acesso-restrito", "/acesso-restrito/nova-empresa"]) {
    await page.goto(route);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
    await expectNoHorizontalScroll(page);
  }
});
