import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SUPPORT_EMAIL } from "@/lib/support";
import { RestrictedNotice } from "./restricted-notice";

describe("aviso da área restrita", () => {
  it("dono sem unidade: texto do motivo, botão Criar outra empresa e contato de suporte", () => {
    render(<RestrictedNotice reason="owner_no_unit" />);

    expect(screen.getByText("Sua empresa não tem unidade ativa.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Criar outra empresa" })).toHaveAttribute(
      "href",
      "/acesso-restrito/nova-empresa",
    );
    expect(screen.getByRole("link", { name: SUPPORT_EMAIL })).toHaveAttribute(
      "href",
      `mailto:${SUPPORT_EMAIL}`,
    );
  });

  it("sem vínculo: texto próprio, com o mesmo botão e contato", () => {
    render(<RestrictedNotice reason="no_membership" />);

    expect(screen.getByText("Você não tem acesso ativo a nenhuma empresa.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Criar outra empresa" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: SUPPORT_EMAIL })).toBeInTheDocument();
  });
});
