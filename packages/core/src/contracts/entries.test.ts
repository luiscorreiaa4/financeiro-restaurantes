import { describe, expect, expectTypeOf, it } from "vitest";
import {
  batchBodySchema,
  batchPreviewSchema,
  businessDateSchema,
  centsSchema,
  ENTRY_CHANGE_FIELDS,
  ENTRY_CURSOR_MAX,
  ENTRY_FIELD_NAMES,
  ENTRY_FILTER_LIST_MAX,
  ENTRY_FLAGS,
  ENTRY_SORTS,
  ENTRY_TYPES,
  entryAlreadySubmittedSchema,
  entryCreateBodySchema,
  entryDeleteBodySchema,
  entryDetailSchema,
  entryInvalidSchema,
  entryItemSchema,
  entryListQuerySchema,
  entryListResponseSchema,
  entryOptionsSchema,
  entryPatchSchema,
  entrySourceSchema,
  entryStaleSchema,
  entryTotalsSchema,
  entryUpdateBodySchema,
  entryVersionSchema,
  ORIGIN_CHANNELS,
  QUANTITY_MAX,
  QUANTITY_UNIT_MAX,
  SUPPLIER_NAME_MAX,
  trashQuerySchema,
  trashResponseSchema,
  VERSION_ACTIONS,
} from "./entries";
import type { EntryListQuery, EntryListQueryInput } from "./index";
import * as contracts from "./index";

const ID_A = "019a7c2e-0000-7000-8000-000000000001";
const ID_B = "019a7c2e-0000-7000-8000-000000000002";
const ID_C = "019a7c2e-0000-7000-8000-000000000003";

const period = { from: "2026-11-01", to: "2026-11-30" };

const item = {
  id: ID_A,
  version: 2,
  type: "revenue",
  occurredOn: "2026-11-12",
  paidOn: "2026-11-13",
  description: "Vendas do almoço",
  quantity: null,
  quantityUnit: null,
  orders: 42,
  amountCents: 123456,
  feeCents: 1234,
  netCents: 122222,
  category: { id: ID_B, name: "Vendas" },
  supplier: null,
  paymentMethod: { id: ID_B, name: "Pix" },
  salesChannel: { id: ID_C, name: "Salão" },
  unit: { id: ID_B, name: "Matriz" },
  createdBy: { id: ID_C, name: "Ana" },
  originChannel: "whatsapp",
  flags: ["old_date"],
  createdAt: "2026-11-13T12:34:56.123456Z",
  canEdit: true,
  canDelete: true,
  canRestore: false,
};

const version = {
  version: 2,
  action: "update",
  channel: "web",
  changedBy: { id: ID_C, name: "Ana" },
  changedAt: "2026-11-13T15:00:00Z",
  restricted: false,
  changes: [{ field: "amountCents", before: 100000, after: 123456 }],
};

const detail = {
  ...item,
  feePercentBp: 100,
  feeFixedCents: 0,
  updatedAt: "2026-11-13T15:00:00Z",
  deleted: null,
  versions: [version],
};

const deleted = {
  at: "2026-11-13T16:00:00Z",
  by: { id: ID_C, name: "Ana" },
  reason: null,
  restorableUntil: "2026-12-13",
};

describe("valores básicos do contrato", () => {
  it("aceita data de negócio AAAA-MM-DD que existe e recusa a que não existe", () => {
    expect(businessDateSchema.safeParse("2026-11-13").success).toBe(true);
    expect(businessDateSchema.safeParse("2028-02-29").success).toBe(true);
    expect(businessDateSchema.safeParse("2026-02-30").success).toBe(false);
    expect(businessDateSchema.safeParse("2027-02-29").success).toBe(false);
    expect(businessDateSchema.safeParse("13/11/2026").success).toBe(false);
    expect(businessDateSchema.safeParse("2026-11-13T00:00:00Z").success).toBe(false);
  });

  it("centavos são inteiros seguros a partir de zero, nunca fração", () => {
    expect(centsSchema.safeParse(0).success).toBe(true);
    expect(centsSchema.safeParse(123456).success).toBe(true);
    expect(centsSchema.safeParse(-1).success).toBe(false);
    expect(centsSchema.safeParse(12.5).success).toBe(false);
    expect(centsSchema.safeParse(Number.MAX_SAFE_INTEGER + 1).success).toBe(false);
    expect(centsSchema.safeParse("100").success).toBe(false);
  });

  it("usa os nomes do domínio para tipos, sinais, canais, ações e ordenações", () => {
    expect(ENTRY_TYPES).toEqual(["expense", "revenue"]);
    expect(ENTRY_FLAGS).toEqual([
      "category_to_review",
      "channel_to_review",
      "possible_duplicate",
      "old_date",
    ]);
    expect(ORIGIN_CHANNELS).toEqual(["whatsapp", "web", "import", "email", "system"]);
    expect(VERSION_ACTIONS).toEqual(["create", "update", "delete", "restore"]);
    expect(ENTRY_SORTS).toEqual(["created_at", "occurred_on", "paid_on", "amount"]);
  });

  it("o índice do contrato reexporta os schemas de lançamentos e de período", () => {
    expect(contracts.entryListQuerySchema).toBe(entryListQuerySchema);
    expect(contracts.entryItemSchema).toBe(entryItemSchema);
    expect(typeof contracts.resolvePeriod).toBe("function");
    expect(contracts.PERIOD_PRESETS).toContain("current_month");
  });
});

