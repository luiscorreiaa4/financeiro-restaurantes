import { describe, expect, it } from "vitest";
import { entryActions, entryScopeFor } from "./entry-scope";
import type { Actor, AdditionalPermission, Role } from "./permissions";

const UNIT_A = "unit-a";
const UNIT_B = "unit-b";
const UNIT_C = "unit-c";
const ME = "user-me";
const SOMEONE_ELSE = "user-other";

function actor(
  role: Role,
  extra: {
    permissions?: readonly AdditionalPermission[];
    units?: "all" | readonly string[];
  } = {},
): Actor {
  return {
    role,
    permissions: extra.permissions ?? [],
    units: extra.units ?? (role === "owner" || role === "accountant" ? "all" : [UNIT_A, UNIT_B]),
    panelAccess: true,
  };
}

function entry(
  extra: {
    unitId?: string;
    createdBy?: string;
    categoryIsSensitive?: boolean;
    deleted?: boolean;
  } = {},
) {
  return {
    unitId: extra.unitId ?? UNIT_A,
    createdBy: extra.createdBy ?? SOMEONE_ELSE,
    categoryIsSensitive: extra.categoryIsSensitive ?? false,
    deleted: extra.deleted ?? false,
  };
}

const NOTHING = { canEdit: false, canDelete: false, canRestore: false };

describe("recorte de visibilidade por papel (RF06.R3, RF22.R2, RF22.R3)", () => {
  const cases: readonly {
    name: string;
    actor: Actor;
    ownerUserId: string | null;
    includeSensitive: boolean;
  }[] = [
    {
      name: "dono vê os lançamentos de todos, com folha",
      actor: actor("owner"),
      ownerUserId: null,
      includeSensitive: true,
    },
    {
      name: "gerente sem VER_FOLHA vê os de todos, sem folha",
      actor: actor("manager"),
      ownerUserId: null,
      includeSensitive: false,
    },
    {
      name: "gerente com VER_FOLHA vê os de todos, com folha",
      actor: actor("manager", { permissions: ["VER_FOLHA"] }),
      ownerUserId: null,
      includeSensitive: true,
    },
    {
      name: "lançador vê só os próprios e nunca folha, nem a que ele lançou",
      actor: actor("staff"),
      ownerUserId: ME,
      includeSensitive: false,
    },
    {
      name: "lançador com VER_FOLHA gravada por engano continua sem folha",
      actor: actor("staff", { permissions: ["VER_FOLHA"] }),
      ownerUserId: ME,
      includeSensitive: false,
    },
    {
      name: "contador vê os de todos, com folha",
      actor: actor("accountant"),
      ownerUserId: null,
      includeSensitive: true,
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      const result = entryScopeFor({ actor: c.actor, userId: ME, activeUnitId: "all" });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.ownerUserId).toBe(c.ownerUserId);
      expect(result.value.includeSensitive).toBe(c.includeSensitive);
    });
  }
});

describe("unidades do recorte (RF06.R5, RF22.R2)", () => {
  it("unidade ativa específica, sem filtro, limita o recorte a ela", () => {
    const result = entryScopeFor({ actor: actor("manager"), userId: ME, activeUnitId: UNIT_A });
    expect(result).toEqual({
      ok: true,
      value: { unitIds: [UNIT_A], ownerUserId: null, includeSensitive: false },
    });
  });

  it("seletor em todas, sem filtro, usa as unidades de acesso do gerente", () => {
    const result = entryScopeFor({ actor: actor("manager"), userId: ME, activeUnitId: "all" });
    expect(result.ok && result.value.unitIds).toEqual([UNIT_A, UNIT_B]);
  });

  it("seletor em todas, sem filtro, vale para todas as unidades de quem tem acesso a todas", () => {
    const result = entryScopeFor({ actor: actor("owner"), userId: ME, activeUnitId: "all" });
    expect(result.ok && result.value.unitIds).toBe("all");
  });

  it("filtro explícito prevalece sobre a unidade ativa", () => {
    const result = entryScopeFor({
      actor: actor("manager"),
      userId: ME,
      activeUnitId: UNIT_A,
      requestedUnitIds: [UNIT_B],
    });
    expect(result.ok && result.value.unitIds).toEqual([UNIT_B]);
  });

  it("filtro explícito de quem tem acesso a todas aceita qualquer unidade", () => {
    const result = entryScopeFor({
      actor: actor("owner"),
      userId: ME,
      activeUnitId: UNIT_A,
      requestedUnitIds: [UNIT_B, UNIT_C],
    });
    expect(result.ok && result.value.unitIds).toEqual([UNIT_B, UNIT_C]);
  });

  it("filtro vazio conta como sem filtro e cai na unidade ativa", () => {
    const result = entryScopeFor({
      actor: actor("manager"),
      userId: ME,
      activeUnitId: UNIT_B,
      requestedUnitIds: [],
    });
    expect(result.ok && result.value.unitIds).toEqual([UNIT_B]);
  });

  it("filtro com unidade fora do acesso é recusado inteiro, mesmo com outra permitida junto", () => {
    const result = entryScopeFor({
      actor: actor("manager"),
      userId: ME,
      activeUnitId: UNIT_A,
      requestedUnitIds: [UNIT_A, UNIT_C],
    });
    expect(result).toEqual({
      ok: false,
      error: { code: "PermissionDenied", role: "manager", action: "entry:view" },
    });
  });

  it("lançador que pede unidade fora do acesso é recusado", () => {
    const result = entryScopeFor({
      actor: actor("staff", { units: [UNIT_A] }),
      userId: ME,
      activeUnitId: UNIT_A,
      requestedUnitIds: [UNIT_B],
    });
    expect(result.ok).toBe(false);
  });

  it("unidade ativa fora do acesso é recusada, sem cair nas unidades de acesso", () => {
    const result = entryScopeFor({
      actor: actor("manager"),
      userId: ME,
      activeUnitId: UNIT_C,
    });
    expect(result).toEqual({
      ok: false,
      error: { code: "PermissionDenied", role: "manager", action: "entry:view" },
    });
  });
});

