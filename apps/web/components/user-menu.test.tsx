import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UserMenu } from "./user-menu";

describe("menu do usuário", () => {
  it("mostra o nome, o link 'Meu perfil' e o botão 'Sair'", () => {
    render(<UserMenu name="Maria Souza" />);

    expect(screen.getByText("Maria Souza")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Meu perfil" })).toHaveAttribute("href", "/perfil");
    expect(screen.getByRole("button", { name: "Sair" })).toBeInTheDocument();
  });
});
