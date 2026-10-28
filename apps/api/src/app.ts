import type { Env } from "@app/config/env";
import Fastify from "fastify";
import { type WhatsAppWebhookDeps, whatsappWebhookRoutes } from "./http/webhooks/whatsapp";

export interface AppDeps {
  readonly whatsapp?: WhatsAppWebhookDeps;
  /** Destino dos logs; o padrão é stdout. Existe para os testes lerem o que foi registrado. */
  readonly logStream?: { write(line: string): void };
}

export function buildApp(env: Pick<Env, "LOG_LEVEL">, deps: AppDeps = {}) {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      ...(deps.logStream ? { stream: deps.logStream } : {}),
      serializers: {
        // Sem a query string: o handshake do webhook leva `hub.verify_token` nela (regra 9).
        req: (request) => ({
          method: request.method,
          url: request.url?.split("?")[0],
          requestId: request.id,
        }),
      },
    },
  });

  app.get("/health", async () => ({ status: "ok" }));

  if (deps.whatsapp) app.register(whatsappWebhookRoutes, { deps: deps.whatsapp });

  return app;
}