describe("consulta da lista de lançamentos (RF22)", () => {
  it("aplica os padrões: criação decrescente e 50 por página", () => {
    expect(entryListQuerySchema.parse(period)).toEqual({
      ...period,
      sort: "created_at",
      dir: "desc",
      limit: 50,
    });
  });

  it("exige o período", () => {
    expect(entryListQuerySchema.safeParse({ from: "2026-11-01" }).success).toBe(false);
    expect(entryListQuerySchema.safeParse({ to: "2026-11-30" }).success).toBe(false);
    expect(entryListQuerySchema.safeParse({}).success).toBe(false);
  });

  it("recusa período com início depois do fim e aceita um único dia", () => {
    expect(entryListQuerySchema.safeParse({ from: "2026-11-30", to: "2026-11-01" }).success).toBe(
      false,
    );
    expect(entryListQuerySchema.safeParse({ from: "2026-11-13", to: "2026-11-13" }).success).toBe(
      true,
    );
  });

  it("aceita exatamente 24 meses e recusa 24 meses e 1 dia", () => {
    expect(entryListQuerySchema.safeParse({ from: "2024-11-13", to: "2026-11-13" }).success).toBe(
      true,
    );
    expect(entryListQuerySchema.safeParse({ from: "2024-11-13", to: "2026-11-14" }).success).toBe(
      false,
    );
  });

  it("recusa data que não existe no período", () => {
    expect(entryListQuerySchema.safeParse({ from: "2026-02-30", to: "2026-03-01" }).success).toBe(
      false,
    );
  });

  it("lê o limite que chega como texto na query string", () => {
    expect(entryListQuerySchema.parse({ ...period, limit: "25" }).limit).toBe(25);
    expect(entryListQuerySchema.parse({ ...period, limit: "100" }).limit).toBe(100);
    expect(entryListQuerySchema.parse({ ...period, limit: "1" }).limit).toBe(1);
  });

  it("recusa limite fora de 1 a 100, quebrado ou que não é número", () => {
    for (const limit of ["101", "0", "-1", "2.5", "abc", "", 101]) {
      expect(entryListQuerySchema.safeParse({ ...period, limit }).success).toBe(false);
    }
  });

  it("lista com valor repetido na query string chega como lista", () => {
    const query = entryListQuerySchema.parse({
      ...period,
      unitIds: [ID_A, ID_B],
      categoryIds: [ID_C, ID_A],
      flags: ["old_date", "possible_duplicate"],
    });
    expect(query.unitIds).toEqual([ID_A, ID_B]);
    expect(query.categoryIds).toEqual([ID_C, ID_A]);
    expect(query.flags).toEqual(["old_date", "possible_duplicate"]);
  });

  it("valor único de lista vira lista de um item", () => {
    const query = entryListQuerySchema.parse({
      ...period,
      unitIds: ID_A,
      categoryIds: ID_B,
      flags: "category_to_review",
    });
    expect(query.unitIds).toEqual([ID_A]);
    expect(query.categoryIds).toEqual([ID_B]);
    expect(query.flags).toEqual(["category_to_review"]);
  });

  it("recusa identificador que não é UUID e sinal desconhecido", () => {
    expect(entryListQuerySchema.safeParse({ ...period, unitIds: "abc" }).success).toBe(false);
    expect(entryListQuerySchema.safeParse({ ...period, unitIds: [ID_A, "abc"] }).success).toBe(
      false,
    );
    expect(entryListQuerySchema.safeParse({ ...period, supplierId: "1" }).success).toBe(false);
    expect(entryListQuerySchema.safeParse({ ...period, flags: "urgente" }).success).toBe(false);
  });

  it("aceita todos os filtros do RF22 juntos", () => {
    const query = entryListQuerySchema.parse({
      ...period,
      type: "expense",
      supplierId: ID_A,
      paymentMethodId: ID_B,
      salesChannelId: ID_C,
      createdBy: ID_A,
      originChannel: "whatsapp",
      q: "  450,00  ",
      sort: "amount",
      dir: "asc",
      cursor: "eyJ2IjoiMSJ9",
    });
    expect(query).toMatchObject({
      type: "expense",
      supplierId: ID_A,
      paymentMethodId: ID_B,
      salesChannelId: ID_C,
      createdBy: ID_A,
      originChannel: "whatsapp",
      q: "450,00",
      sort: "amount",
      dir: "asc",
      cursor: "eyJ2IjoiMSJ9",
    });
  });

  it("recusa tipo, ordenação, sentido e canal de origem desconhecidos", () => {
    expect(entryListQuerySchema.safeParse({ ...period, type: "all" }).success).toBe(false);
    expect(entryListQuerySchema.safeParse({ ...period, sort: "description" }).success).toBe(false);
    expect(entryListQuerySchema.safeParse({ ...period, dir: "up" }).success).toBe(false);
    expect(entryListQuerySchema.safeParse({ ...period, originChannel: "sms" }).success).toBe(false);
  });

  it("busca livre vai até 100 caracteres", () => {
    expect(entryListQuerySchema.safeParse({ ...period, q: "a".repeat(100) }).success).toBe(true);
    expect(entryListQuerySchema.safeParse({ ...period, q: "a".repeat(101) }).success).toBe(false);
  });

  it("parâmetro escalar repetido na query string é recusado", () => {
    expect(entryListQuerySchema.safeParse({ ...period, q: ["a", "b"] }).success).toBe(false);
    expect(
      entryListQuerySchema.safeParse({ ...period, from: ["2026-11-01", "2026-11-02"] }).success,
    ).toBe(false);
  });
});

