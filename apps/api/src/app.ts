import type { Env } from "@app/config/env";
import Fastify from "fastify";
import { type AuthRoutesDeps, authRoutes } from "./http/auth/auth-routes";
import { appOriginOf, originGuard } from "./http/origin-guard";
import type { PanelDeps } from "./http/panel/panel-context";
import { panelRoutes } from "./http/panel/panel-routes";
import { type ProfileRoutesDeps, profileRoutes } from "./http/profile/profile-routes";
import { type RecoveryRoutesDeps, recoveryRoutes } from "./http/recovery/recovery-routes";
import { type SignupRoutesDeps, signupRoutes } from "./http/signup/signup-routes";
import { type WhatsAppWebhookDeps, whatsappWebhookRoutes } from "./http/webhooks/whatsapp";

export interface AppDeps {
  readonly whatsapp?: WhatsAppWebhookDeps;
  /** Acesso ao painel (Better Auth): `/api/auth/*`. */
  readonly auth?: AuthRoutesDeps;
  /**
   * Autocadastro do dono (F1b): `/api/signup/code`, `/api/signup/verify`, `/api/signup` e
   * `/api/companies` ("Criar outra empresa", com sessão).
   */
  readonly signup?: SignupRoutesDeps;
  /** Recuperação de senha pelo link do e-mail (F1c): `POST /api/recovery/request` e `/reset`, públicas. */
  readonly recovery?: RecoveryRoutesDeps;
  /** Perfil do usuário logado (F1c): `/api/profile*`, nome, senha e sessões. */
  readonly profile?: ProfileRoutesDeps;
  /** Contexto do painel (F2): guards de empresa, unidade e permissão. `GET /api/me`, `POST /api/context` e `GET /api/units`. */
  readonly panel?: PanelDeps;
  /** Destino dos logs; o padrão é stdout. Existe para os testes lerem o que foi registrado. */
  readonly logStream?: { write(line: string): void };
}

export function buildApp(env: Pick<Env, "LOG_LEVEL" | "APP_URL">, deps: AppDeps = {}) {
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

  // DD-32 item 3: toda escrita exige Origin do painel; só o webhook (assinatura) fica de fora.
  app.addHook("onRequest", originGuard({ appOrigin: appOriginOf(env.APP_URL) }));

  app.get("/health", async () => ({ status: "ok" }));

  if (deps.whatsapp) app.register(whatsappWebhookRoutes, { deps: deps.whatsapp });
  if (deps.auth) app.register(authRoutes, { deps: deps.auth });
  if (deps.signup) app.register(signupRoutes, { deps: deps.signup });
  if (deps.recovery) app.register(recoveryRoutes, { deps: deps.recovery });
  if (deps.profile) app.register(profileRoutes, { deps: deps.profile });
  if (deps.panel) app.register(panelRoutes, { deps: deps.panel });

  return app;
}
