import { createEntry, findSupplier, money } from "@app/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, withTenant } from "../src/client";
import { entryReader } from "../src/entry-reader";
import { loadCatalogIn } from "../src/entry-store";
import { insertPanelEntry, isUniqueViolation } from "../src/panel-entry-writer";
import { uuidv7 } from "../src/uuid";
import { startTestDatabase, type TestDatabase } from "./database";
import { createTenant, type TenantFixture } from "./fixtures";

let db: TestDatabase;
let a: TenantFixture;
let b: TenantFixture;

beforeAll(async () => {
  db = await startTestDatabase();
  a = await createTenant(db.admin, "Restaurante A");
  b = await createTenant(db.admin, "Restaurante B");
});

afterAll(async () => {
  await db?.stop();
});

const insertSupplier = (
  f: TenantFixture,
  name: string,
  extra: { document?: string | null; mergedIntoId?: string | null; aliases?: string[] } = {},
) => {
  const id = uuidv7();
  return db.admin
    .query(
      `insert into suppliers (id, tenant_id, name, document, merged_into_id, aliases)
       values ($1, $2, $3, $4, $5, $6)`,
      [
        id,
        f.tenantId,
        name,
        extra.document ?? null,
        extra.mergedIntoId ?? null,
        extra.aliases ?? [],
      ],
    )
    .then(() => id);
};

async function code(promise: Promise<unknown>): Promise<{ code?: string; constraint?: string }> {
  try {
    await promise;
  } catch (error) {
    return error as { code?: string; constraint?: string };
  }
  throw new Error("esperava falha");
}

describe("fornecedor: status, mesclagem e origem (RF10, migration 0025)", () => {
  it("fornecedor existente nasce ativo, sem origem e sem mesclagem", async () => {
    const r = await db.admin.query(
      "select status, origin, merged_into_id from suppliers where id = $1",
      [a.supplierId],
    );
    expect(r.rows).toEqual([{ status: "active", origin: null, merged_into_id: null }]);
  });

  it("documento repetido na empresa é recusado (23505); em outra empresa é aceito", async () => {
    await insertSupplier(a, "Doc 1", { document: "11222333000181" });
    const err = await code(insertSupplier(a, "Doc 2", { document: "11222333000181" }));
    expect(err.code).toBe("23505");
    expect(err.constraint).toBe("suppliers_tenant_document_unique");
    await expect(insertSupplier(b, "Doc 3", { document: "11222333000181" })).resolves.toBeTruthy();
  });

  it("documento do mesclado não conflita com o do destino", async () => {
    const target = await insertSupplier(a, "Destino Doc", { document: "99888777000155" });
    await expect(
      insertSupplier(a, "Origem Doc", { document: "99888777000155", mergedIntoId: target }),
    ).resolves.toBeTruthy();
  });

  it("dois fornecedores com o mesmo nome são aceitos se um está mesclado", async () => {
    const target = await insertSupplier(a, "Destino Nome");
    await insertSupplier(a, "Repetido", { mergedIntoId: target });
    await expect(insertSupplier(a, "  repetido ")).resolves.toBeTruthy();
    const err = await code(insertSupplier(a, "REPETIDO"));
    expect(err.constraint).toBe("suppliers_tenant_name_norm_unique");
  });

  it("recusa mais de 10 apelidos", async () => {
    const aliases = Array.from({ length: 11 }, (_, i) => `ap${i}`);
    const err = await code(insertSupplier(a, "Muitos apelidos", { aliases }));
    expect(err.constraint).toBe("suppliers_aliases_check");
    await expect(
      insertSupplier(a, "Dez apelidos", { aliases: aliases.slice(0, 10) }),
    ).resolves.toBeTruthy();
  });

  it("recusa status e origem fora da lista", async () => {
    const badStatus = await code(
      db.admin.query(
        "insert into suppliers (id, tenant_id, name, status) values ($1, $2, 'S1', 'x')",
        [uuidv7(), a.tenantId],
      ),
    );
    expect(badStatus.constraint).toBe("suppliers_status_check");
    const badOrigin = await code(
      db.admin.query(
        "insert into suppliers (id, tenant_id, name, origin) values ($1, $2, 'S2', 'x')",
        [uuidv7(), a.tenantId],
      ),
    );
    expect(badOrigin.constraint).toBe("suppliers_origin_check");
  });

  it("merged_into_id de outra empresa é recusado pela chave composta", async () => {
    const foreign = await insertSupplier(b, "Fornecedor de B");
    const err = await code(insertSupplier(a, "Aponta para B", { mergedIntoId: foreign }));
    expect(err.code).toBe("23503");
    expect(err.constraint).toBe("suppliers_merged_into_fk");
  });

  it("fornecedor novo do painel grava origin = 'panel'", async () => {
    const amount = money(1000);
    if (!amount.ok) throw new Error("centavos");
    const created = createEntry(
      {
        unitId: a.unitId,
        type: "expense",
        occurredOn: "2026-11-10",
        description: "Feira",
        quantity: null,
        quantityUnit: null,
        amountCents: amount.value,
        feePercentBp: 0,
        feeFixedCents: 0,
        categoryId: a.categoryId,
        supplierId: null,
        paymentMethodId: null,
        salesChannelId: null,
        inboundMessageId: null,
        flags: [],
      },
      { id: uuidv7(), tenantId: a.tenantId, actorId: a.userId, channel: "web", at: new Date() },
    );
    if (!created.ok) throw new Error("core recusou");
    const newId = uuidv7();
    await withTenant(createDatabase(db.app), a.tenantId, (tx) =>
      insertPanelEntry(tx, a.tenantId, created.value, {
        clientRequestId: uuidv7(),
        newSuppliers: [{ id: newId, name: "Novo do painel" }],
      }),
    );
    const r = await db.admin.query("select origin from suppliers where id = $1", [newId]);
    expect(r.rows).toEqual([{ origin: "panel" }]);
  });

  it("o catálogo do canal traz mergedIntoId e o nome antigo resolve para o destino", async () => {
    const target = await insertSupplier(a, "Atacadão Central", { aliases: ["Atacadão A"] });
    const source = await insertSupplier(a, "Atacadão A", { mergedIntoId: target });
    const catalog = await withTenant(createDatabase(db.app), a.tenantId, (tx) =>
      loadCatalogIn(tx, a.tenantId),
    );
    expect(catalog.suppliers.find((s) => s.id === source)?.mergedIntoId).toBe(target);
    expect(catalog.suppliers.find((s) => s.id === target)?.mergedIntoId).toBeNull();
    expect(findSupplier(catalog, "atacadao a")?.id).toBe(target);
  });

  it("as opções do painel escondem fornecedor mesclado", async () => {
    const target = await insertSupplier(a, "Destino Opções");
    const source = await insertSupplier(a, "Origem Opções", { mergedIntoId: target });
    const options = await withTenant(createDatabase(db.app), a.tenantId, (tx) =>
      entryReader.options(tx, {
        unitIds: "all",
        includeSensitive: true,
        ownerUserId: null,
      } as never),
    );
    const ids = options.suppliers.map((s) => s.id);
    expect(ids).toContain(target);
    expect(ids).not.toContain(source);
  });

  it("isUniqueViolation reconhece o índice de documento", async () => {
    await insertSupplier(b, "Dup B1", { document: "55666777000122" });
    try {
      await insertSupplier(b, "Dup B2", { document: "55666777000122" });
    } catch (error) {
      expect(isUniqueViolation(error, "suppliers_tenant_document_unique")).toBe(true);
      return;
    }
    throw new Error("esperava falha");
  });
});
