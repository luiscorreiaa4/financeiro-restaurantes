import { describe, expect, it } from "vitest";
import { type SalesChannelInput, validateSalesChannel } from "./sales-channel";

const base: SalesChannelInput = {
  name: "iFood",
  type: "app",
  feePercentBp: 2300,
  aliases: ["ifood"],
  status: "active",
};
const code = (r: ReturnType<typeof validateSalesChannel>) => (r.ok ? "ok" : r.error.code);

describe("validateSalesChannel", () => {
  it("aceita canal válido", () => {
    expect(code(validateSalesChannel(base, { existing: [] }))).toBe("ok");
  });
  it("recusa 120 %", () => {
    expect(code(validateSalesChannel({ ...base, feePercentBp: 12000 }, { existing: [] }))).toBe(
      "InvalidFeeRate",
    );
  });
  it("recusa nome repetido", () => {
    expect(
      code(
        validateSalesChannel(
          { ...base, aliases: [] },
          { existing: [{ id: "1", name: "IFOOD", aliases: [] }] },
        ),
      ),
    ).toBe("NameTaken");
  });
  it("editar 'Não informado' é recusado", () => {
    expect(
      code(
        validateSalesChannel(
          { ...base, name: "Não informado" },
          { existing: [], currentName: "Não informado" },
        ),
      ),
    ).toBe("SystemCatalogReadOnly");
  });
});