describe("o que cada um pode fazer com um lançamento (matriz 2.3, RF23, RF24)", () => {
  const live = { canEdit: true, canDelete: true, canRestore: false };

  it("dono edita e exclui lançamento de outro, inclusive folha", () => {
    expect(entryActions(actor("owner"), entry({ categoryIsSensitive: true }), ME)).toEqual(live);
  });

  it("gerente edita e exclui lançamento de outro nas suas unidades", () => {
    expect(entryActions(actor("manager"), entry(), ME)).toEqual(live);
  });

  it("gerente não mexe em lançamento de unidade fora do seu acesso", () => {
    expect(entryActions(actor("manager"), entry({ unitId: UNIT_C }), ME)).toEqual(NOTHING);
  });

  it("gerente sem VER_FOLHA não mexe em folha, nem na que ele lançou", () => {
    const payroll = entry({ categoryIsSensitive: true, createdBy: ME });
    expect(entryActions(actor("manager"), payroll, ME)).toEqual(NOTHING);
  });

  it("gerente com VER_FOLHA edita e exclui folha", () => {
    const manager = actor("manager", { permissions: ["VER_FOLHA"] });
    expect(entryActions(manager, entry({ categoryIsSensitive: true }), ME)).toEqual(live);
  });

  it("lançador edita e exclui o próprio lançamento", () => {
    expect(entryActions(actor("staff"), entry({ createdBy: ME }), ME)).toEqual(live);
  });

  it("lançador não faz nada em lançamento alheio", () => {
    expect(entryActions(actor("staff"), entry(), ME)).toEqual(NOTHING);
    expect(entryActions(actor("staff"), entry({ deleted: true }), ME)).toEqual(NOTHING);
  });

  it("lançador não mexe em folha, nem na que ele lançou", () => {
    const payroll = entry({ categoryIsSensitive: true, createdBy: ME });
    expect(entryActions(actor("staff"), payroll, ME)).toEqual(NOTHING);
  });

  it("contador não edita, não exclui e não restaura nada (RF23.CA04)", () => {
    const accountant = actor("accountant");
    expect(entryActions(accountant, entry(), ME)).toEqual(NOTHING);
    expect(entryActions(accountant, entry({ createdBy: ME }), ME)).toEqual(NOTHING);
    expect(entryActions(accountant, entry({ categoryIsSensitive: true }), ME)).toEqual(NOTHING);
    expect(entryActions(accountant, entry({ deleted: true }), ME)).toEqual(NOTHING);
  });

  it("lançamento na lixeira só pode ser restaurado", () => {
    const onlyRestore = { canEdit: false, canDelete: false, canRestore: true };
    expect(entryActions(actor("owner"), entry({ deleted: true }), ME)).toEqual(onlyRestore);
    expect(entryActions(actor("manager"), entry({ deleted: true }), ME)).toEqual(onlyRestore);
    expect(entryActions(actor("staff"), entry({ deleted: true, createdBy: ME }), ME)).toEqual(
      onlyRestore,
    );
  });

  it("lançamento na lixeira de unidade fora do acesso não pode ser restaurado", () => {
    const trashed = entry({ deleted: true, unitId: UNIT_C });
    expect(entryActions(actor("manager"), trashed, ME)).toEqual(NOTHING);
  });
});