describe("respostas de leitura de lançamentos", () => {
  it("aceita um lançamento da lista com todos os campos", () => {
    expect(entryItemSchema.parse(item)).toEqual(item);
  });

  it("recusa lançamento com valor quebrado, negativo ou em texto", () => {
    expect(entryItemSchema.safeParse({ ...item, amountCents: 1234.56 }).success).toBe(false);
    expect(entryItemSchema.safeParse({ ...item, netCents: -1 }).success).toBe(false);
    expect(entryItemSchema.safeParse({ ...item, amountCents: "123456" }).success).toBe(false);
  });

  it("aceita lançamento sem categoria na lista, no detalhe e na lixeira", () => {
    expect(entryItemSchema.parse({ ...item, category: null }).category).toBeNull();
    expect(entryDetailSchema.parse({ ...detail, category: null }).category).toBeNull();
    expect(
      trashResponseSchema.safeParse({
        items: [{ ...item, category: null, deleted }],
        nextCursor: null,
      }).success,
    ).toBe(true);
  });

  it("origem sem mensagem não tem instante de envio", () => {
    const source = {
      channel: "web",
      kind: "none",
      text: null,
      transcription: null,
      accessKey: null,
      sentBy: null,
      sentAt: null,
      restricted: false,
      mediaAvailable: false,
    };
    expect(entrySourceSchema.parse(source)).toEqual(source);
    expect(entrySourceSchema.safeParse({ ...source, sentAt: "ontem" }).success).toBe(false);
  });

  it("os limites escolhidos pelo contrato são constantes nomeadas", () => {
    expect(SUPPLIER_NAME_MAX).toBe(120);
    expect(QUANTITY_UNIT_MAX).toBe(20);
    expect(ENTRY_CURSOR_MAX).toBe(512);
    expect(ENTRY_FILTER_LIST_MAX).toBe(100);
    expect(entryPatchSchema.safeParse({ supplier: { name: "a".repeat(121) } }).success).toBe(false);
    expect(entryPatchSchema.safeParse({ quantityUnit: "a".repeat(21) }).success).toBe(false);
  });

  it("recusa lançamento sem unidade ou sem as permissões de ação", () => {
    expect(entryItemSchema.safeParse({ ...item, unit: null }).success).toBe(false);
    const { canRestore: _canRestore, ...withoutAction } = item;
    expect(entryItemSchema.safeParse(withoutAction).success).toBe(false);
  });

  it("recusa data de pagamento vazia: ela nunca é nula", () => {
    expect(entryItemSchema.safeParse({ ...item, paidOn: null }).success).toBe(false);
  });

  it("a página da lista traz os itens e o cursor da próxima, nulo no fim", () => {
    expect(entryListResponseSchema.parse({ items: [item], nextCursor: "abc" }).nextCursor).toBe(
      "abc",
    );
    expect(entryListResponseSchema.parse({ items: [], nextCursor: null }).items).toEqual([]);
    expect(entryListResponseSchema.safeParse({ items: [] }).success).toBe(false);
  });

  it("totais aceitam resultado negativo, mas não receitas ou despesas negativas", () => {
    const totals = {
      revenueCents: 1000,
      expenseCents: 2500,
      resultCents: -1500,
      count: 3,
      hasRestricted: true,
    };
    expect(entryTotalsSchema.parse(totals)).toEqual(totals);
    expect(entryTotalsSchema.safeParse({ ...totals, expenseCents: -1 }).success).toBe(false);
    expect(entryTotalsSchema.safeParse({ ...totals, resultCents: -1.5 }).success).toBe(false);
    expect(entryTotalsSchema.safeParse({ ...totals, count: -1 }).success).toBe(false);
  });

  it("opções de filtro trazem categorias com tipo, pai e exigência de quantidade", () => {
    const options = {
      categories: [
        { id: ID_A, name: "Insumos", kind: "expense", parentId: null, requiresQuantity: false },
        { id: ID_B, name: "Carnes", kind: "expense", parentId: ID_A, requiresQuantity: true },
      ],
      suppliers: [{ id: ID_A, name: "Atacadão" }],
      paymentMethods: [{ id: ID_A, name: "Pix" }],
      salesChannels: [{ id: ID_A, name: "Salão" }],
      units: [{ id: ID_A, name: "Matriz" }],
      members: [],
    };
    expect(entryOptionsSchema.parse(options)).toEqual(options);
    expect(
      entryOptionsSchema.safeParse({
        ...options,
        categories: [
          { id: ID_A, name: "X", kind: "outro", parentId: null, requiresQuantity: false },
        ],
      }).success,
    ).toBe(false);
  });

  it("versão do histórico lista os campos alterados com antes e depois", () => {
    expect(entryVersionSchema.parse(version)).toEqual(version);
    const textual = {
      ...version,
      changes: [
        { field: "category", before: "Insumos", after: "Carnes" },
        { field: "supplier", before: null, after: "Atacadão" },
      ],
    };
    expect(entryVersionSchema.parse(textual)).toEqual(textual);
  });

  it("recusa no histórico um campo fora da lista e um valor que não é texto, número ou nulo", () => {
    expect(
      entryVersionSchema.safeParse({
        ...version,
        changes: [{ field: "tenantId", before: "a", after: "b" }],
      }).success,
    ).toBe(false);
    expect(
      entryVersionSchema.safeParse({
        ...version,
        changes: [{ field: "flags", before: ["old_date"], after: null }],
      }).success,
    ).toBe(false);
  });

  it("os campos do histórico cobrem os editáveis do RF23, as taxas, os sinais e o motivo", () => {
    expect(ENTRY_CHANGE_FIELDS).toEqual([
      "type",
      "occurredOn",
      "paidOn",
      "description",
      "quantity",
      "quantityUnit",
      "orders",
      "amountCents",
      "feePercentBp",
      "feeFixedCents",
      "feeCents",
      "netCents",
      "category",
      "supplier",
      "paymentMethod",
      "salesChannel",
      "unit",
      "flags",
      "deleteReason",
    ]);
  });

  it("versão restrita vem sem campos", () => {
    const restricted = { ...version, restricted: true, changes: [] };
    expect(entryVersionSchema.parse(restricted)).toEqual(restricted);
  });

  it("detalhe é o item mais taxas copiadas, atualização, lixeira e versões", () => {
    expect(entryDetailSchema.parse(detail)).toEqual(detail);
    const inTrash = { ...detail, deleted: { ...deleted, reason: "Lançado em dobro" } };
    expect(entryDetailSchema.parse(inTrash)).toEqual(inTrash);
    expect(entryDetailSchema.safeParse(item).success).toBe(false);
    expect(entryDetailSchema.safeParse({ ...detail, feePercentBp: 10001 }).success).toBe(false);
  });

  it("origem de texto traz o texto, quem enviou e quando, sem mídia", () => {
    const source = {
      channel: "whatsapp",
      kind: "text",
      text: "<b>gastei 450 no mercado</b>",
      transcription: null,
      accessKey: null,
      sentBy: { id: ID_A, name: "Ana" },
      sentAt: "2026-11-13T12:00:00Z",
      restricted: false,
      mediaAvailable: false,
    };
    expect(entrySourceSchema.parse(source)).toEqual(source);
    expect(entrySourceSchema.safeParse({ ...source, kind: "video" }).success).toBe(false);
  });

  it("origem de foto de nota traz a chave de acesso, que tem 44 dígitos", () => {
    const source = {
      channel: "whatsapp",
      kind: "image",
      text: null,
      transcription: null,
      accessKey: "3".repeat(44),
      sentBy: null,
      sentAt: "2026-11-13T12:00:00Z",
      restricted: false,
      mediaAvailable: false,
    };
    expect(entrySourceSchema.parse(source)).toEqual(source);
    expect(entrySourceSchema.safeParse({ ...source, accessKey: "123" }).success).toBe(false);
  });
});

