import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AccountBanner } from "./account-banner";

describe("faixa da situação da conta", () => {
  it("read_only mostra a faixa de somente leitura", () => {
    render(<AccountBanner status="read_only" userRole="manager" />);

    expect(screen.getByRole("status")).toHaveTextContent("somente leitura");
  });

  it("canceled mostra a faixa para o dono", () => {
    render(<AccountBanner status="canceled" userRole="owner" />);

    expect(screen.getByRole("status")).toHaveTextContent("Conta cancelada");
  });

  it("canceled não mostra faixa a quem não é dono", () => {
    render(<AccountBanner status="canceled" userRole="manager" />);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("conta ativa não mostra faixa", () => {
    render(<AccountBanner status="active" userRole="owner" />);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
