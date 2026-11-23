import { describe, expect, it } from "vitest";
import { parseDashboardParams, serializeDashboardParams } from "./url-state";

const TODAY = "2026-11-17";
const UNIT_A = "0193a1b2-0000-7000-8000-00000000000a";
const UNIT_B = "0193a1b2-0000-7000-8000-00000000000b";
const parse = (query: string) => parseDashboardParams(new URLSearchParams(query), TODAY);

describe("estado do dashboard na URL (RF27.R1)", () => {
  it("sem parâmetros, vale o mês corrente até hoje, todas as unidades e período anterior", () => {
    expect(parse("")).toEqual({
      from: "2026-11-01",
      to: "2026-11-17",
      unitIds: [],
      compare: "previous_period",
    });
  });

  it("lê período, unidades e comparação", () => {
    expect(
      parse(
        `from=2026-10-01&to=2026-10-31&unitIds=${UNIT_A}&unitIds=${UNIT_B}&compare=previous_year`,
      ),
    ).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
      unitIds: [UNIT_A, UNIT_B],
      compare: "previous_year",
    });
  });

  it("aceita comparação desligada", () => {
    expect(parse("compare=none").compare).toBe("none");
  });

  it("comparação inválida volta ao período anterior e mantém o resto", () => {
    expect(parse("from=2026-10-01&to=2026-10-31&compare=xyz")).toMatchObject({
      from: "2026-10-01",
      to: "2026-10-31",
      compare: "previous_period",
    });
  });

  it("período invertido, inválido ou maior que 24 meses volta ao padrão", () => {
    for (const query of [
      "from=2026-10-31&to=2026-10-01",
      "from=2026-02-30&to=2026-03-01",
      "from=2024-01-01&to=2026-11-17",
      "from=2026-10-01",
    ]) {
      expect(parse(query)).toMatchObject({ from: "2026-11-01", to: "2026-11-17" });
    }
  });

  it("descarta só a unidade malformada", () => {
    expect(parse(`unitIds=${UNIT_A}&unitIds=nao-e-uuid`).unitIds).toEqual([UNIT_A]);
  });

  it("ida e volta: parse(serialize(x)) é igual a x", () => {
    const state = {
      from: "2026-09-01",
      to: "2026-10-15",
      unitIds: [UNIT_B, UNIT_A],
      compare: "none",
    } as const;
    expect(parse(serializeDashboardParams(state))).toEqual(state);
    const padrao = parse("");
    expect(parse(serializeDashboardParams(padrao))).toEqual(padrao);
  });
});