describe("edição de lançamento (RF23)", () => {
  it("aceita cada campo editável sozinho", () => {
    const patches = [
      { type: "expense" },
      { occurredOn: "2026-11-10" },
      { paidOn: "2026-11-20" },
      { description: "Compra de carne" },
      { quantity: 2.5 },
      { quantity: null },
      { quantityUnit: "KG" },
      { quantityUnit: null },
      { amountCents: 123456 },
      { orders: 10 },
      { orders: null },
      { categoryId: ID_A },
      { supplier: { id: ID_A } },
      { supplier: { name: "Atacadão" } },
      { supplier: null },
      { paymentMethodId: ID_A },
      { paymentMethodId: null },
      { salesChannelId: ID_A },
      { salesChannelId: null },
      { unitId: ID_A },
    ];
    for (const patch of patches) {
      expect(entryPatchSchema.safeParse(patch).success, JSON.stringify(patch)).toBe(true);
    }
  });

  it("recusa valor zero, negativo ou quebrado", () => {
    for (const amountCents of [0, -100, 10.5, "100"]) {
      expect(entryPatchSchema.safeParse({ amountCents }).success).toBe(false);
    }
  });

  it("descrição tem de 1 a 200 caracteres, sem contar espaços das pontas", () => {
    expect(entryPatchSchema.parse({ description: "  Gás  " }).description).toBe("Gás");
    expect(entryPatchSchema.safeParse({ description: "a".repeat(200) }).success).toBe(true);
    expect(entryPatchSchema.safeParse({ description: "a".repeat(201) }).success).toBe(false);
    expect(entryPatchSchema.safeParse({ description: "   " }).success).toBe(false);
  });

  it("taxa e líquido não são editáveis: campo fora da lista é recusado", () => {
    expect(entryPatchSchema.safeParse({ feeCents: 10 }).success).toBe(false);
    expect(entryPatchSchema.safeParse({ netCents: 10 }).success).toBe(false);
    expect(entryPatchSchema.safeParse({ feePercentBp: 100 }).success).toBe(false);
    expect(entryPatchSchema.safeParse({ flags: [] }).success).toBe(false);
  });

  it("fornecedor é um existente, um nome novo ou vazio, nunca os dois", () => {
    expect(entryPatchSchema.safeParse({ supplier: { id: ID_A, name: "X" } }).success).toBe(false);
    expect(entryPatchSchema.safeParse({ supplier: { name: "  " } }).success).toBe(false);
    expect(entryPatchSchema.safeParse({ supplier: { id: "abc" } }).success).toBe(false);
    expect(entryPatchSchema.safeParse({ supplier: {} }).success).toBe(false);
  });

  it("recusa categoria e unidade vazias, quantidade e pedidos que não são positivos", () => {
    expect(entryPatchSchema.safeParse({ categoryId: null }).success).toBe(false);
    expect(entryPatchSchema.safeParse({ unitId: null }).success).toBe(false);
    expect(entryPatchSchema.safeParse({ quantity: 0 }).success).toBe(false);
    expect(entryPatchSchema.safeParse({ orders: 0 }).success).toBe(false);
    expect(entryPatchSchema.safeParse({ orders: 1.5 }).success).toBe(false);
  });

  it("recusa edição vazia sem marcar como revisado", () => {
    expect(entryUpdateBodySchema.safeParse({ expectedVersion: 1, patch: {} }).success).toBe(false);
    expect(
      entryUpdateBodySchema.safeParse({ expectedVersion: 1, patch: {}, markReviewed: false })
        .success,
    ).toBe(false);
    expect(entryUpdateBodySchema.safeParse({ expectedVersion: 1 }).success).toBe(false);
  });

  it("aceita só marcar como revisado, só editar ou os dois", () => {
    expect(entryUpdateBodySchema.parse({ expectedVersion: 3, markReviewed: true })).toEqual({
      expectedVersion: 3,
      patch: {},
      markReviewed: true,
    });
    expect(
      entryUpdateBodySchema.parse({ expectedVersion: 3, patch: { amountCents: 500 } }),
    ).toEqual({ expectedVersion: 3, patch: { amountCents: 500 }, markReviewed: false });
    expect(
      entryUpdateBodySchema.safeParse({
        expectedVersion: 3,
        patch: { description: "Gás" },
        markReviewed: true,
      }).success,
    ).toBe(true);
  });

  it("exige a versão que o usuário abriu (RF23.Obs2)", () => {
    expect(entryUpdateBodySchema.safeParse({ patch: { amountCents: 500 } }).success).toBe(false);
    expect(
      entryUpdateBodySchema.safeParse({ expectedVersion: 0, patch: { amountCents: 500 } }).success,
    ).toBe(false);
  });

  it("conflito de edição devolve o código e o detalhe atual", () => {
    expect(entryStaleSchema.parse({ code: "entry_stale", current: detail }).current.version).toBe(
      2,
    );
    expect(entryStaleSchema.safeParse({ code: "context_changed", current: detail }).success).toBe(
      false,
    );
  });
});

