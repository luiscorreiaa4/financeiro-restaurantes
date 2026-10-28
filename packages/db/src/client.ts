import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";

export type Database = NodePgDatabase;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class InvalidTenantIdError extends Error {
  constructor() {
    super("withTenant: tenantId precisa ser um UUID");
    this.name = "InvalidTenantIdError";
  }
}

export function createPool(connectionString: string): pg.Pool {
  return new pg.Pool({ connectionString });
}

export function createDatabase(pool: pg.Pool): Database {
  return drizzle(pool);
}

/**
 * Executa `fn` em uma transação com `app.tenant_id` definido (regra 2). O valor é
 * parametrizado e vale só até o fim da transação (`set_config(..., true)`), então não
 * vaza entre requisições que reutilizam a conexão do pool.
 *
 * Toda query da aplicação roda dentro desta função. Fora dela o papel `app` não vê linha
 * nenhuma.
 */
export async function withTenant<T>(
  db: Database,
  tenantId: string,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  if (!UUID_PATTERN.test(tenantId)) throw new InvalidTenantIdError();
  return db.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}
