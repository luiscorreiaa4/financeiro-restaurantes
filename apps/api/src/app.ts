import type { Env } from "@app/config/env";
import Fastify from "fastify";
import { type AuthRoutesDeps, authRoutes } from "./http/auth/auth-routes";
import { type EntriesRoutesDeps, entriesRoutes } from "./http/entries/entries-routes";
import { type ExportsRoutesDeps, exportsRoutes } from "./http/exports/exports-routes";
import { appOriginOf, originGuard } from "./http/origin-guard";
import type { PanelDeps } from "./http/panel/panel-context";
import { panelRoutes } from "./http/panel/panel-routes";
import { type ProfileRoutesDeps, profileRoutes } from "./http/profile/profile-routes";
import { type RecoveryRoutesDeps, recoveryRoutes } from "./http/recovery/recovery-routes";
import { reportsRoutes } from "./http/reports/reports-routes";
import {
  type RestrictedUnitsDeps,
  restrictedUnitsRoutes,
} from "./http/restricted/restricted-units-routes";
import { type CatalogRoutesDeps, catalogRoutes } from "./http/settings/catalog-routes";
import { type CategoriesRoutesDeps, categoriesRoutes } from "./http/settings/categories-routes";
import { type FeeReapplyRoutesDeps, feeReapplyRoutes } from "./http/settings/fee-reapply-routes";
import { type MembersRoutesDeps, membersRoutes } from "./http/settings/members-routes";
import { type SuppliersRoutesDeps, suppliersRoutes } from "./http/settings/suppliers-routes";
import { type UnitsRoutesDeps, unitsRoutes } from "./http/settings/units-routes";
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
  /** Lançamentos do painel (F3a, RF22): `GET /api/entries`, `/api/entries/totals` e `/api/entries/options`. */
  readonly entries?: EntriesRoutesDeps;
  /** Exportação Excel/CSV (F5, RF29): `/api/exports*`. */
  readonly exports?: ExportsRoutesDeps;
  /** Configurações do painel (F6a, RF04): `/api/settings/*`. */
  readonly settings?: UnitsRoutesDeps &
    CatalogRoutesDeps &
    CategoriesRoutesDeps &
    SuppliersRoutesDeps &
    FeeReapplyRoutesDeps &
    MembersRoutesDeps;
  /** Reativar unidade no acesso restrito (F6a, DD-33): `/api/restricted/units*`. */
  readonly restricted?: RestrictedUnitsDeps;
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
  if (deps.entries) app.register(entriesRoutes, { deps: deps.entries });
  // Relatórios do dashboard (F4, RF27): só precisam do contexto do painel, as mesmas deps.
  if (deps.entries) app.register(reportsRoutes, { deps: deps.entries });
  if (deps.exports) app.register(exportsRoutes, { deps: deps.exports });
  if (deps.settings) app.register(unitsRoutes, { deps: deps.settings });
  if (deps.settings) app.register(catalogRoutes, { deps: deps.settings });
  if (deps.settings) app.register(categoriesRoutes, { deps: deps.settings });
  if (deps.settings) app.register(suppliersRoutes, { deps: deps.settings });
  if (deps.settings) app.register(feeReapplyRoutes, { deps: deps.settings });
  if (deps.settings) app.register(membersRoutes, { deps: deps.settings });
  if (deps.restricted) app.register(restrictedUnitsRoutes, { deps: deps.restricted });

  return app;
}
