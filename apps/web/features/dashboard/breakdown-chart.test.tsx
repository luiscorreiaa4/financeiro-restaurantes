import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { BreakdownChart } from "./breakdown-chart";
import { breakdown, PARAMS, renderWithReports } from "./chart-test-helpers";

describe("quebras do dashboard (RF27)", () => {
  it("a tabela de categoria mostra Pessoal (restrito) com o valor do servidor", async () => {
    const user = userEvent.setup();
    const report = breakdown("category", [
      { key: "restricted", label: "Pessoal (restrito)", amountCents: 300000, sharePermille: 429 },
      { key: "cmv", label: "CMV", amountCents: 250000, sharePermille: 357 },
    ]);
    renderWithReports(<BreakdownChart params={PARAMS} by="category" />, {
      breakdown: async () => report,
    });
    await user.click(await screen.findByRole("tab", { name: "Tabela" }));
    const table = screen.getByRole("table");
    expect(within(table).getByText("Pessoal (restrito)")).toBeDefined();
    expect(within(table).getByText("R$ 3.000,00")).toBeDefined();
    expect(within(table).getByText("42,9%")).toBeDefined();
    expect(within(table).queryByText("Folha de pagamento")).toBeNull();
  });

  it("a tabela de canal mostra Não informado", async () => {
    const user = userEvent.setup();
    const report = breakdown("sales_channel", [
      { key: "none", label: "Não informado", amountCents: 500000, sharePermille: 1000 },
    ]);
    renderWithReports(<BreakdownChart params={PARAMS} by="sales_channel" />, {
      breakdown: async () => report,
    });
    await user.click(await screen.findByRole("tab", { name: "Tabela" }));
    expect(within(screen.getByRole("table")).getByText("Não informado")).toBeDefined();
    expect(screen.getByText("Canal")).toBeDefined();
  });

  it("sem itens mostra aviso em vez de gráfico vazio", async () => {
    renderWithReports(<BreakdownChart params={PARAMS} by="payment_method" />, {
      breakdown: async () => breakdown("payment_method", []),
    });
    expect(await screen.findByText("Sem valores neste período.")).toBeDefined();
  });

  it("pede a quebra certa ao servidor", async () => {
    let asked = "";
    renderWithReports(<BreakdownChart params={PARAMS} by="payment_method" />, {
      breakdown: async (_p, by) => {
        asked = by;
        return breakdown(by, []);
      },
    });
    await screen.findByText("Sem valores neste período.");
    expect(asked).toBe("payment_method");
  });
});
