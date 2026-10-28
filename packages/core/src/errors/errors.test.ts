import { describe, expect, it } from "vitest";
import { fail } from "./domain-errors";
import { err, ok } from "./result";

describe("Result e erros nomeados", () => {
  it("ok e err carregam valor e erro com o discriminador certo", () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
    expect(err("x")).toEqual({ ok: false, error: "x" });
  });

  it("fail cria erro com code e detalhes tipados", () => {
    expect(fail("AmountMissing")).toEqual({ ok: false, error: { code: "AmountMissing" } });
    expect(fail("PermissionDenied", { role: "staff", action: "export:data" })).toEqual({
      ok: false,
      error: { code: "PermissionDenied", role: "staff", action: "export:data" },
    });
  });
});
