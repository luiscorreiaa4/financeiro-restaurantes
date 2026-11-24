import {
  BRAZILIAN_STATES,
  type DomainError,
  ensureNotLastActiveUnit,
  fail,
  isProtectedCatalogName,
  isValidTimezone,
  loadMunicipalities,
  ok,
  type Result,
  type UnitRecord,
  type UnitStatus,
  validateUnitAliases,
  validateUnitCnpj,
  validateUnitLocation,
  validateUnitName,
} from "@app/core";
import type { UnitPatch, UnitSettings, UnitSettingsInput } from "@app/core/contracts";
import { and, asc, eq, sql } from "drizzle-orm";
import { auditLog, salesChannels, units } from "../schema";
import { type Database, type Transaction, withTenant } from "./client";
import { isUniqueViolation } from "./panel-entry-writer";
import { uuidv7 } from "./uuid";

export const UNIT_NAME_UNIQUE = "units_tenant_name_unique";

/** Unidades da empresa para a tela de configurações (F6a, RF04). */
export interface UnitSettingsRepo {
  list(tenantId: string): Promise<UnitSettings[]>;
  create(
    tenantId: string,
    actorId: string,
    input: UnitSettingsInput,
  ): Promise<Result<UnitSettings, DomainError>>;
  /** `null`: id inexistente ou de outra empresa. */
  update(
    tenantId: string,
    actorId: string,
    id: string,
    patch: UnitPatch,
  ): Promise<Result<UnitSettings, DomainError> | null>;
  deactivate(
    tenantId: string,
    actorId: string,
    id: string,
  ): Promise<Result<UnitSettings, DomainError> | null>;
  reactivate(
    tenantId: string,
    actorId: string,
    id: string,
  ): Promise<Result<UnitSettings, DomainError> | null>;
}

type UnitRow = typeof units.$inferSelect;

/** Os campos gravados e auditados da unidade (sem id nem contagem). */
interface UnitFields {
  name: string;
  aliases: string[];
  cnpj: string | null;
  uf: string | null;
  city: string | null;
  timezone: string;
  status: string;
  defaultSalesChannelId: string | null;
}

const fieldsOf = (row: UnitRow): UnitFields => ({
  name: row.name,
  aliases: [...row.aliases],
  cnpj: row.cnpj,
  uf: row.uf,
  city: row.city,
  timezone: row.timezone,
  status: row.status,
  defaultSalesChannelId: row.defaultSalesChannelId,
});

/** Só os campos cujo valor mudou, no antes e no depois. */
function diff(
  before: UnitFields,
  after: UnitFields,
): { before: Partial<UnitFields>; after: Partial<UnitFields> } | null {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const key of Object.keys(after) as (keyof UnitFields)[]) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      b[key] = before[key];
      a[key] = after[key];
    }
  }
  return Object.keys(a).length === 0
    ? null
    : { before: b as Partial<UnitFields>, after: a as Partial<UnitFields> };
}

const toSettings = (row: UnitRow, onlyUnitMemberCount: number): UnitSettings => ({
  id: row.id,
  name: row.name,
  aliases: [...row.aliases],
  cnpj: row.cnpj,
  uf: row.uf as UnitSettings["uf"],
  city: row.city,
  timezone: row.timezone,
  status: row.status as UnitStatus,
  defaultSalesChannelId: row.defaultSalesChannelId,
  onlyUnitMemberCount,
});

const asRecords = (rows: readonly UnitRow[]): UnitRecord[] =>
  rows.map((r) => ({ id: r.id, name: r.name, aliases: r.aliases, status: r.status as UnitStatus }));

/** Colaboradores ativos, sem TODAS, cuja única unidade de acesso é a da linha. */
async function onlyUnitMemberCounts(
  tx: Transaction,
  tenantId: string,
): Promise<Map<string, number>> {
  const result = await tx.execute<{ unit_id: string; total: number }>(sql`
    select mu.unit_id as unit_id, count(*)::int as total
    from memberships m
    join membership_units mu on mu.membership_id = m.id and mu.tenant_id = m.tenant_id
    where m.tenant_id = ${tenantId}
      and m.status = 'active'
      and m.all_units = false
      and not exists (
        select 1 from membership_units other
        where other.membership_id = m.id and other.unit_id <> mu.unit_id
      )
    group by mu.unit_id`);
  return new Map(result.rows.map((r) => [r.unit_id, Number(r.total)]));
}

