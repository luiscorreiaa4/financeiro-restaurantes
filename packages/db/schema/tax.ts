import { TAX_REGIME_CHOICES, TAX_REGIMES } from "@app/core";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  jsonb,
  date as pgDate,
  pgPolicy,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { appRole, authCanInsert, createdAt, oneOf, primaryId, tenantIsolation } from "./_shared";
import { tenantId, users } from "./tenants";

/**
 * Configuração do imposto estimado por empresa (RF39.R1 a R3): uma linha por data de início,
 * para a troca de regime valer só dali em diante. A linha mais recente diz se a opção está ligada.
 * "Não sei" (`not_sure`) é aceito desligado, mas nunca ligado.
 */
export const taxSettings = pgTable(
  "tax_settings",
  {
    id: primaryId(),
    tenantId: tenantId(),
    validFrom: pgDate("valid_from", { mode: "string" }).notNull(),
    enabled: boolean("enabled").notNull().default(false),
    regime: text("regime").notNull(),
    /** Parâmetros do regime (ex.: `rbt12Cents`, `creditsCents`); cada um é um inteiro. */
    params: jsonb("params").notNull().default({}),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique("tax_settings_tenant_valid_from_unique").on(t.tenantId, t.validFrom),
    oneOf("tax_settings_regime_check", "regime", TAX_REGIME_CHOICES),
    check("tax_settings_enabled_regime_check", sql`not ${t.enabled} or ${t.regime} <> 'not_sure'`),
    check("tax_settings_params_check", sql`jsonb_typeof(${t.params}) = 'object'`),
    tenantIsolation("tax_settings"),
    authCanInsert("tax_settings"),
  ],
);

/**
 * Regras de cálculo do sistema, versionadas por vigência (RF39.R4). Tabela global (sem
 * `tenant_id`), lida por todos e gravada só pelo administrador (migration e seed). Nunca se edita
 * uma linha: mudar a regra cria linha nova. `[PROVISÓRIO – P16, P17]`: o Matheus fornece os valores.
 */
export const taxRules = pgTable(
  "tax_rules",
  {
    id: primaryId(),
    regime: text("regime").notNull(),
    validFrom: pgDate("valid_from", { mode: "string" }).notNull(),
    /** Nulo = sem fim. */
    validTo: pgDate("valid_to", { mode: "string" }),
    /** Lista de componentes `{ label, formula }` (ver `TaxRule` em `@app/core`). */
    components: jsonb("components").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("tax_rules_regime_valid_from_unique").on(t.regime, t.validFrom),
    oneOf("tax_rules_regime_check", "regime", TAX_REGIMES),
    check("tax_rules_period_check", sql`${t.validTo} is null or ${t.validTo} >= ${t.validFrom}`),
    check("tax_rules_components_check", sql`jsonb_typeof(${t.components}) = 'array'`),
    pgPolicy("tax_rules_read", {
      as: "permissive",
      for: "select",
      to: appRole,
      using: sql`true`,
    }),
  ],
);
