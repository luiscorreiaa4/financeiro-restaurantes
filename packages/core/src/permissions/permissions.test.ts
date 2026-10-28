import { describe, expect, it } from "vitest";
import { type Action, authorize, can, ROLES } from "./permissions";

describe("permissões por papel", () => {
  it("dono pode tudo, inclusive usuários e exportação", () => {
    const actions: Action[] = [
      "entry:create",
      "entry:view",
      "entry:edit",
      "entry:delete",
      "report:view",
      "export:data",
      "user:manage",
    ];
    for (const action of actions) expect(can("owner", action)).toBe(true);
  });

  it("gerente lança, edita e apaga qualquer lançamento e vê relatórios", () => {
    for (const action of [
      "entry:create",
      "entry:view",
      "entry:edit",
      "entry:delete",
      "report:view",
    ] as const) {
      expect(can("manager", action)).toBe(true);
    }
  });

  it("gerente não gerencia usuários nem exporta", () => {
    expect(can("manager", "user:manage")).toBe(false);
    expect(can("manager", "export:data")).toBe(false);
  });

  it("funcionário lança e desfaz o próprio lançamento", () => {
    expect(can("staff", "entry:create")).toBe(true);
    expect(can("staff", "entry:delete", { isOwnEntry: true })).toBe(true);
    expect(can("staff", "entry:edit", { isOwnEntry: true })).toBe(true);
  });

  it("funcionário não mexe em lançamento de outra pessoa", () => {
    expect(can("staff", "entry:delete", { isOwnEntry: false })).toBe(false);
    expect(can("staff", "entry:edit")).toBe(false);
    expect(can("staff", "entry:view")).toBe(false);
  });

  it("funcionário não vê relatórios, não exporta e não gerencia usuários", () => {
    expect(can("staff", "report:view")).toBe(false);
    expect(can("staff", "export:data")).toBe(false);
    expect(can("staff", "user:manage")).toBe(false);
  });
});

describe("categorias sensíveis (folha de pagamento)", () => {
  it("só o dono age sobre lançamento de categoria sensível", () => {
    const sensitive = { categoryIsSensitive: true, isOwnEntry: true };
    expect(can("owner", "entry:view", sensitive)).toBe(true);
    expect(can("owner", "entry:edit", sensitive)).toBe(true);
  });

  it("gerente não vê, não lança, não edita e não apaga categoria sensível", () => {
    for (const action of ["entry:view", "entry:create", "entry:edit", "entry:delete"] as const) {
      expect(can("manager", action, { categoryIsSensitive: true })).toBe(false);
    }
  });

  it("funcionário não lança nem desfaz categoria sensível, mesmo sendo o autor", () => {
    expect(can("staff", "entry:create", { categoryIsSensitive: true })).toBe(false);
    expect(can("staff", "entry:delete", { categoryIsSensitive: true, isOwnEntry: true })).toBe(
      false,
    );
  });

  it("a mesma ação em categoria comum continua permitida ao gerente", () => {
    expect(can("manager", "entry:edit", { categoryIsSensitive: false })).toBe(true);
  });
});

describe("authorize", () => {
  it("devolve ok quando permitido", () => {
    expect(authorize("owner", "user:manage")).toEqual({ ok: true, value: true });
  });

  it("devolve PermissionDenied com papel e ação quando negado", () => {
    expect(authorize("staff", "export:data")).toEqual({
      ok: false,
      error: { code: "PermissionDenied", role: "staff", action: "export:data" },
    });
  });

  it("conhece exatamente os três papéis", () => {
    expect(ROLES).toEqual(["owner", "manager", "staff"]);
  });
});
