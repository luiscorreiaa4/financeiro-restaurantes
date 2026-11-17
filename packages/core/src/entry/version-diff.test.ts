import { describe, expect, it } from "vitest";
import type { Money } from "../money";
import type { Entry } from "./entry";
import { createEntry, editEntry, restoreEntry, softDeleteEntry } from "./entry";
import {
  diffVersion,
  parseVersionSnapshot,
  REMOVED_NAME,
  type VersionNames,
  type VersionSnapshot,
} from "./version-diff";

const TENANT = "0198a000-0000-7000-8000-000000000001";
const ENTRY = "0198a000-0000-7000-8000-0000000000e1";
const USER = "0198a000-0000-7000-8000-0000000000d1";
const UNIT_1 = "0198a000-0000-7000-8000-0000000000a1";
const UNIT_2 = "0198a000-0000-7000-8000-0000000000a2";
const INSUMOS = "0198a000-0000-7000-8000-0000000000c1";
const LIMPEZA = "0198a000-0000-7000-8000-0000000000c2";
const PAYROLL = "0198a000-0000-7000-8000-0000000000c3";
const UNKNOWN = "0198a000-0000-7000-8000-0000000000ff";
const SUPPLIER = "0198a000-0000-7000-8000-0000000000f1";
const PIX = "0198a000-0000-7000-8000-0000000000b1";
const SALAO = "0198a000-0000-7000-8000-0000000000b2";

const names: VersionNames = {
  categories: new Map([
    [INSUMOS, { name: "Insumos", isSensitive: false }],
    [LIMPEZA, { name: "Limpeza", isSensitive: false }],
    [PAYROLL, { name: "Folha de pagamento", isSensitive: true }],
  ]),
  suppliers: new Map([[SUPPLIER, "Açougue do Zé"]]),
  paymentMethods: new Map([[PIX, "Pix"]]),
  salesChannels: new Map([[SALAO, "Salão"]]),
  units: new Map([
    [UNIT_1, "Matriz"],
    [UNIT_2, "Filial"],
  ]),
};

const money = (cents: number) => cents as Money;

const at = new Date("2026-11-10T15:00:00Z");
const context = { actorId: USER, channel: "web" as const, at };

function entry(over: Partial<Parameters<typeof createEntry>[0]> = {}): Entry {
  const created = createEntry(
    {
      unitId: UNIT_1,
      type: "expense",
      occurredOn: "2026-11-05",
      description: "Carne",
      quantity: 3.5,
      quantityUnit: "kg",
      amountCents: money(12_345),
      feePercentBp: 0,
      feeFixedCents: 0,
      categoryId: INSUMOS,
      supplierId: SUPPLIER,
      paymentMethodId: PIX,
      salesChannelId: null,
      inboundMessageId: null,
      ...over,
    },
    { ...context, id: ENTRY, tenantId: TENANT },
  );
  if (!created.ok) throw new Error(created.error.code);
  return created.value.entry;
}

function edited(base: Entry, patch: Parameters<typeof editEntry>[1]): Entry {
  const result = editEntry(base, patch, context);
  if (!result.ok) throw new Error(result.error.code);
  return result.value.entry;
}

