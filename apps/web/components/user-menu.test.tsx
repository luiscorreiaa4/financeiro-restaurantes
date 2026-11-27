import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UserMenu } from "./user-menu";

describe("menu do usuário", () => {
  it("mostra o nome, o link 'Meu perfil' e o botão 'Sair'", () => {
    render(<UserMenu name="Maria Souza" />);

    expect(screen.getByText("Maria Souza")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Meu perfil" })).toHaveAttribute("href", "/perfil");
    expect(screen.getByRole("button", { name: "Sair" })).toBeInTheDocument();
  });

  it("mostra o item 'Instalar o app' quando o app não está instalado", () => {
    render(<UserMenu name="Maria Souza" />);
    expect(screen.getByRole("button", { name: "Instalar o app" })).toBeInTheDocument();
  });

  it("no modo instalado (tela cheia) o item 'Instalar o app' não aparece", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: query === "(display-mode: standalone)",
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    render(<UserMenu name="Maria Souza" />);
    expect(screen.queryByRole("button", { name: "Instalar o app" })).not.toBeInTheDocument();
  });

  it("o item abre o diálogo com a orientação do navegador", async () => {
    render(<UserMenu name="Maria Souza" />);
    await userEvent.click(screen.getByRole("button", { name: "Instalar o app" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

afterEach(() => vi.unstubAllGlobals());
