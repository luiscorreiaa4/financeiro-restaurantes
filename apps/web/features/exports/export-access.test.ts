import { describe, expect, it } from "vitest";
import { exportAccess } from "./export-access";

describe("acesso à exportação", () => {
  it("sem export:data não há botão, mesmo com export:full", () => {
    expect(exportAccess(["entry:view"])).toEqual({ canExport: false, canFull: false });
    expect(exportAccess(["export:full"]).canExport).toBe(false);
  });

  it("export:data exporta lançamentos; o COMPLETO só com export:full (dono)", () => {
    expect(exportAccess(["export:data"])).toEqual({ canExport: true, canFull: false });
    expect(exportAccess(["export:data", "export:full"])).toEqual({
      canExport: true,
      canFull: true,
    });
  });
});
