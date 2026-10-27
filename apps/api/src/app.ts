import type { Env } from "@app/config/env";
import Fastify from "fastify";

export function buildApp(env: Pick<Env, "LOG_LEVEL">) {
  const app = Fastify({ logger: { level: env.LOG_LEVEL } });

  app.get("/health", async () => ({ status: "ok" }));

  return app;
}
