import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FullMe } from "@/lib/api/me-contract";
import { meFixture } from "@/lib/api/me-fixture";
import { NAV_ITEMS } from "@/lib/navigation";
import { AppShell } from "./app-shell";

// `useRouter` exige o roteador montado (o ContextSwitcher o usa na troca suave); aqui basta um falso.
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));

beforeEach(() => {
  // O seletor e o SessionKeeper chamam a API pelo navegador; aqui a resposta é sempre mínima.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).includes("/api/units")) {
        return new Response(JSON.stringify({ units: [] }), { status: 200 });
      }
      if (String(url).includes("/api/exports")) {
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      }
      return new Response(JSON.stringify(meFixture()), { status: 200 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

function renderShell(me: FullMe, children: ReactNode = <p>conteúdo da página</p>) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AppShell me={me}>{children}</AppShell>
    </QueryClientProvider>,
  );
}

describe("casca da aplicação", () => {
  it("mostra um link na navegação principal para cada item de NAV_ITEMS (dono)", () => {
    renderShell(
      meFixture({
        context: {
          ...meFixture().context,
          allowedActions: NAV_ITEMS.flatMap((item) => (item.action ? [item.action] : [])),
        },
      }),
    );

    const nav = screen.getByRole("navigation", { name: "Principal" });
    for (const item of NAV_ITEMS) {
      expect(within(nav).getByRole("link", { name: item.label })).toHaveAttribute(
        "href",
        item.href,
      );
    }
  });

  it("tem o item 'Criar outra empresa' apontando para /nova-empresa", () => {
    renderShell(meFixture());

    const nav = screen.getByRole("navigation", { name: "Principal" });
    expect(within(nav).getByRole("link", { name: "Criar outra empresa" })).toHaveAttribute(
      "href",
      "/nova-empresa",
    );
  });

  it("mostra o conteúdo da página dentro da casca", () => {
    renderShell(meFixture());

    expect(screen.getByText("conteúdo da página")).toBeInTheDocument();
  });

  it("abre a navegação do celular ao tocar em 'Abrir menu'", async () => {
    const user = userEvent.setup();
    renderShell(
      meFixture({
        context: {
          ...meFixture().context,
          allowedActions: NAV_ITEMS.flatMap((item) => (item.action ? [item.action] : [])),
        },
      }),
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Abrir menu" }));

    const dialog = await screen.findByRole("dialog");
    for (const item of NAV_ITEMS) {
      expect(within(dialog).getByRole("link", { name: item.label })).toBeInTheDocument();
    }
  });
});

describe("casca: menu filtrado por permissão", () => {
  it("lançador com painel vê só Lançamentos e Criar outra empresa", () => {
    renderShell(
      meFixture({
        context: {
          ...meFixture().context,
          role: "staff",
          allowedActions: ["entry:view", "panel:access"],
        },
      }),
    );

    const nav = screen.getByRole("navigation", { name: "Principal" });
    const labels = within(nav)
      .getAllByRole("link")
      .map((link) => link.textContent);
    expect(labels).toEqual(["Lançamentos", "Criar outra empresa"]);
  });

  it("contador vê Configurações (catalog:view) e não vê Usuários nem ações de escrita", () => {
    renderShell(
      meFixture({
        context: {
          ...meFixture().context,
          role: "accountant",
          allowedActions: [
            "entry:view",
            "report:view",
            "panel:access",
            "export:data",
            "catalog:view",
          ],
        },
      }),
    );

    const nav = screen.getByRole("navigation", { name: "Principal" });
    expect(within(nav).getByRole("link", { name: "Configurações" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Exportações" })).toBeInTheDocument();
  });
});

describe("casca: contexto do painel", () => {
  it("contextSource diferente de cookie: mostra Carregando… e não renderiza a página", () => {
    renderShell(meFixture({ contextSource: "fallback" }));

    expect(screen.getByText("Carregando…")).toBeInTheDocument();
    expect(screen.queryByText("conteúdo da página")).not.toBeInTheDocument();
  });

  it("?aviso=acesso-removido mostra o aviso uma vez e limpa a URL", async () => {
    window.history.replaceState(null, "", "/lancamentos?aviso=acesso-removido");

    renderShell(meFixture());

    expect(
      await screen.findByText("Você não tem mais acesso à empresa ou unidade anterior."),
    ).toBeInTheDocument();
    await waitFor(() => expect(window.location.search).toBe(""));
  });

  it("sem o parâmetro, não mostra o aviso", () => {
    renderShell(meFixture());

    expect(screen.queryByText(/não tem mais acesso/)).not.toBeInTheDocument();
  });

  it("conta em somente leitura mostra a faixa", () => {
    renderShell(meFixture({ context: { ...meFixture().context, accountStatus: "read_only" } }));

    expect(screen.getByRole("status")).toHaveTextContent("somente leitura");
  });
});

describe("casca: menu do usuário", () => {
  it("mostra o nome e o acesso a 'Meu perfil' sem criar item novo em NAV_ITEMS", () => {
    renderShell(meFixture({ name: "Maria Souza" }));

    expect(screen.getAllByText("Maria Souza").length).toBeGreaterThan(0);
    for (const link of screen.getAllByRole("link", { name: "Meu perfil" })) {
      expect(link).toHaveAttribute("href", "/perfil");
    }
    expect(NAV_ITEMS.some((item) => item.href === "/perfil")).toBe(false);
  });
});

describe("casca: aviso de exportação (RF29.R4)", () => {
  const exportsCalls = () =>
    vi.mocked(fetch).mock.calls.filter(([url]) => String(url).includes("/api/exports"));

  it("com export:data e sessão completa, a casca acompanha as exportações", async () => {
    renderShell(meFixture());
    await waitFor(() => expect(exportsCalls().length).toBe(1));
  });

  it("sem export:data não consulta exportações", async () => {
    const base = meFixture();
    renderShell(
      meFixture({ context: { ...base.context, allowedActions: ["entry:view", "panel:access"] } }),
    );
    // Espera a casca assentar (o SessionKeeper chama a API) antes de afirmar a ausência.
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(exportsCalls()).toHaveLength(0);
  });

  it("sem o contexto vindo do cookie (casca ainda gravando), não consulta", async () => {
    renderShell(meFixture({ contextSource: "fallback" }));
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(exportsCalls()).toHaveLength(0);
  });
});