describe("exclusão, lote e lixeira (RF24)", () => {
  it("motivo da exclusão é opcional e vai até 200 caracteres", () => {
    expect(entryDeleteBodySchema.parse({})).toEqual({});
    expect(entryDeleteBodySchema.parse({ reason: "  Duplicado  " })).toEqual({
      reason: "Duplicado",
    });
    expect(entryDeleteBodySchema.safeParse({ reason: "a".repeat(200) }).success).toBe(true);
    expect(entryDeleteBodySchema.safeParse({ reason: "a".repeat(201) }).success).toBe(false);
  });

  it("lote aceita de 1 a 100 lançamentos", () => {
    const ids = Array.from(
      { length: 101 },
      (_, index) => `019a7c2e-0000-7000-8000-${String(index).padStart(12, "0")}`,
    );
    expect(batchBodySchema.safeParse({ ids: ids.slice(0, 100) }).success).toBe(true);
    expect(batchBodySchema.safeParse({ ids: [ID_A], reason: "Teste" }).success).toBe(true);
    expect(batchBodySchema.safeParse({ ids }).success).toBe(false);
    expect(batchBodySchema.safeParse({ ids: [] }).success).toBe(false);
  });

  it("lote recusa lançamento repetido, mesmo com maiúsculas diferentes", () => {
    expect(batchBodySchema.safeParse({ ids: [ID_A, ID_B, ID_A] }).success).toBe(false);
    expect(batchBodySchema.safeParse({ ids: [ID_A, ID_A.toUpperCase()] }).success).toBe(false);
  });

  it("lote recusa motivo acima de 200 caracteres e id que não é UUID", () => {
    expect(batchBodySchema.safeParse({ ids: [ID_A], reason: "a".repeat(201) }).success).toBe(false);
    expect(batchBodySchema.safeParse({ ids: ["abc"] }).success).toBe(false);
  });

  it("pré-visualização do lote traz quantidade e soma em centavos", () => {
    expect(batchPreviewSchema.parse({ count: 3, totalCents: 4500 })).toEqual({
      count: 3,
      totalCents: 4500,
    });
    expect(batchPreviewSchema.safeParse({ count: 3, totalCents: 45.5 }).success).toBe(false);
  });

  it("consulta da lixeira exige o período de exclusão e aplica 50 por página", () => {
    const trash = { deletedFrom: "2026-10-15", deletedTo: "2026-11-13" };
    expect(trashQuerySchema.parse(trash)).toEqual({ ...trash, limit: 50 });
    expect(trashQuerySchema.safeParse({ deletedFrom: "2026-10-15" }).success).toBe(false);
    expect(
      trashQuerySchema.safeParse({ deletedFrom: "2026-11-13", deletedTo: "2026-10-15" }).success,
    ).toBe(false);
  });

  it("consulta da lixeira lê unidade única, quem excluiu e limite da query string", () => {
    const query = trashQuerySchema.parse({
      deletedFrom: "2026-10-15",
      deletedTo: "2026-11-13",
      unitIds: ID_A,
      deletedBy: ID_B,
      cursor: "abc",
      limit: "20",
    });
    expect(query).toMatchObject({ unitIds: [ID_A], deletedBy: ID_B, cursor: "abc", limit: 20 });
    expect(
      trashQuerySchema.safeParse({
        deletedFrom: "2026-10-15",
        deletedTo: "2026-11-13",
        limit: "101",
      }).success,
    ).toBe(false);
  });

  it("item da lixeira sempre traz os dados da exclusão", () => {
    const trashed = { ...item, canEdit: false, canDelete: false, canRestore: true, deleted };
    expect(trashResponseSchema.parse({ items: [trashed], nextCursor: null }).items).toEqual([
      trashed,
    ]);
    expect(trashResponseSchema.safeParse({ items: [item], nextCursor: null }).success).toBe(false);
    expect(
      trashResponseSchema.safeParse({ items: [{ ...item, deleted: null }], nextCursor: null })
        .success,
    ).toBe(false);
  });
});

