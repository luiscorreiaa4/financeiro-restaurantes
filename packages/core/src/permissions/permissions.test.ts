import { describe, expect, it } from "vitest";
import {
  type Action,
  type Actor,
  ADDITIONAL_PERMISSIONS,
  type AdditionalPermission,
  authorize,
  can,
  type PermissionContext,
  ROLES,
  type Role,
  validatePermissions,
} from "./permissions";

const UNIT_A = "unit-a";
const UNIT_B = "unit-b";

function actor(
  role: Role,
  extra: {
    permissions?: readonly AdditionalPermission[];
    units?: "all" | readonly string[];
    panelAccess?: boolean;
  } = {},
): Actor {
  return {
    role,
    permissions: extra.permissions ?? [],
    units: extra.units ?? (role === "owner" || role === "accountant" ? "all" : [UNIT_A]),
    panelAccess: extra.panelAccess ?? role !== "staff",
  };
}

interface Row {
  readonly name: string;
  readonly action: Action;
  readonly ctx?: PermissionContext;
  readonly owner: boolean;
  readonly manager: boolean;
  readonly staff: boolean;
  readonly accountant: boolean;
}

const mine: PermissionContext = { unitId: UNIT_A, isOwnEntry: true };
const others: PermissionContext = { unitId: UNIT_A, isOwnEntry: false };
const sensitive: PermissionContext = {
  unitId: UNIT_A,
  isOwnEntry: true,
  categoryIsSensitive: true,
};

/** Seção 2.3 de docs/requisitos.md, linha a linha, sem permissões adicionais. */
const MATRIX: readonly Row[] = [
  {
    name: "lançar",
    action: "entry:create",
    ctx: { unitId: UNIT_A },
    owner: true,
    manager: true,
    staff: true,
    accountant: false,
  },
  {
    name: "lançar categoria sensível",
    action: "entry:create",
    ctx: sensitive,
    owner: true,
    manager: false,
    staff: false,
    accountant: false,
  },
  {
    name: "corrigir o próprio",
    action: "entry:edit",
    ctx: mine,
    owner: true,
    manager: true,
    staff: true,
    accountant: false,
  },
  {
    name: "desfazer o próprio",
    action: "entry:delete",
    ctx: mine,
    owner: true,
    manager: true,
    staff: true,
    accountant: false,
  },
  {
    name: "corrigir de outro",
    action: "entry:edit",
    ctx: others,
    owner: true,
    manager: true,
    staff: false,
    accountant: false,
  },
  {
    name: "desfazer de outro",
    action: "entry:delete",
    ctx: others,
    owner: true,
    manager: true,
    staff: false,
    accountant: false,
  },
  {
    name: "restaurar o próprio",
    action: "entry:restore",
    ctx: mine,
    owner: true,
    manager: true,
    staff: true,
    accountant: false,
  },
  {
    name: "restaurar de outro",
    action: "entry:restore",
    ctx: others,
    owner: true,
    manager: true,
    staff: false,
    accountant: false,
  },
  {
    name: "ver o próprio",
    action: "entry:view",
    ctx: mine,
    owner: true,
    manager: true,
    staff: true,
    accountant: true,
  },
  {
    name: "ver de outro",
    action: "entry:view",
    ctx: others,
    owner: true,
    manager: true,
    staff: false,
    accountant: true,
  },
  {
    name: "ver sensível",
    action: "entry:view",
    ctx: sensitive,
    owner: true,
    manager: false,
    staff: false,
    accountant: true,
  },
  {
    name: "editar sensível",
    action: "entry:edit",
    ctx: sensitive,
    owner: true,
    manager: false,
    staff: false,
    accountant: false,
  },
  {
    name: "excluir sensível",
    action: "entry:delete",
    ctx: sensitive,
    owner: true,
    manager: false,
    staff: false,
    accountant: false,
  },
  {
    name: "relatório no WhatsApp",
    action: "report:whatsapp",
    ctx: { unitId: UNIT_A },
    owner: true,
    manager: true,
    staff: false,
    accountant: false,
  },
  {
    name: "resumo semanal",
    action: "summary:weekly",
    owner: true,
    manager: false,
    staff: false,
    accountant: false,
  },
  {
    name: "acessar o painel",
    action: "panel:access",
    owner: true,
    manager: true,
    staff: false,
    accountant: true,
  },
  {
    name: "dashboard, DRE e perguntas",
    action: "report:view",
    ctx: { unitId: UNIT_A },
    owner: true,
    manager: true,
    staff: false,
    accountant: true,
  },
  {
    name: "exportar",
    action: "export:data",
    owner: true,
    manager: false,
    staff: false,
    accountant: true,
  },
  {
    name: "importar",
    action: "import:data",
    owner: true,
    manager: true,
    staff: false,
    accountant: false,
  },
  {
    name: "recorrências",
    action: "recurring:manage",
    owner: true,
    manager: true,
    staff: false,
    accountant: false,
  },
  {
    name: "gerenciar colaboradores",
    action: "user:manage",
    owner: true,
    manager: false,
    staff: false,
    accountant: false,
  },
  {
    name: "consultar colaboradores",
    action: "user:view",
    owner: true,
    manager: true,
    staff: false,
    accountant: false,
  },
  {
    name: "gerenciar cadastros",
    action: "catalog:manage",
    owner: true,
    manager: false,
    staff: false,
    accountant: false,
  },
  {
    name: "consultar cadastros",
    action: "catalog:view",
    owner: true,
    manager: true,
    staff: false,
    accountant: true,
  },
  {
    name: "captura de notas e certificado",
    action: "fiscal:configure",
    owner: true,
    manager: false,
    staff: false,
    accountant: false,
  },
  {
    name: "assinatura e plano",
    action: "subscription:manage",
    owner: true,
    manager: false,
    staff: false,
    accountant: false,
  },
];

