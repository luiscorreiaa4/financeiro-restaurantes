import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { NO_INDICATOR, summaryFixture, withoutPayroll } from "./dashboard-fixtures";
import { IndicatorCards } from "./indicator-cards";

describe("cartões de indicadores (RF27)", () => {
  it("mostra os valores formatados que o servidor entregou", () => {
    render(<IndicatorCards summary={summaryFixture()} />);
    const receita = screen.getByRole("group", { name: "Receita bruta" });
    expect(within(receita).getByText("R$ 10.000,00")).toBeDefined();
    expect(
      within(screen.getByRole("group", { name: "Resultado" })).getByText("R$ 2.650,00"),
    ).toBeDefined();
    expect(within(screen.getByRole("group", { name: "Margem" })).getByText("26,5%")).toBeDefined();
    expect(
      within(screen.getByRole("group", { name: "Ponto de equilíbrio" })).getByText("R$ 28.571,43"),
    ).toBeDefined();
  });

  it("a variação tem texto acessível com o período de comparação", () => {
    render(<IndicatorCards summary={summaryFixture()} />);
    const receita = screen.getByRole("group", { name: "Receita bruta" });
    expect(
      within(receita).getByText("aumento de 11,1% em relação ao período anterior"),
    ).toBeDefined();
  });

  it("com comparação do ano anterior o texto diz o mesmo período do ano anterior", () => {
    render(
      <IndicatorCards
        summary={summaryFixture({
          comparison: { kind: "previous_year", period: { from: "2025-11-01", to: "2025-11-17" } },
        })}
      />,
    );
    expect(
      within(screen.getByRole("group", { name: "Receita bruta" })).getByText(
        "aumento de 11,1% em relação ao mesmo período do ano anterior",
      ),
    ).toBeDefined();
  });

  it("indicador percentual varia em pontos percentuais", () => {
    render(<IndicatorCards summary={summaryFixture()} />);
    expect(
      within(screen.getByRole("group", { name: "CMV sobre a receita" })).getByText(
        "queda de 1,0 ponto percentual em relação ao período anterior",
      ),
    ).toBeDefined();
  });

  it("sem comparação não mostra variação", () => {
    render(<IndicatorCards summary={summaryFixture({ comparison: null })} />);
    expect(screen.queryByText(/em relação ao/)).toBeNull();
  });

  it("o ticket médio mostra a base da receita com pedidos", () => {
    render(<IndicatorCards summary={summaryFixture()} />);
    const ticket = screen.getByRole("group", { name: "Ticket médio" });
    expect(within(ticket).getByText("R$ 30,00")).toBeDefined();
    expect(within(ticket).getByText("base: 60% da receita")).toBeDefined();
  });

  it("ticket médio nulo mostra traço e não mostra base", () => {
    const base = summaryFixture();
    render(
      <IndicatorCards
        summary={{
          ...base,
          ticketCoveragePermille: null,
          indicators: { ...base.indicators, averageTicket: NO_INDICATOR },
        }}
      />,
    );
    const ticket = screen.getByRole("group", { name: "Ticket médio" });
    expect(within(ticket).getByText("—")).toBeDefined();
    expect(within(ticket).queryByText(/base:/)).toBeNull();
  });

  it("sem payrollRatio na resposta, nenhum cartão de folha aparece", () => {
    render(<IndicatorCards summary={withoutPayroll(summaryFixture())} />);
    expect(screen.queryByRole("group", { name: /Folha/ })).toBeNull();
  });

  it("com payrollRatio aparece o cartão de folha sobre a receita", () => {
    render(<IndicatorCards summary={summaryFixture()} />);
    expect(
      within(screen.getByRole("group", { name: "Folha sobre a receita" })).getByText("30,0%"),
    ).toBeDefined();
  });

  it("anterior zero com atual diferente avisa que não há base, sem inventar percentual", () => {
    const base = summaryFixture();
    render(
      <IndicatorCards
        summary={{
          ...base,
          indicators: {
            ...base.indicators,
            grossRevenue: { value: 5000, previous: 0, changePermille: null, direction: "up" },
          },
        }}
      />,
    );
    expect(
      within(screen.getByRole("group", { name: "Receita bruta" })).getByText(
        "aumento, sem base para calcular o percentual",
      ),
    ).toBeDefined();
  });
});