describe("barreira contra vazamento de dado restrito", () => {
  it("versão restrita com campos alterados é recusada", () => {
    expect(entryVersionSchema.safeParse({ ...version, restricted: true }).success).toBe(false);
    expect(
      entryVersionSchema.safeParse({ ...version, restricted: true, changes: [] }).success,
    ).toBe(true);
    expect(
      entryDetailSchema.safeParse({ ...detail, versions: [{ ...version, restricted: true }] })
        .success,
    ).toBe(false);
  });

  it("origem restrita com texto, transcrição ou chave de acesso é recusada", () => {
    const restrictedSource = {
      channel: "whatsapp",
      kind: "audio",
      text: null,
      transcription: null,
      accessKey: null,
      sentBy: { id: ID_A, name: "Ana" },
      sentAt: "2026-11-13T12:00:00Z",
      restricted: true,
      mediaAvailable: false,
    };
    expect(entrySourceSchema.safeParse(restrictedSource).success).toBe(true);
    expect(entrySourceSchema.safeParse({ ...restrictedSource, text: "salário" }).success).toBe(
      false,
    );
    expect(
      entrySourceSchema.safeParse({ ...restrictedSource, transcription: "salário" }).success,
    ).toBe(false);
    expect(
      entrySourceSchema.safeParse({ ...restrictedSource, accessKey: "3".repeat(44) }).success,
    ).toBe(false);
    expect(
      entrySourceSchema.safeParse({ ...restrictedSource, restricted: false, text: "gás 120" })
        .success,
    ).toBe(true);
  });
});

