import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmptyState } from "./empty-state";

describe("estado vazio do dashboard (RF27.Obs4)", () => {
  it("avisa que não há lançamentos e leva ao WhatsApp do produto", () => {
    render(<EmptyState whatsappNumber="+55 (82) 99999-0000" />);
    expect(screen.getByText("Ainda não há lançamentos neste período")).toBeDefined();
    const link = screen.getByRole("link", { name: /WhatsApp/ });
    expect(link.getAttribute("href")).toBe("https://wa.me/5582999990000");
  });

  it("sem número configurado não mostra o link", () => {
    render(<EmptyState whatsappNumber={undefined} />);
    expect(screen.getByText("Ainda não há lançamentos neste período")).toBeDefined();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
