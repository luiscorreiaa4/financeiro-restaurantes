import { render } from "@testing-library/react";
import { Bar, BarChart, XAxis } from "recharts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ChartConfig, ChartContainer } from "@/components/ui/chart";

describe("compatibilidade do Recharts com o React 19", () => {
  beforeEach(() => {
    vi.spyOn(console, "error");
    vi.spyOn(console, "warn");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renderiza um gráfico de barras sem erro nem aviso no console", () => {
    const { container } = render(
      <BarChart
        width={300}
        height={200}
        data={[
          { mes: "jan", total: 10 },
          { mes: "fev", total: 20 },
        ]}
      >
        <XAxis dataKey="mes" />
        <Bar dataKey="total" />
      </BarChart>,
    );

    expect(container.querySelector("svg.recharts-surface")).not.toBeNull();
    expect(console.error).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it("renderiza o ChartContainer do shadcn com um BarChart, sem erro nem aviso", () => {
    const config = { total: { label: "Total", color: "var(--chart-1)" } } satisfies ChartConfig;
    const { container } = render(
      <ChartContainer
        config={config}
        initialDimension={{ width: 300, height: 200 }}
        aria-label="Receita por mês"
      >
        <BarChart
          data={[
            { mes: "jan", total: 10 },
            { mes: "fev", total: 20 },
          ]}
        >
          <XAxis dataKey="mes" />
          <Bar dataKey="total" fill="var(--color-total)" />
        </BarChart>
      </ChartContainer>,
    );

    expect(container.querySelector("svg.recharts-surface")).not.toBeNull();
    expect(console.error).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
  });
});