describe("ajustes da revisão do contrato", () => {
  it("edição só com campos indefinidos conta como vazia", () => {
    expect(
      entryUpdateBodySchema.safeParse({
        expectedVersion: 1,
        patch: { description: undefined },
        markReviewed: false,
      }).success,
    ).toBe(false);
    expect(
      entryUpdateBodySchema.safeParse({
        expectedVersion: 1,
        patch: { description: undefined, supplier: null },
      }).success,
    ).toBe(true);
    expect(
      entryUpdateBodySchema.safeParse({
        expectedVersion: 1,
        patch: { description: undefined },
        markReviewed: true,
      }).success,
    ).toBe(true);
  });

  it("a entrada da consulta, montada pela tela, passa no schema e vira a consulta validada", () => {
    const minimal: EntryListQueryInput = { from: "2026-11-01", to: "2026-11-30" };
    const full: EntryListQueryInput = {
      ...minimal,
      type: "revenue",
      unitIds: [ID_A],
      categoryIds: [ID_B],
      supplierId: ID_A,
      paymentMethodId: ID_B,
      salesChannelId: ID_C,
      createdBy: ID_A,
      originChannel: "web",
      flags: ["old_date"],
      q: "gás",
      sort: "paid_on",
      dir: "asc",
      cursor: "abc",
      limit: 20,
    };
    expect(entryListQuerySchema.parse(minimal).limit).toBe(50);
    expect(entryListQuerySchema.parse(full)).toEqual(full);
    expectTypeOf<EntryListQuery>().toExtend<EntryListQueryInput>();
    expectTypeOf<EntryListQueryInput["unitIds"]>().toEqualTypeOf<string[] | undefined>();
    expectTypeOf<EntryListQueryInput["limit"]>().toEqualTypeOf<number | undefined>();
    expectTypeOf<Required<EntryListQueryInput>>().toEqualTypeOf<Required<EntryListQuery>>();
  });
});

