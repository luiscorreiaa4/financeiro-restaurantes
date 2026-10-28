import { createDatabase, createPool } from "./client";
import { seedSystemCategories } from "./system-categories";

const url = process.env.DATABASE_ADMIN_URL;
if (!url) {
  console.error("db:seed: defina DATABASE_ADMIN_URL (papel administrativo).");
  process.exit(1);
}

const pool = createPool(url);
try {
  await seedSystemCategories(createDatabase(pool));
  console.log("db:seed: categorias do sistema gravadas.");
} finally {
  await pool.end();
}
