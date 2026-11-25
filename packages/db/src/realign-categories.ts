import { createDatabase, createPool } from "./client";
import { realignSystemCategories } from "./realign-system-categories";

const url = process.env.DATABASE_ADMIN_URL;
if (!url) {
  console.error("db:realign-categories: defina DATABASE_ADMIN_URL (papel administrativo).");
  process.exit(1);
}

const pool = createPool(url);
try {
  const result = await realignSystemCategories(createDatabase(pool));
  console.log("db:realign-categories:", JSON.stringify(result));
} finally {
  await pool.end();
}
