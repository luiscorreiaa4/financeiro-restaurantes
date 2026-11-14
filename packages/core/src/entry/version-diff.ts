import { z } from "zod";
import type { EntryChangeField } from "../contracts/entries";

// Histórico do lançamento (RF25.R4): o "antes e depois" de cada versão, campo a campo, com
// os nomes do cadastro no lugar dos ids. Domínio puro: quem lê o banco e quem decide o que o
// ator pode ver é a rota.

/** Texto no lugar do nome de um cadastro que não existe mais. O id nunca sai. */
export const REMOVED_NAME = "(removido)";

/**
 * Retrato de um lançamento numa versão: os campos do `Entry` que o histórico mostra. Todo
 * campo é opcional porque o retrato vem do JSON de `entry_versions`, e versão antiga não tem
 * os campos que vieram depois. Um `Entry` inteiro serve como retrato.
 */
export interface VersionSnapshot {
  readonly unitId?: string;
  readonly type?: string;
  readonly occurredOn?: string;
  readonly paidOn?: string;
  readonly description?: string;
  readonly quantity?: number | null;
  readonly quantityUnit?: string | null;
  readonly orders?: number | null;
  readonly amountCents?: number;
  readonly feePercentBp?: number;
  readonly feeFixedCents?: number;
  readonly feeCents?: number;
  readonly netCents?: number;
  /** Ausente (`undefined`) é diferente de nulo: sem a informação, a versão conta como sensível. */
  readonly categoryId?: string | null;
  readonly supplierId?: string | null;
  readonly paymentMethodId?: string | null;
  readonly salesChannelId?: string | null;
  readonly flags?: readonly string[];
  readonly deleteReason?: string | null;
}

/** Nomes atuais dos cadastros da empresa, por id. */
export interface VersionNames {
  readonly categories: ReadonlyMap<
    string,
    { readonly name: string; readonly isSensitive: boolean }
  >;
  readonly suppliers: ReadonlyMap<string, string>;
  readonly paymentMethods: ReadonlyMap<string, string>;
  readonly salesChannels: ReadonlyMap<string, string>;
  readonly units: ReadonlyMap<string, string>;
}

export type VersionChangeValue = string | number | null;

export interface VersionFieldChange {
  readonly field: EntryChangeField;
  readonly before: VersionChangeValue;
  readonly after: VersionChangeValue;
}

export interface VersionDiff {
  /**
   * O antes ou o depois está em categoria sensível. Falha fechado: categoria que não está no
   * cadastro, ou retrato que não diz a categoria, conta como sensível. Quem chama esconde
   * `changes` de quem não vê sensíveis (RF06.R3).
   */
  readonly sensitive: boolean;
  /** Campos que mudaram, na ordem de `ENTRY_CHANGE_FIELDS`. */
  readonly changes: readonly VersionFieldChange[];
}

function nameOf(
  id: string | null | undefined,
  lookup: (id: string) => string | undefined,
): string | null {
  if (id === null || id === undefined) return null;
  return lookup(id) ?? REMOVED_NAME;
}

/**
 * Como cada campo do histórico sai do retrato. O `Record` obriga a cobrir todos os campos do
 * contrato, e a ordem das chaves é a ordem em que os campos aparecem.
 */
const READERS: Record<
  EntryChangeField,
  (snapshot: VersionSnapshot, names: VersionNames) => VersionChangeValue
> = {
  type: (s) => s.type ?? null,
  occurredOn: (s) => s.occurredOn ?? null,
  paidOn: (s) => s.paidOn ?? null,
  description: (s) => s.description ?? null,
  quantity: (s) => s.quantity ?? null,
  quantityUnit: (s) => s.quantityUnit ?? null,
  orders: (s) => s.orders ?? null,
  amountCents: (s) => s.amountCents ?? null,
  feePercentBp: (s) => s.feePercentBp ?? null,
  feeFixedCents: (s) => s.feeFixedCents ?? null,
  feeCents: (s) => s.feeCents ?? null,
  netCents: (s) => s.netCents ?? null,
  category: (s, n) => nameOf(s.categoryId, (id) => n.categories.get(id)?.name),
  supplier: (s, n) => nameOf(s.supplierId, (id) => n.suppliers.get(id)),
  paymentMethod: (s, n) => nameOf(s.paymentMethodId, (id) => n.paymentMethods.get(id)),
  salesChannel: (s, n) => nameOf(s.salesChannelId, (id) => n.salesChannels.get(id)),
  unit: (s, n) => nameOf(s.unitId, (id) => n.units.get(id)),
  // Um texto só; sem sinais, nulo.
  flags: (s) => (s.flags === undefined || s.flags.length === 0 ? null : s.flags.join(", ")),
  deleteReason: (s) => s.deleteReason ?? null,
};

const FIELDS = Object.keys(READERS) as EntryChangeField[];

function inSensitiveCategory(snapshot: VersionSnapshot, names: VersionNames): boolean {
  if (snapshot.categoryId === null) return false;
  if (snapshot.categoryId === undefined) return true;
  return names.categories.get(snapshot.categoryId)?.isSensitive !== false;
}

/**
 * Campos que mudaram entre o antes e o depois de uma versão. Na criação (`before` nulo) saem
 * os campos preenchidos, com o antes nulo. Exclusão e restauração aparecem pelo motivo
 * (`deleteReason`), que é o único campo do histórico que elas mexem.
 *
 * Não decide o que o ator vê: devolve `sensitive` e o diff completo.
 */
export function diffVersion(
  before: VersionSnapshot | null,
  after: VersionSnapshot,
  names: VersionNames,
): VersionDiff {
  const changes: VersionFieldChange[] = [];
  for (const field of FIELDS) {
    const read = READERS[field];
    const previous = before === null ? null : read(before, names);
    const next = read(after, names);
    if (previous !== next) changes.push({ field, before: previous, after: next });
  }
  const sensitive =
    inSensitiveCategory(after, names) || (before !== null && inSensitiveCategory(before, names));
  return { sensitive, changes };
}

// Cada campo é lido sozinho: um valor de tipo errado some (vira `undefined`) sem derrubar os
// outros. Dinheiro e contagens só entram como inteiro seguro (RNF13).
const text = z.string().optional().catch(undefined);
const nullableText = z.string().nullable().optional().catch(undefined);
const integer = z.number().int().optional().catch(undefined);
const nullableInteger = z.number().int().nullable().optional().catch(undefined);

const snapshotSchema = z.object({
  unitId: text,
  type: text,
  occurredOn: text,
  paidOn: text,
  description: text,
  quantity: z.number().nullable().optional().catch(undefined),
  quantityUnit: nullableText,
  orders: nullableInteger,
  amountCents: integer,
  feePercentBp: integer,
  feeFixedCents: integer,
  feeCents: integer,
  netCents: integer,
  categoryId: nullableText,
  supplierId: nullableText,
  paymentMethodId: nullableText,
  salesChannelId: nullableText,
  flags: z.array(z.string()).optional().catch(undefined),
  deleteReason: nullableText,
});

/**
 * Lê o `before` ou o `after` de `entry_versions` (o `Entry` como JSON). Nulo continua nulo
 * (a criação não tem antes). O que não for um objeto vira retrato vazio, que `diffVersion`
 * trata como sensível.
 */
export function parseVersionSnapshot(raw: unknown): VersionSnapshot | null {
  if (raw === null || raw === undefined) return null;
  const parsed = snapshotSchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
}
