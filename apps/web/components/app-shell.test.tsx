import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { NAV_ITEMS } from "@/lib/navigation";
import { AppShell } from "./app-shell";

describe("casca da aplicação", () => {
  it("mostra um link na navegação principal para cada item de NAV_ITEMS", () => {
    render(
      <AppShell>
        <p>conteúdo da página</p>
      </AppShell>,
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
    render(
      <AppShell>
        <p>conteúdo</p>
      </AppShell>,
    );

    const nav = screen.getByRole("navigation", { name: "Principal" });
    expect(within(nav).getByRole("link", { name: "Criar outra empresa" })).toHaveAttribute(
      "href",
      "/nova-empresa",
    );
  });

  it("mostra o conteúdo da página dentro da casca", () => {
    render(
      <AppShell>
        <p>conteúdo da página</p>
      </AppShell>,
    );

    expect(screen.getByText("conteúdo da página")).toBeInTheDocument();
  });

  it("abre a navegação do celular ao tocar em 'Abrir menu'", async () => {
    const user = userEvent.setup();
    render(
      <AppShell>
        <p>conteúdo</p>
      </AppShell>,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Abrir menu" }));

    const dialog = await screen.findByRole("dialog");
    for (const item of NAV_ITEMS) {
      expect(within(dialog).getByRole("link", { name: item.label })).toBeInTheDocument();
    }
  });
});
