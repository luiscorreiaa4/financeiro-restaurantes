import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MONTHLY, PARAMS, renderWithReports } from "./chart-test-helpers";
import { ResultChart, RevenueExpenseChart } from "./monthly-chart";

describe("gráficos mensais (RF27)", () => {
  it("receita × despesa: o gráfico tem o título como nome acessível", async () => {
    renderWithReports(<RevenueExpenseChart params={PARAMS} />, { monthly: async () => MONTHLY });
    expect(await screen.findByRole("img", { name: "Receita × despesa por mês" })).toBeDefined();
  });

  it("receita × despesa: a tabela alternativa mostra os mesmos valores do servidor", async () => {
    const user = userEvent.setup();
    renderWithReports(<RevenueExpenseChart params={PARAMS} />, { monthly: async () => MONTHLY });
    await user.click(await screen.findByRole("tab", { name: "Tabela" }));
    const table = screen.getByRole("table");
    expect(within(table).getByText("nov/26")).toBeDefined();
    expect(within(table).getByText("R$ 10.000,00")).toBeDefined();
    expect(within(table).getByText("R$ 7.350,00")).toBeDefined();
    expect(within(table).getAllByRole("row")).toHaveLength(7);
  });

  it("evolução do resultado: a tabela mostra o resultado do servidor, inclusive negativo", async () => {
    const user = userEvent.setup();
    const negative = {
      months: MONTHLY.months.map((m, i) =>
        i === 4 ? { ...m, revenueCents: 100, expenseCents: 5100, resultCents: -5000 } : m,
      ),
    };
    renderWithReports(<ResultChart params={PARAMS} />, { monthly: async () => negative });
    await user.click(await screen.findByRole("tab", { name: "Tabela" }));
    const table = screen.getByRole("table");
    expect(within(table).getByText("-R$ 50,00")).toBeDefined();
    expect(within(table).getByText("R$ 2.650,00")).toBeDefined();
  });

  it("os dois blocos usam uma só consulta mensal", async () => {
    const monthly = vi.fn(async () => MONTHLY);
    renderWithReports(
      <>
        <RevenueExpenseChart params={PARAMS} />
        <ResultChart params={PARAMS} />
      </>,
      { monthly },
    );
    await screen.findByRole("img", { name: "Evolução do resultado" });
    expect(monthly).toHaveBeenCalledTimes(1);
  });
});
