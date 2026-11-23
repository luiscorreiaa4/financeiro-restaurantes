import { entryFiltersSchema, entryListQuerySchema } from "@app/core/contracts";
import { describe, expect, it } from "vitest";
import { countAppliedFilters, toExportFilters } from "./export-filters";

const UNIT = "0193a1b2-0000-7000-8000-00000000000a";

describe("filtros da exportação", () => {
  it("leva os filtros da lista e deixa de fora ordenação, direção, cursor e limite", () => {
    const query = entryListQuerySchema.parse({
      from: "2026-10-01",
      to: "2026-10-31",
      type: "expense",
      unitIds: UNIT,
      q: "gás",
      sort: "amount",
      dir: "asc",
      cursor: "abc",
      limit: 20,
    });
    const filters = toExportFilters(query);
    expect(filters).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
      type: "expense",
      unitIds: [UNIT],
      q: "gás",
    });
    // O contrato da exportação é estrito: o resultado tem que passar nele.
    expect(entryFiltersSchema.safeParse(filters).success).toBe(true);
    for (const key of ["sort", "dir", "cursor", "limit"]) expect(filters).not.toHaveProperty(key);
  });

  it("só o período: corpo mínimo, sem chaves indefinidas", () => {
    const filters = toExportFilters(
      entryListQuerySchema.parse({ from: "2026-10-01", to: "2026-10-31" }),
    );
    expect(Object.keys(filters).sort()).toEqual(["from", "to"]);
  });

  it("conta os filtros além do período", () => {
    expect(countAppliedFilters({ from: "2026-10-01", to: "2026-10-31" })).toBe(0);
    expect(
      countAppliedFilters({
        from: "2026-10-01",
        to: "2026-10-31",
        type: "revenue",
        unitIds: [UNIT],
        q: "x",
      }),
    ).toBe(3);
  });
});