describe("entryCreateBodySchema (RF26)", () => {
  const base = {
    clientRequestId: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
    type: "expense",
    occurredOn: "2026-11-16",
    description: "Tomate",
    amountCents: 1500,
    categoryId: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a01",
    unitId: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a02",
  };
  const channelId = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a03";

  it("aceita o corpo mínimo e apara a descrição", () => {
    const parsed = entryCreateBodySchema.parse({ ...base, description: "  Tomate  " });
    expect(parsed.description).toBe("Tomate");
  });

  it("recusa corpo sem valor, com valor zero ou fracionado", () => {
    const { amountCents: _omit, ...semValor } = base;
    expect(entryCreateBodySchema.safeParse(semValor).success).toBe(false);
    expect(entryCreateBodySchema.safeParse({ ...base, amountCents: 0 }).success).toBe(false);
    expect(entryCreateBodySchema.safeParse({ ...base, amountCents: 1.5 }).success).toBe(false);
  });

  it("aceita o teto de R$ 100 milhões e recusa um centavo acima (F3c-3)", () => {
    expect(entryCreateBodySchema.safeParse({ ...base, amountCents: 10_000_000_000 }).success).toBe(
      true,
    );
    expect(entryCreateBodySchema.safeParse({ ...base, amountCents: 10_000_000_001 }).success).toBe(
      false,
    );
    expect(entryPatchSchema.safeParse({ amountCents: 10_000_000_000 }).success).toBe(true);
    expect(entryPatchSchema.safeParse({ amountCents: 10_000_000_001 }).success).toBe(false);
  });

  it("recusa chave de tentativa que não é uuid e chave extra", () => {
    expect(entryCreateBodySchema.safeParse({ ...base, clientRequestId: "abc" }).success).toBe(
      false,
    );
    expect(entryCreateBodySchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
  });

  it("despesa não leva canal nem pedidos", () => {
    expect(entryCreateBodySchema.safeParse({ ...base, salesChannelId: channelId }).success).toBe(
      false,
    );
    expect(entryCreateBodySchema.safeParse({ ...base, orders: 3 }).success).toBe(false);
  });

  it("receita exige canal e aceita pedidos", () => {
    const receita = { ...base, type: "revenue" };
    expect(entryCreateBodySchema.safeParse(receita).success).toBe(false);
    expect(
      entryCreateBodySchema.safeParse({ ...receita, salesChannelId: channelId, orders: 3 }).success,
    ).toBe(true);
  });

  it("quantidade e unidade de medida andam juntas", () => {
    expect(entryCreateBodySchema.safeParse({ ...base, quantity: 2 }).success).toBe(false);
    expect(entryCreateBodySchema.safeParse({ ...base, quantityUnit: "KG" }).success).toBe(false);
    expect(
      entryCreateBodySchema.safeParse({ ...base, quantity: 2.5, quantityUnit: "KG" }).success,
    ).toBe(true);
  });

  it("recusa unidade de medida fora da lista e quantidade acima do teto", () => {
    expect(
      entryCreateBodySchema.safeParse({ ...base, quantity: 1, quantityUnit: "XX" }).success,
    ).toBe(false);
    expect(
      entryCreateBodySchema.safeParse({
        ...base,
        quantity: QUANTITY_MAX + 1,
        quantityUnit: "KG",
      }).success,
    ).toBe(false);
    expect(
      entryCreateBodySchema.safeParse({ ...base, quantity: QUANTITY_MAX, quantityUnit: "KG" })
        .success,
    ).toBe(true);
  });

  it("pedidos acima do inteiro do banco são recusados, na criação e na edição (nunca 500)", () => {
    expect(
      entryCreateBodySchema.safeParse({
        ...base,
        type: "revenue",
        salesChannelId: channelId,
        orders: 2_147_483_647,
      }).success,
    ).toBe(true);
    expect(
      entryCreateBodySchema.safeParse({
        ...base,
        type: "revenue",
        salesChannelId: channelId,
        orders: 2_147_483_648,
      }).success,
    ).toBe(false);
    expect(entryPatchSchema.safeParse({ orders: 2_147_483_647 }).success).toBe(true);
    expect(entryPatchSchema.safeParse({ orders: 2_147_483_648 }).success).toBe(false);
  });

  it("fornecedor: id, nome de 2 a 120 caracteres ou nulo", () => {
    const id = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a04";
    expect(entryCreateBodySchema.safeParse({ ...base, supplier: { id } }).success).toBe(true);
    expect(entryCreateBodySchema.safeParse({ ...base, supplier: null }).success).toBe(true);
    expect(entryCreateBodySchema.safeParse({ ...base, supplier: { name: "Ab" } }).success).toBe(
      true,
    );
    expect(entryCreateBodySchema.safeParse({ ...base, supplier: { name: " A " } }).success).toBe(
      false,
    );
  });
});

describe("entryPatchSchema, endurecido pela F3c", () => {
  it("recusa unidade de medida fora da lista, nome de fornecedor de 1 caractere e quantidade acima do teto", () => {
    expect(entryPatchSchema.safeParse({ quantityUnit: "XX" }).success).toBe(false);
    expect(entryPatchSchema.safeParse({ supplier: { name: "A" } }).success).toBe(false);
    expect(entryPatchSchema.safeParse({ quantity: QUANTITY_MAX + 1 }).success).toBe(false);
    expect(entryPatchSchema.safeParse({ quantity: 2, quantityUnit: "KG" }).success).toBe(true);
  });
});

describe("respostas de erro da criação", () => {
  it("entryInvalidSchema aceita campo da lista fechada e recusa outro", () => {
    expect(
      entryInvalidSchema.safeParse({ code: "invalid_entry", reason: "x", field: "amountCents" })
        .success,
    ).toBe(true);
    expect(entryInvalidSchema.safeParse({ code: "invalid_entry", reason: "x" }).success).toBe(true);
    expect(
      entryInvalidSchema.safeParse({ code: "invalid_entry", reason: "x", field: "foo" }).success,
    ).toBe(false);
    expect(ENTRY_FIELD_NAMES).toContain("paidOn");
  });

  it("entryAlreadySubmittedSchema só leva o código", () => {
    expect(entryAlreadySubmittedSchema.safeParse({ code: "already_submitted" }).success).toBe(true);
  });

  it("entryOptionsSchema aceita active, canal padrão e fuso opcionais", () => {
    const id = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a05";
    const parsed = entryOptionsSchema.parse({
      categories: [
        { id, name: "A", kind: "expense", parentId: null, requiresQuantity: false, active: false },
      ],
      suppliers: [],
      paymentMethods: [{ id, name: "Pix", active: true }],
      salesChannels: [{ id, name: "Salão", active: true }],
      units: [
        {
          id,
          name: "Centro",
          active: true,
          defaultSalesChannelId: id,
          timezone: "America/Sao_Paulo",
        },
      ],
      members: [],
    });
    expect(parsed.units[0]?.timezone).toBe("America/Sao_Paulo");
  });
});