describe("diffVersion: alteração", () => {
  it("mudança de valor lista o bruto e o líquido recalculado, em centavos inteiros", () => {
    const before = entry();
    const after = edited(before, { amountCents: money(20_000) });
    expect(diffVersion(before, after, names)).toEqual({
      sensitive: false,
      changes: [
        { field: "amountCents", before: 12_345, after: 20_000 },
        { field: "netCents", before: 12_345, after: 20_000 },
      ],
    });
  });

  it("mudança de categoria mostra os nomes atuais do cadastro, nunca os ids", () => {
    const before = entry();
    const after = edited(before, { categoryId: LIMPEZA });
    const diff = diffVersion(before, after, names);
    expect(diff.changes).toEqual([{ field: "category", before: "Insumos", after: "Limpeza" }]);
    expect(JSON.stringify(diff)).not.toContain(INSUMOS);
    expect(JSON.stringify(diff)).not.toContain(LIMPEZA);
  });

  it("fornecedor, forma de pagamento, canal de venda e unidade também vão pelo nome", () => {
    const before = entry();
    const after: Entry = {
      ...before,
      supplierId: null,
      paymentMethodId: null,
      salesChannelId: SALAO,
      unitId: UNIT_2,
    };
    expect(diffVersion(before, after, names).changes).toEqual([
      { field: "supplier", before: "Açougue do Zé", after: null },
      { field: "paymentMethod", before: "Pix", after: null },
      { field: "salesChannel", before: null, after: "Salão" },
      { field: "unit", before: "Matriz", after: "Filial" },
    ]);
  });

  it("cadastro que não está mais no mapa vira texto fixo, nunca o id cru", () => {
    const before = entry({ supplierId: UNKNOWN });
    const after = edited(before, { supplierId: SUPPLIER });
    const diff = diffVersion(before, after, names);
    expect(diff.changes).toEqual([
      { field: "supplier", before: REMOVED_NAME, after: "Açougue do Zé" },
    ]);
    expect(JSON.stringify(diff)).not.toContain(UNKNOWN);
  });

  it("os sinais de revisão vão como um texto só; sem sinais, nulo", () => {
    const before = entry({ flags: ["category_to_review", "old_date"] });
    const after: Entry = { ...before, flags: [] };
    expect(diffVersion(before, after, names).changes).toEqual([
      { field: "flags", before: "category_to_review, old_date", after: null },
    ]);
  });

  it("descrição, datas e quantidade saem como estão, inclusive texto com marcação", () => {
    const before = entry();
    const after = edited(before, {
      description: "<script>alert(1)</script>",
      occurredOn: "2026-11-06",
      paidOn: "2026-11-20",
      quantity: 4,
    });
    expect(diffVersion(before, after, names).changes).toEqual([
      { field: "occurredOn", before: "2026-11-05", after: "2026-11-06" },
      { field: "paidOn", before: "2026-11-05", after: "2026-11-20" },
      { field: "description", before: "Carne", after: "<script>alert(1)</script>" },
      { field: "quantity", before: 3.5, after: 4 },
    ]);
  });

  it("antes e depois iguais não geram campo nenhum", () => {
    const same = entry();
    expect(diffVersion(same, { ...same }, names).changes).toEqual([]);
  });
});

describe("diffVersion: criação, exclusão e restauração", () => {
  it("criação lista só os campos preenchidos, com o antes nulo", () => {
    const diff = diffVersion(null, entry(), names);
    expect(diff.sensitive).toBe(false);
    expect(diff.changes).toEqual([
      { field: "type", before: null, after: "expense" },
      { field: "occurredOn", before: null, after: "2026-11-05" },
      { field: "paidOn", before: null, after: "2026-11-05" },
      { field: "description", before: null, after: "Carne" },
      { field: "quantity", before: null, after: 3.5 },
      { field: "quantityUnit", before: null, after: "kg" },
      { field: "amountCents", before: null, after: 12_345 },
      { field: "feePercentBp", before: null, after: 0 },
      { field: "feeFixedCents", before: null, after: 0 },
      { field: "feeCents", before: null, after: 0 },
      { field: "netCents", before: null, after: 12_345 },
      { field: "category", before: null, after: "Insumos" },
      { field: "supplier", before: null, after: "Açougue do Zé" },
      { field: "paymentMethod", before: null, after: "Pix" },
      { field: "unit", before: null, after: "Matriz" },
    ]);
  });

  it("exclusão registra o motivo em deleteReason, e mais nada", () => {
    const before = entry();
    const deleted = softDeleteEntry(before, context, { reason: "Lançado em dobro" });
    if (!deleted.ok) throw new Error(deleted.error.code);
    expect(diffVersion(before, deleted.value.entry, names).changes).toEqual([
      { field: "deleteReason", before: null, after: "Lançado em dobro" },
    ]);
  });

  it("exclusão sem motivo não lista campo", () => {
    const before = entry();
    const deleted = softDeleteEntry(before, context);
    if (!deleted.ok) throw new Error(deleted.error.code);
    expect(diffVersion(before, deleted.value.entry, names).changes).toEqual([]);
  });

  it("restauração mostra o motivo da exclusão saindo", () => {
    const deleted = softDeleteEntry(entry(), context, { reason: "Engano" });
    if (!deleted.ok) throw new Error(deleted.error.code);
    const restored = restoreEntry(deleted.value.entry, context);
    if (!restored.ok) throw new Error(restored.error.code);
    expect(diffVersion(deleted.value.entry, restored.value.entry, names).changes).toEqual([
      { field: "deleteReason", before: "Engano", after: null },
    ]);
  });
});