export function createUnitSettingsRepo(db: Database): UnitSettingsRepo {
  // Serializa as escritas da empresa: trava todas as unidades, sempre na mesma ordem.
  const lockUnits = (tx: Transaction, tenantId: string) =>
    tx
      .select()
      .from(units)
      .where(eq(units.tenantId, tenantId))
      .orderBy(asc(units.id))
      .for("update");

  /**
   * Canal padrão: ativo, da própria empresa (lido sob RLS: a chave estrangeira não protege o
   * canal de outra empresa) e que não seja o cadastro do sistema "Não informado".
   */
  async function checkDefaultChannel(
    tx: Transaction,
    tenantId: string,
    channelId: string,
  ): Promise<Result<true, DomainError>> {
    const [channel] = await tx
      .select({ name: salesChannels.name, status: salesChannels.status })
      .from(salesChannels)
      .where(and(eq(salesChannels.tenantId, tenantId), eq(salesChannels.id, channelId)));
    if (!channel) return fail("UnknownReference", { field: "sales_channel" });
    if (channel.status !== "active" || isProtectedCatalogName("sales_channel", channel.name)) {
      return fail("UnknownReference", { field: "sales_channel" });
    }
    return ok(true);
  }

  const location = async (city: string, uf: string) => {
    const cities = (BRAZILIAN_STATES as readonly string[]).includes(uf.trim().toUpperCase())
      ? await loadMunicipalities(uf)
      : undefined;
    return validateUnitLocation({ city, uf, cities });
  };

  const nameDuplicate = (): Result<never, DomainError> =>
    fail("InvalidUnit", { field: "name", reason: "duplicate" });

  async function audit(
    tx: Transaction,
    tenantId: string,
    actorId: string,
    action: string,
    target: string,
    metadata: unknown,
  ) {
    await tx.insert(auditLog).values({
      id: uuidv7(),
      tenantId,
      actorId,
      action,
      target,
      metadata: metadata as Record<string, unknown>,
    });
  }

  /** Edição e troca de status no mesmo caminho: tudo sob a trava de todas as unidades. */
  async function apply(
    tenantId: string,
    actorId: string,
    id: string,
    patch: UnitPatch,
  ): Promise<Result<UnitSettings, DomainError> | null> {
    try {
      return await withTenant(db, tenantId, async (tx) => {
        const existing = await lockUnits(tx, tenantId);
        const current = existing.find((r) => r.id === id);
        if (!current) return null;
        const before = fieldsOf(current);
        const after: UnitFields = { ...before };
        const others = asRecords(existing.filter((r) => r.id !== id));

        if (patch.name !== undefined) {
          const name = validateUnitName(patch.name, others);
          if (!name.ok) return name;
          after.name = name.value;
        }
        // Trocar o nome também revalida os apelidos (um apelido não pode igualar o nome).
        if (patch.aliases !== undefined || patch.name !== undefined) {
          const aliases = validateUnitAliases({
            name: after.name,
            aliases: patch.aliases ?? before.aliases,
            others,
          });
          if (!aliases.ok) return aliases;
          after.aliases = [...aliases.value];
        }
        if (patch.cnpj !== undefined) {
          const cnpj = validateUnitCnpj(patch.cnpj);
          if (!cnpj.ok) return cnpj;
          after.cnpj = cnpj.value;
        }
        if (patch.city !== undefined || patch.uf !== undefined) {
          const place = await location(
            patch.city ?? before.city ?? "",
            patch.uf ?? before.uf ?? "",
          );
          if (!place.ok) return place;
          after.city = place.value.city;
          after.uf = place.value.uf;
        }
        if (patch.timezone !== undefined) {
          if (!isValidTimezone(patch.timezone)) {
            return fail("InvalidUnit", { field: "timezone", reason: "invalid" });
          }
          after.timezone = patch.timezone;
        }
        if (
          patch.defaultSalesChannelId !== undefined &&
          patch.defaultSalesChannelId !== before.defaultSalesChannelId
        ) {
          if (patch.defaultSalesChannelId !== null) {
            const channel = await checkDefaultChannel(tx, tenantId, patch.defaultSalesChannelId);
            if (!channel.ok) return channel;
          }
          after.defaultSalesChannelId = patch.defaultSalesChannelId;
        }
        if (patch.status !== undefined && patch.status !== before.status) {
          if (patch.status === "inactive") {
            const allowed = ensureNotLastActiveUnit(asRecords(existing), id);
            if (!allowed.ok) return allowed;
          }
          after.status = patch.status;
        }

        const counts = await onlyUnitMemberCounts(tx, tenantId);
        const changes = diff(before, after);
        if (!changes) return ok(toSettings(current, counts.get(id) ?? 0));
        const [row] = await tx
          .update(units)
          .set(after)
          .where(and(eq(units.tenantId, tenantId), eq(units.id, id)))
          .returning();
        if (!row) throw new Error("update de unidade sem retorno");
        const onlyStatus = Object.keys(changes.after).length === 1 && "status" in changes.after;
        const action = !onlyStatus
          ? "unit.update"
          : after.status === "inactive"
            ? "unit.deactivate"
            : "unit.reactivate";
        await audit(tx, tenantId, actorId, action, id, changes);
        return ok(toSettings(row, counts.get(id) ?? 0));
      });
    } catch (error) {
      if (isUniqueViolation(error, UNIT_NAME_UNIQUE)) return nameDuplicate();
      throw error;
    }
  }

  return {
    async list(tenantId) {
      return withTenant(db, tenantId, async (tx) => {
        const rows = await tx
          .select()
          .from(units)
          .where(eq(units.tenantId, tenantId))
          .orderBy(asc(units.name));
        const counts = await onlyUnitMemberCounts(tx, tenantId);
        return rows.map((r) => toSettings(r, counts.get(r.id) ?? 0));
      });
    },

    async create(tenantId, actorId, input) {
      const id = uuidv7();
      try {
        return await withTenant(db, tenantId, async (tx) => {
          const existing = await lockUnits(tx, tenantId);
          const others = asRecords(existing);
          const name = validateUnitName(input.name, others);
          if (!name.ok) return name;
          const aliases = validateUnitAliases({ name: name.value, aliases: input.aliases, others });
          if (!aliases.ok) return aliases;
          const cnpj = validateUnitCnpj(input.cnpj);
          if (!cnpj.ok) return cnpj;
          const place = await location(input.city, input.uf);
          if (!place.ok) return place;
          if (!isValidTimezone(input.timezone)) {
            return fail("InvalidUnit", { field: "timezone", reason: "invalid" });
          }
          if (input.defaultSalesChannelId !== null) {
            const channel = await checkDefaultChannel(tx, tenantId, input.defaultSalesChannelId);
            if (!channel.ok) return channel;
          }
          const values = {
            name: name.value,
            aliases: [...aliases.value],
            cnpj: cnpj.value,
            uf: place.value.uf,
            city: place.value.city,
            timezone: input.timezone,
            status: input.status,
            defaultSalesChannelId: input.defaultSalesChannelId,
          };
          const [row] = await tx
            .insert(units)
            .values({ id, tenantId, ...values })
            .returning();
          if (!row) throw new Error("insert de unidade sem retorno");
          await audit(tx, tenantId, actorId, "unit.create", id, { after: values });
          return ok(toSettings(row, 0));
        });
      } catch (error) {
        if (isUniqueViolation(error, UNIT_NAME_UNIQUE)) return nameDuplicate();
        throw error;
      }
    },

    update: apply,
    deactivate: (tenantId, actorId, id) => apply(tenantId, actorId, id, { status: "inactive" }),
    reactivate: (tenantId, actorId, id) => apply(tenantId, actorId, id, { status: "active" }),
  };
}
