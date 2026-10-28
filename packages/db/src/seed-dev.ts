import { createDatabase, createPool } from "./client";
import { seedDevData } from "./dev-seed";

const url = process.env.DATABASE_ADMIN_URL;
if (!url) {
  console.error("db:seed:dev: defina DATABASE_ADMIN_URL (papel administrativo).");
  process.exit(1);
}

const pool = createPool(url);
try {
  await seedDevData(createDatabase(pool), process.env.NODE_ENV ?? "development");
  console.log("db:seed:dev: restaurantes e usuários de desenvolvimento gravados.");
} finally {
  await pool.end();
}
