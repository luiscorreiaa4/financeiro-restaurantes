import { describe, expect, it } from "vitest";
import { tenantKey } from "./keys";

describe("tenantKey", () => {
  it("começa com t, empresa e unidade", () => {
    expect(tenantKey({ tenantId: "A", unitId: "U1" }, "units")).toEqual(["t", "A", "U1", "units"]);
  });

  it("duas unidades geram chaves diferentes", () => {
    expect(tenantKey({ tenantId: "A", unitId: "U1" }, "units")).not.toEqual(
      tenantKey({ tenantId: "A", unitId: "all" }, "units"),
    );
  });
});
