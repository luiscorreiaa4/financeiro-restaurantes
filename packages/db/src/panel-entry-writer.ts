import type { EntryChange } from "@app/core";
import { and, eq } from "drizzle-orm";
import { entries, entryVersions, suppliers } from "../schema";
import type { Transaction } from "./client";
import { entryValues, versionValues } from "./entry-store";

/**
 * Grava um lançamento criado pelo painel (RF26): fornecedor novo, `entries` com posição 0 e a
 * chave de tentativa, e a versão 1 com canal `web`. Roda na transação do chamador. A chave só
 * existe aqui: não entra no `Entry` de domínio nem no retrato da versão.
 *
 * Se a chave já existir para o usuário, o INSERT falha com 23505 (`isUniqueViolation`) e a
 * transação inteira, inclusive o fornecedor novo, é desfeita pelo chamador.
 */
export async function insertPanelEntry(
  tx: Transaction,
  tenantId: string,
  change: EntryChange,
  extra: {
    clientRequestId: string;
    newSuppliers?: readonly { id: string; name: string }[];
  },
): Promise<void> {
  if (extra.newSuppliers && extra.newSuppliers.length > 0) {
    await tx
      .insert(suppliers)
      .values(
        extra.newSuppliers.map((supplier) => ({ id: supplier.id, tenantId, name: supplier.name })),
      );
  }
  await tx
    .insert(entries)
    .values({ ...entryValues(change.entry, 0), tenantId, clientRequestId: extra.clientRequestId });
  await tx.insert(entryVersions).values(versionValues(change));
}

/** Id do lançamento que o usuário já criou com esta chave na empresa da transação, ou nulo. */
export async function findByClientRequest(
  tx: Transaction,
  userId: string,
  clientRequestId: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ id: entries.id })
    .from(entries)
    .where(and(eq(entries.createdBy, userId), eq(entries.clientRequestId, clientRequestId)))
    .limit(1);
  return row?.id ?? null;
}

function pgError(error: unknown): { code?: string; constraint?: string } | null {
  if (typeof error !== "object" || error === null) return null;
  // Drizzle 0.45 embrulha o erro do driver em `DrizzleQueryError`; o original fica em `cause`.
  const candidate = "cause" in error && error.cause ? error.cause : error;
  return typeof candidate === "object" && candidate !== null ? candidate : null;
}

/** Índice único do nome do fornecedor por empresa (migration 0020, F3b-1). */
export const SUPPLIER_NAME_UNIQUE = "suppliers_tenant_name_norm_unique";

/** Violação de unicidade (23505) da constraint ou índice com este nome. */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  const pg = pgError(error) as { code?: unknown; constraint?: unknown } | null;
  return pg?.code === "23505" && pg.constraint === constraint;
}
