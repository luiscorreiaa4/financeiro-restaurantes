import { render } from "@testing-library/react";
import { Bar, BarChart, XAxis } from "recharts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
});
