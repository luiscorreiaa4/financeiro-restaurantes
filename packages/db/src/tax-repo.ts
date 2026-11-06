import {
  type DomainError,
  ok,
  type Result,
  TAX_REGIMES,
  type TaxRegime,
  type TaxRegimeChoice,
  type TaxRule,
  type TaxSettingsPeriod,
  validateTaxSettings,
} from "@app/core";
import { and, asc, desc, eq } from "drizzle-orm";
import { auditLog, taxRules, taxSettings } from "../schema";
import { type Database, withTenant } from "./client";
import { uuidv7 } from "./uuid";

export interface TaxSettingsInput {
  /** Data de início do regime (RF39.R2). */
  readonly validFrom: string;
  readonly enabled: boolean;
  readonly regime: TaxRegimeChoice;
  readonly params: Readonly<Record<string, number>>;
}

export interface TaxRepo {
  /** `enabled` é o da configuração mais recente; `periods` só traz regimes calculáveis. */
  loadSettings(
    tenantId: string,
  ): Promise<{ enabled: boolean; periods: readonly TaxSettingsPeriod[] }>;
  /** Regras de cálculo do sistema, versionadas por vigência. */
  loadRules(tenantId: string): Promise<readonly TaxRule[]>;
  /** Grava a configuração e registra quem, quando, antes e depois na auditoria (RF39.R8). */
  saveSettings(
    tenantId: string,
    actorId: string,
    input: TaxSettingsInput,
  ): Promise<Result<true, DomainError>>;
}

const isTaxRegime = (value: string): value is TaxRegime =>
  (TAX_REGIMES as readonly string[]).includes(value);

/** Adaptador do imposto estimado: papel `app`, dentro de `withTenant` (regra 2). */
export function createTaxRepo(db: Database): TaxRepo {
  return {
    async loadSettings(tenantId) {
      const rows = await withTenant(db, tenantId, (tx) =>
        tx
          .select()
          .from(taxSettings)
          .where(eq(taxSettings.tenantId, tenantId))
          .orderBy(asc(taxSettings.validFrom)),
      );
      const latest = rows.at(-1);
      return {
        enabled: latest?.enabled ?? false,
        periods: rows
          .filter((row) => isTaxRegime(row.regime))
          .map((row) => ({
            validFrom: row.validFrom,
            regime: row.regime as TaxRegime,
            params: row.params as Record<string, number>,
          })),
      };
    },

    async loadRules(tenantId) {
      const rows = await withTenant(db, tenantId, (tx) =>
        tx.select().from(taxRules).orderBy(desc(taxRules.validFrom)),
      );
      return rows.map((row) => ({
        regime: row.regime as TaxRegime,
        validFrom: row.validFrom,
        validTo: row.validTo,
        components: row.components as TaxRule["components"],
      }));
    },

    async saveSettings(tenantId, actorId, input) {
      const valid = validateTaxSettings({ enabled: input.enabled, regime: input.regime });
      if (!valid.ok) return valid;
      await withTenant(db, tenantId, async (tx) => {
        const [before] = await tx
          .select()
          .from(taxSettings)
          .where(
            and(eq(taxSettings.tenantId, tenantId), eq(taxSettings.validFrom, input.validFrom)),
          );
        const after = { enabled: input.enabled, regime: input.regime, params: input.params };
        if (before) {
          await tx
            .update(taxSettings)
            .set({ ...after, createdBy: actorId })
            .where(eq(taxSettings.id, before.id));
        } else {
          await tx.insert(taxSettings).values({
            id: uuidv7(),
            tenantId,
            validFrom: input.validFrom,
            ...after,
            createdBy: actorId,
          });
        }
        await tx.insert(auditLog).values({
          id: uuidv7(),
          tenantId,
          actorId,
          action: "tax_settings_changed",
          target: input.validFrom,
          metadata: {
            validFrom: input.validFrom,
            before: before
              ? { enabled: before.enabled, regime: before.regime, params: before.params }
              : null,
            after,
          },
        });
      });
      return ok(true);
    },
  };
}
