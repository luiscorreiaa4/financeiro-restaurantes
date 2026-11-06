import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type pg from "pg";

const MIGRATIONS = fileURLToPath(new URL("../migrations", import.meta.url));

/**
 * Aplica só as migrations até `lastTag` (inclusive), para criar dados "antigos" por SQL antes
 * de aplicar a migration que os converte. Depois, `migrateAll` aplica as que faltam.
 */
export async function migrateUpTo(pool: pg.Pool, lastTag: string): Promise<void> {
  const folder = mkdtempSync(join(tmpdir(), "migrations-"));
  cpSync(MIGRATIONS, folder, { recursive: true });
  const journalPath = join(folder, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
    entries: { tag: string }[];
  };
  const cut = journal.entries.findIndex((entry) => entry.tag === lastTag);
  if (cut === -1) throw new Error(`migration ${lastTag} não existe`);
  journal.entries = journal.entries.slice(0, cut + 1);
  writeFileSync(journalPath, JSON.stringify(journal));
  await migrate(drizzle(pool), { migrationsFolder: folder });
}

export async function migrateAll(pool: pg.Pool): Promise<void> {
  await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS });
}
