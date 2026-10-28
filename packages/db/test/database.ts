import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const INIT_SQL = fileURLToPath(new URL("../../../docker/postgres/init.sql", import.meta.url));
const MIGRATIONS = fileURLToPath(new URL("../migrations", import.meta.url));

export interface TestDatabase {
  /** Papel `postgres` (superusuário): prepara dados e inspeciona catálogos. */
  readonly admin: pg.Pool;
  /** Papel `app`, como em produção (sem BYPASSRLS). */
  readonly app: pg.Pool;
  /** Papel `app_ingest`, usado pelo webhook. */
  readonly ingest: pg.Pool;
  /** Strings de conexão de cada papel, para quem precisa abrir o próprio pool (ex.: pg-boss). */
  readonly urls: { readonly admin: string; readonly app: string; readonly ingest: string };
  /** Cria um banco vazio no mesmo container e devolve um pool admin para ele. */
  createEmptyDatabase(name: string): Promise<pg.Pool>;
  stop(): Promise<void>;
}

/**
 * Sobe um Postgres 16 real, aplica `docker/postgres/init.sql` (papéis, o mesmo arquivo do
 * Docker Compose) e as migrations. Sem mock de banco.
 */
export async function startTestDatabase(): Promise<TestDatabase> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer("postgres:16")
    .withDatabase("app")
    .withUsername("postgres")
    .withPassword("postgres")
    .start();

  const urlFor = (user: string, password: string, database = "app") =>
    `postgres://${user}:${password}@${container.getHost()}:${container.getPort()}/${database}`;

  const admin = new pg.Pool({ connectionString: urlFor("postgres", "postgres") });
  await admin.query(readFileSync(INIT_SQL, "utf8"));
  await migrate(drizzle(admin), { migrationsFolder: MIGRATIONS });

  const app = new pg.Pool({ connectionString: urlFor("app", "app") });
  const ingest = new pg.Pool({ connectionString: urlFor("app_ingest", "app_ingest") });
  const extraPools: pg.Pool[] = [];

  return {
    admin,
    app,
    ingest,
    urls: {
      admin: urlFor("postgres", "postgres"),
      app: urlFor("app", "app"),
      ingest: urlFor("app_ingest", "app_ingest"),
    },
    async createEmptyDatabase(name) {
      await admin.query(`create database ${name}`);
      const pool = new pg.Pool({ connectionString: urlFor("postgres", "postgres", name) });
      extraPools.push(pool);
      return pool;
    },
    async stop() {
      await Promise.all([app.end(), ingest.end(), ...extraPools.map((pool) => pool.end())]);
      await admin.end();
      await container.stop();
    },
  };
}

/** Roda `fn` numa transação do papel indicado com `app.tenant_id` definido. */
export async function asTenant<T>(
  pool: pg.Pool,
  tenantId: string,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await fn(client);
    await client.query("rollback");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Resultado de uma tentativa: linhas afetadas ou o código SQLSTATE do erro. */
export type Attempt = { rows: number } | { error: string };

export async function attempt(
  client: pg.PoolClient,
  sql: string,
  params: unknown[] = [],
): Promise<Attempt> {
  await client.query("savepoint attempt");
  try {
    const result = await client.query(sql, params);
    await client.query("release savepoint attempt");
    return { rows: result.rowCount ?? 0 };
  } catch (error) {
    await client.query("rollback to savepoint attempt");
    return { error: (error as { code?: string }).code ?? "unknown" };
  }
}