describe("matriz de permissões (seção 2.3, RF06.CA06)", () => {
  for (const row of MATRIX) {
    for (const role of ROLES) {
      it(`${role} · ${row.name} → ${row[role]}`, () => {
        expect(can(actor(role), row.action, row.ctx ?? {})).toBe(row[role]);
      });
    }
  }

  it("lançador com o painel liberado pelo Dono acessa o painel", () => {
    expect(can(actor("staff", { panelAccess: true }), "panel:access")).toBe(true);
  });
});

describe("permissões adicionais", () => {
  it("gerente com VER_FOLHA lança, vê, edita e exclui categoria sensível (RF06.CA02)", () => {
    const manager = actor("manager", { permissions: ["VER_FOLHA"] });
    for (const action of ["entry:create", "entry:view", "entry:edit", "entry:delete"] as const) {
      expect(can(manager, action, sensitive)).toBe(true);
    }
  });

  it("gerente com EXPORTAR_DADOS exporta", () => {
    expect(can(actor("manager", { permissions: ["EXPORTAR_DADOS"] }), "export:data")).toBe(true);
  });

  it("gerente com RECEBER_RESUMO_SEMANAL recebe o resumo", () => {
    const manager = actor("manager", { permissions: ["RECEBER_RESUMO_SEMANAL"] });
    expect(can(manager, "summary:weekly")).toBe(true);
  });

  it("lançador com CONSULTAR_RELATORIOS_WHATSAPP recebe relatório das suas unidades (RF06.CA05)", () => {
    const staff = actor("staff", { permissions: ["CONSULTAR_RELATORIOS_WHATSAPP"] });
    expect(can(staff, "report:whatsapp", { unitId: UNIT_A })).toBe(true);
    expect(can(staff, "report:whatsapp", { unitId: UNIT_B })).toBe(false);
  });

  it("a permissão adicional não vale para papel que não a aceita", () => {
    const staff = actor("staff", { permissions: ["VER_FOLHA"] });
    expect(can(staff, "entry:create", sensitive)).toBe(false);
  });
});

describe("escopo de unidades (RF06.R5, RF06.CA03)", () => {
  it("gerente só age nas unidades de acesso", () => {
    const manager = actor("manager", { units: [UNIT_A] });
    expect(can(manager, "report:whatsapp", { unitId: UNIT_B })).toBe(false);
    expect(can(manager, "entry:edit", { unitId: UNIT_B, isOwnEntry: false })).toBe(false);
    expect(can(manager, "entry:create", { unitId: UNIT_B })).toBe(false);
  });

  it("acesso a todas as unidades vale para unidade qualquer", () => {
    const manager = actor("manager", { units: "all" });
    expect(can(manager, "report:whatsapp", { unitId: UNIT_B })).toBe(true);
  });

  it("dono e contador não são limitados por unidade", () => {
    expect(can(actor("owner"), "entry:view", { unitId: UNIT_B })).toBe(true);
    expect(can(actor("accountant"), "entry:view", { unitId: UNIT_B })).toBe(true);
  });
});

describe("contador (RF36.CA04, DD-04)", () => {
  const accountant = actor("accountant");

  it("vê folha sempre, mesmo sem VER_FOLHA", () => {
    expect(can(accountant, "entry:view", sensitive)).toBe(true);
  });

  it("nunca cria, edita, exclui nem restaura", () => {
    for (const action of ["entry:create", "entry:edit", "entry:delete", "entry:restore"] as const) {
      expect(can(accountant, action, { unitId: UNIT_A, isOwnEntry: true })).toBe(false);
      expect(can(accountant, action, sensitive)).toBe(false);
    }
  });
});

describe("validatePermissions (RF05.R7)", () => {
  it("aceita as permissões que fazem sentido no papel", () => {
    expect(validatePermissions("manager", ["VER_FOLHA", "EXPORTAR_DADOS"])).toEqual({
      ok: true,
      value: ["VER_FOLHA", "EXPORTAR_DADOS"],
    });
    expect(validatePermissions("staff", ["CONSULTAR_RELATORIOS_WHATSAPP"]).ok).toBe(true);
  });

  it("recusa permissão fora do papel", () => {
    expect(validatePermissions("manager", ["CONSULTAR_RELATORIOS_WHATSAPP"])).toEqual({
      ok: false,
      error: {
        code: "InvalidPermission",
        role: "manager",
        permission: "CONSULTAR_RELATORIOS_WHATSAPP",
      },
    });
    expect(validatePermissions("owner", ["VER_FOLHA"]).ok).toBe(false);
  });

  it("recusa valor desconhecido", () => {
    const result = validatePermissions("manager", ["PODE_TUDO"]);
    expect(result.ok).toBe(false);
  });

  it("conhece exatamente as quatro permissões adicionais", () => {
    expect(ADDITIONAL_PERMISSIONS).toEqual([
      "VER_FOLHA",
      "EXPORTAR_DADOS",
      "RECEBER_RESUMO_SEMANAL",
      "CONSULTAR_RELATORIOS_WHATSAPP",
    ]);
  });
});

describe("papéis e authorize", () => {
  it("conhece exatamente os quatro papéis", () => {
    expect(ROLES).toEqual(["owner", "manager", "staff", "accountant"]);
  });

  it("devolve ok quando permitido", () => {
    expect(authorize(actor("owner"), "user:manage")).toEqual({ ok: true, value: true });
  });

  it("devolve PermissionDenied com papel e ação quando negado", () => {
    expect(authorize(actor("staff"), "export:data")).toEqual({
      ok: false,
      error: { code: "PermissionDenied", role: "staff", action: "export:data" },
    });
  });
});