describe("diffVersion: categoria sensível (falha fechado)", () => {
  it("depois em categoria sensível marca a versão como sensível", () => {
    const before = entry();
    expect(diffVersion(before, edited(before, { categoryId: PAYROLL }), names).sensitive).toBe(
      true,
    );
  });

  it("antes em categoria sensível marca a versão, mesmo que o depois não esteja", () => {
    const before = entry({ categoryId: PAYROLL });
    const after = edited(before, { categoryId: INSUMOS });
    const diff = diffVersion(before, after, names);
    expect(diff.sensitive).toBe(true);
    // Quem chama decide o que vai para a resposta; o diff completo é para quem vê sensíveis.
    expect(diff.changes).toEqual([
      { field: "category", before: "Folha de pagamento", after: "Insumos" },
    ]);
  });

  it("criação em categoria sensível é sensível", () => {
    expect(diffVersion(null, entry({ categoryId: PAYROLL }), names).sensitive).toBe(true);
  });

  it("categoria que não está no mapa conta como sensível", () => {
    const before = entry({ categoryId: UNKNOWN });
    expect(diffVersion(before, edited(before, { categoryId: INSUMOS }), names).sensitive).toBe(
      true,
    );
    expect(diffVersion(null, entry({ categoryId: UNKNOWN }), names).sensitive).toBe(true);
  });

  it("versão que não diz a categoria (registro ilegível) conta como sensível", () => {
    const whole = entry();
    const unreadable: VersionSnapshot = {};
    expect(diffVersion(null, unreadable, names).sensitive).toBe(true);
    expect(diffVersion(unreadable, whole, names).sensitive).toBe(true);
    expect(diffVersion(whole, unreadable, names).sensitive).toBe(true);
  });

  it("lançamento sem categoria não é sensível", () => {
    const before = entry({ categoryId: null });
    expect(diffVersion(null, before, names).sensitive).toBe(false);
    expect(diffVersion(before, edited(before, { description: "Outra" }), names).sensitive).toBe(
      false,
    );
  });
});

describe("parseVersionSnapshot", () => {
  it("lê o lançamento como foi gravado em entry_versions (JSON do domínio)", () => {
    const whole = entry({ flags: ["old_date"] });
    const raw: unknown = JSON.parse(JSON.stringify(whole));
    const snapshot = parseVersionSnapshot(raw);
    expect(snapshot).not.toBeNull();
    expect(diffVersion(snapshot, whole, names)).toEqual({ sensitive: false, changes: [] });
    expect(diffVersion(null, snapshot as VersionSnapshot, names)).toEqual(
      diffVersion(null, whole, names),
    );
  });

  it("nulo continua nulo (versão de criação não tem antes)", () => {
    expect(parseVersionSnapshot(null)).toBeNull();
    expect(parseVersionSnapshot(undefined)).toBeNull();
  });

  it("registro que não é um objeto vira retrato vazio, tratado como sensível", () => {
    for (const raw of ["texto", 42, [], true]) {
      const snapshot = parseVersionSnapshot(raw);
      expect(snapshot).toEqual({});
      expect(diffVersion(null, snapshot as VersionSnapshot, names).sensitive).toBe(true);
    }
  });

  it("campo com tipo errado é descartado sem derrubar os outros", () => {
    const snapshot = parseVersionSnapshot({
      description: "Carne",
      amountCents: "12345",
      categoryId: 7,
      flags: "old_date",
      occurredOn: "2026-11-05",
    });
    expect(snapshot).toEqual({ description: "Carne", occurredOn: "2026-11-05" });
  });

  it("valor em centavos que não é inteiro seguro é descartado (nunca float)", () => {
    expect(parseVersionSnapshot({ amountCents: 10.5, netCents: 2 ** 60 })).toEqual({});
  });

  it("versão antiga sem os campos novos: o que falta conta como vazio", () => {
    const old = parseVersionSnapshot({
      unitId: UNIT_1,
      type: "expense",
      occurredOn: "2026-11-05",
      description: "Carne",
      amountCents: 12_345,
      categoryId: INSUMOS,
    });
    const diff = diffVersion(null, old as VersionSnapshot, names);
    expect(diff.sensitive).toBe(false);
    expect(diff.changes.map((change) => change.field)).toEqual([
      "type",
      "occurredOn",
      "description",
      "amountCents",
      "category",
      "unit",
    ]);
  });
});
