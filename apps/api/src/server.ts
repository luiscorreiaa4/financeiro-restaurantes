import { loadEnv } from "@app/config/env";
import { buildApp } from "./app";

const env = loadEnv();
const app = buildApp(env);

try {
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
