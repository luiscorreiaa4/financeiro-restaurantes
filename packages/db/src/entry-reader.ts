import { type Entry, type EntryScope, parseBRLInput, type RecentEntry } from "@app/core";
import {
  businessDateSchema,
  ENTRY_CURSOR_MAX,
  type EntryDeleted,
  type EntryItem,
  type EntryListQuery,
  type EntryOptions,
  type EntrySort,
  type SortDirection,
  type SourceKind,
  type TrashQuery,
} from "@app/core/contracts";
import { eq, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { categories, entries } from "../schema";
import type { Transaction } from "./client";
import { toEntry } from "./entry-store";

/**
 * Linha da lista de lançamentos do painel (RF22): os campos do contrato sem as permissões
 * (`can*`, que a API calcula), mais o que a API precisa para calculá-las.
 */
export interface EntryRow extends Omit<EntryItem, "canEdit" | "canDelete" | "canRestore"> {
  categoryIsSensitive: boolean;
  createdById: string;
  /** Instante ISO da exclusão; sempre nulo na lista, que não traz a lixeira. */
  deletedAt: string | null;
}

/** Detalhe do lançamento: a linha da lista mais as taxas copiadas e os dados da lixeira. */
export interface EntryDetailRow extends EntryRow {
  feePercentBp: number;
  feeFixedCents: number;
  updatedAt: string;
  /** Preenchido quando o lançamento está na lixeira (RF24). */
  deleted: EntryDeleted | null;
}

/** Versão como está em `entry_versions`. O diff e a marca de restrito são de quem chama. */
export interface EntryVersionRow {
  version: number;
  action: string;
  channel: string;
  changedBy: { id: string; name: string };
  changedAt: string;
  before: unknown;
  after: unknown;
}

export interface EntrySourceRow {
  /** Canal de origem do lançamento (o da versão 1). */
  channel: string;
  kind: SourceKind;
  text: string | null;
  transcription: string | null;
  accessKey: string | null;
  sentBy: { id: string; name: string } | null;
  sentAt: string | null;
  /** A mesma mensagem gerou outro lançamento de categoria sensível (RF25.Obs1). */
  siblingsSensitive: boolean;
}

export interface EntryNames {
  categories: Map<string, { name: string; isSensitive: boolean }>;
  suppliers: Map<string, string>;
  paymentMethods: Map<string, string>;
  salesChannels: Map<string, string>;
  units: Map<string, string>;
}

export interface EntryTotalsRow {
  revenueCents: number;
  expenseCents: number;
  count: number;
  hasRestricted: boolean;
}

/** Cursor ilegível, adulterado ou de outra ordenação. A rota responde `invalid_request`. */
export class InvalidCursorError extends Error {
  constructor() {
    super("entryReader: cursor inválido");
    this.name = "InvalidCursorError";
  }
}

// ---------------------------------------------------------------------------------------
// Ordenação e cursor (RF22.Obs3, DD-35)
// ---------------------------------------------------------------------------------------

/** Instante em UTC com os microssegundos do Postgres; é ISO 8601 e volta com `::timestamptz`. */
const CREATED_AT_TEXT = `to_char(e.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

interface SortSpec {
  /** Coluna da ordenação. Texto fixo do código, nunca entrada de usuário. */
  readonly column: string;
  /** Valor da coluna como texto exato, para o cursor. */
  readonly asText: string;
  /** Tipo para o qual o valor do cursor é convertido de volta. */
  readonly cast: string;
  readonly isValid: (value: string) => boolean;
}

const YEAR_OK = /^[1-9]\d{3}-/;
const CREATED_AT_VALUE = /^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\.\d{6}Z$/;
/** Até 16 dígitos: cabe com folga no inteiro seguro e no `bigint`. */
const AMOUNT_VALUE = /^\d{1,16}$/;
const UUID_VALUE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isBusinessDate(value: string): boolean {
  return YEAR_OK.test(value) && businessDateSchema.safeParse(value).success;
}

function isCreatedAtText(value: string): boolean {
  const match = CREATED_AT_VALUE.exec(value);
  return match !== null && isBusinessDate(match[1] ?? "");
}

const SORTS: Record<EntrySort, SortSpec> = {
  created_at: {
    column: "e.created_at",
    asText: CREATED_AT_TEXT,
    cast: "timestamptz",
    isValid: isCreatedAtText,
  },
  occurred_on: {
    column: "e.occurred_on",
    asText: "e.occurred_on::text",
    cast: "date",
    isValid: isBusinessDate,
  },
  paid_on: {
    column: "e.paid_on",
    asText: "e.paid_on::text",
    cast: "date",
    isValid: isBusinessDate,
  },
  amount: {
    column: "e.amount_cents",
    asText: "e.amount_cents::text",
    cast: "bigint",
    isValid: (value) => AMOUNT_VALUE.test(value),
  },
};

interface Cursor {
  /** Valor da coluna de ordenação na última linha da página, como texto do Postgres. */
  readonly v: string;
  readonly id: string;
}

function encodeCursor(sort: EntrySort, dir: SortDirection, cursor: Cursor): string {
  const payload = JSON.stringify({ s: sort, d: dir, v: cursor.v, id: cursor.id });
  return Buffer.from(payload, "utf8").toString("base64url");
}

/**
 * Lê o cursor e confere tudo antes de ele chegar ao SQL: um valor malformado derrubaria a
 * transação com erro de conversão.
 */
function decodeCursor(text: string, sort: EntrySort, dir: SortDirection): Cursor {
  if (text.length > ENTRY_CURSOR_MAX) throw new InvalidCursorError();
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(text, "base64url").toString("utf8"));
  } catch {
    throw new InvalidCursorError();
  }
  if (typeof payload !== "object" || payload === null) throw new InvalidCursorError();
  const { s, d, v, id } = payload as Record<string, unknown>;
  if (s !== sort || d !== dir) throw new InvalidCursorError();
  if (typeof v !== "string" || typeof id !== "string") throw new InvalidCursorError();
  if (!UUID_VALUE.test(id) || !SORTS[sort].isValid(v)) throw new InvalidCursorError();
  return { v, id };
}

// ---------------------------------------------------------------------------------------
// Filtros
// ---------------------------------------------------------------------------------------

/**
 * Lista como literal de array do Postgres, num parâmetro só. Lista vazia vira `{}`, e
 * `= any('{}')` não casa com nada: recorte sem unidade não vê lançamento nenhum.
 */
export function arrayLiteral(values: readonly string[]): string {
  return `{${values.map((value) => `"${value.replace(/[\\"]/g, "\\$&")}"`).join(",")}}`;
}

const ACCESS_KEY = /^\d{44}$/;

/** Busca livre (RF22.R5): OU entre descrição, fornecedor, valor exato e chave de acesso. */
function searchCondition(q: string): SQL {
  // `%`, `_` e `\` do usuário são texto, não coringa.
  const pattern = `%${q.replace(/[\\%_]/g, "\\$&")}%`;
  const alternatives: SQL[] = [
    sql`e.description ilike ${pattern} escape '\\'`,
    sql`s.name ilike ${pattern} escape '\\'`,
  ];
  if (ACCESS_KEY.test(q)) {
    // 44 dígitos é chave de nota; não é tentado como valor.
    alternatives.push(sql`exists (
      select 1 from fiscal_documents fd
       where fd.tenant_id = e.tenant_id
         and fd.inbound_message_id = e.inbound_message_id
         and fd.access_key = ${q}
    )`);
  } else {
    const amount = parseBRLInput(q);
    if (amount.ok) alternatives.push(sql`e.amount_cents = ${amount.value}::bigint`);
  }
  return sql`(${sql.join(alternatives, sql` or `)})`;
}

/**
 * Sensível, falhando fechado: lançamento sem categoria não é sensível, mas categoria
 * preenchida que a junção não trouxe conta como sensível. Nunca nulo. Os apelidos são texto
 * fixo do código.
 */
export function sensitiveExpression(entryAlias: string, categoryAlias: string): string {
  return `(${entryAlias}.category_id is not null and ${categoryAlias}.is_sensitive is not false)`;
}

const IS_SENSITIVE = sql.raw(sensitiveExpression("e", "c"));

/**
 * Canal de origem. Sem versão 1 de criação vale `system`; o SELECT e o filtro usam esta
 * mesma expressão.
 */
const ORIGIN_CHANNEL = sql.raw("coalesce(v1.channel, 'system')");

/**
 * `visible`: o que o ator enxerga. `restricted`: os sensíveis que casam com os mesmos filtros
 * e que ele não enxerga (só para o aviso do RF22.Obs7).
 */
type Sensitivity = "visible" | "restricted";

/**
 * O recorte (1.6 do desenho): unidade, autor e sensível. É a única definição; a lista, os
 * totais e o detalhe passam por aqui.
 */
function scopeConditions(scope: EntryScope, sensitivity: Sensitivity): SQL[] {
  const where: SQL[] = [];
  // `"all"` é a única forma de ficar sem filtro de unidade.
  if (scope.unitIds !== "all") {
    where.push(sql`e.unit_id = any(${arrayLiteral(scope.unitIds)}::uuid[])`);
  }
  // Lançador: só os próprios (RF22.R3).
  if (scope.ownerUserId !== null) where.push(sql`e.created_by = ${scope.ownerUserId}::uuid`);
  if (sensitivity === "restricted") {
    where.push(sql`${IS_SENSITIVE}`);
  } else if (!scope.includeSensitive) {
    where.push(sql`not ${IS_SENSITIVE}`);
  }
  return where;
}

/**
 * Condições do aviso de valores restritos (RF22.Obs7, DD-39): só período e recorte (unidade e
 * sensível). Busca, tipo, categoria, valor, fornecedor e autor ficam de fora de propósito: com
 * eles, filtrar e olhar o aviso revelaria dado de folha a quem não pode vê-lo.
 */
function restrictedNoticeConditions(scope: EntryScope, query: EntryListQuery): SQL {
  return sql.join(
    [
      sql`e.deleted_at is null`,
      sql`e.occurred_on between ${query.from}::date and ${query.to}::date`,
      ...scopeConditions(scope, "restricted"),
    ],
    sql` and `,
  );
}

/**
 * Condições comuns à lista e aos totais: recorte e filtros do RF22. Fora daqui só entram o
 * cursor e a ordenação.
 */
function conditions(scope: EntryScope, query: EntryListQuery, sensitivity: Sensitivity): SQL {
  const where: SQL[] = [
    sql`e.deleted_at is null`,
    sql`e.occurred_on between ${query.from}::date and ${query.to}::date`,
    ...scopeConditions(scope, sensitivity),
  ];

  // O filtro "lançado por" enviado por um lançador é ignorado (RF22.R3).
  if (scope.ownerUserId === null && query.createdBy !== undefined) {
    where.push(sql`e.created_by = ${query.createdBy}::uuid`);
  }

  if (query.type !== undefined) where.push(sql`e.type = ${query.type}`);
  if (query.categoryIds !== undefined) {
    where.push(sql`e.category_id = any(${arrayLiteral(query.categoryIds)}::uuid[])`);
  }
  if (query.supplierId !== undefined) where.push(sql`e.supplier_id = ${query.supplierId}::uuid`);
  if (query.paymentMethodId !== undefined) {
    where.push(sql`e.payment_method_id = ${query.paymentMethodId}::uuid`);
  }
  if (query.salesChannelId !== undefined) {
    where.push(sql`e.sales_channel_id = ${query.salesChannelId}::uuid`);
  }
  if (query.originChannel !== undefined)
    where.push(sql`${ORIGIN_CHANNEL} = ${query.originChannel}`);
  if (query.flags !== undefined) {
    // Basta um dos sinais pedidos (RF22.R4).
    where.push(sql`e.flags && ${arrayLiteral(query.flags)}::text[]`);
  }
  if (query.q !== undefined) where.push(searchCondition(query.q));

  return sql.join(where, sql` and `);
}

/**
 * Junções de um para um (nenhuma multiplica linha). O isolamento entre empresas vem do RLS
 * de cada tabela; a origem é o canal da versão 1 (`action = 'create'`) em `entry_versions`.
 */
const FIRST_VERSION_JOIN = `
  left join entry_versions v1
    on v1.tenant_id = e.tenant_id and v1.entry_id = e.id and v1.version = 1
   and v1.action = 'create'
`;

const FROM = sql.raw(`
  from entries e
  join units u on u.tenant_id = e.tenant_id and u.id = e.unit_id
  left join categories c on c.id = e.category_id
  left join suppliers s on s.tenant_id = e.tenant_id and s.id = e.supplier_id
  left join payment_methods pm on pm.tenant_id = e.tenant_id and pm.id = e.payment_method_id
  left join sales_channels sc on sc.tenant_id = e.tenant_id and sc.id = e.sales_channel_id
  left join users cu on cu.id = e.created_by
  ${FIRST_VERSION_JOIN}
`);

/** Instante em UTC com microssegundos, no mesmo formato de `CREATED_AT_TEXT`. */
function isoInstant(column: string): string {
  return `to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
}

/** Colunas da linha da lista, sem o valor do cursor. */
const ROW_COLUMNS = sql`
  e.id, e.version, e.type,
  e.occurred_on::text as occurred_on, e.paid_on::text as paid_on,
  e.description, e.quantity::text as quantity, e.quantity_unit, e.orders,
  e.amount_cents::text as amount_cents, e.fee_cents::text as fee_cents,
  e.net_cents::text as net_cents,
  c.id as category_id, c.name as category_name,
  ${IS_SENSITIVE} as category_is_sensitive,
  s.id as supplier_id, s.name as supplier_name,
  pm.id as payment_method_id, pm.name as payment_method_name,
  sc.id as sales_channel_id, sc.name as sales_channel_name,
  u.id as unit_id, u.name as unit_name,
  e.created_by, cu.name as created_by_name,
  ${ORIGIN_CHANNEL} as origin_channel,
  e.flags,
  ${sql.raw(CREATED_AT_TEXT)} as created_at,
  ${sql.raw(isoInstant("e.deleted_at"))} as deleted_at
`;

// ---------------------------------------------------------------------------------------
// Conversão das linhas
// ---------------------------------------------------------------------------------------

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);

/** Centavos do banco (texto de `bigint` ou `numeric`) para `number`, sem passar por float. */
export function toCents(text: string): number {
  const value = BigInt(text);
  if (value > MAX_SAFE || value < -MAX_SAFE) {
    throw new RangeError("entryReader: valor em centavos fora do inteiro seguro");
  }
  return Number(value);
}

type Ref = { id: string; name: string };

function ref(id: string | null, name: string | null): Ref | null {
  return id === null ? null : { id, name: name ?? "" };
}

/** Tudo que é data, instante ou dinheiro sai do banco já como texto. */
interface RawRow extends Record<string, unknown> {
  id: string;
  version: number;
  type: string;
  occurred_on: string;
  paid_on: string;
  description: string;
  quantity: string | null;
  quantity_unit: string | null;
  orders: number | null;
  amount_cents: string;
  fee_cents: string;
  net_cents: string;
  category_id: string | null;
  category_name: string | null;
  category_is_sensitive: boolean;
  supplier_id: string | null;
  supplier_name: string | null;
  payment_method_id: string | null;
  payment_method_name: string | null;
  sales_channel_id: string | null;
  sales_channel_name: string | null;
  unit_id: string;
  unit_name: string;
  created_by: string;
  created_by_name: string | null;
  origin_channel: string;
  flags: string[];
  created_at: string;
  deleted_at: string | null;
}

interface RawListRow extends RawRow {
  cursor_value: string;
}

interface RawDetailRow extends RawRow {
  fee_percent_bp: number;
  fee_fixed_cents: string;
  updated_at: string;
  deleted_by: string | null;
  deleted_by_name: string | null;
  delete_reason: string | null;
  restorable_until: string | null;
}

interface RawVersion extends Record<string, unknown> {
  version: number;
  action: string;
  channel: string;
  changed_by: string;
  changed_by_name: string | null;
  changed_at: string;
  before: unknown;
  after: unknown;
}

interface RawSource extends Record<string, unknown> {
  channel: string;
  message_id: string | null;
  message_type: string | null;
  text: string | null;
  transcription: string | null;
  access_key: string | null;
  sent_by: string | null;
  sent_by_name: string | null;
  sent_at: string | null;
  siblings_sensitive: boolean;
}

interface RawName extends Record<string, unknown> {
  id: string;
  name: string;
}

interface RawCategory extends RawName {
  kind: string;
  parent_id: string | null;
  requires_quantity: boolean;
  is_sensitive: boolean;
  /** Só nas opções do formulário (F3c-2). */
  active?: boolean;
}

interface RawActive extends RawName {
  active: boolean;
}

interface RawUnit extends RawActive {
  default_sales_channel_id: string | null;
  timezone: string;
}

const MEDIA_KINDS: Record<string, SourceKind> = { text: "text", audio: "audio", image: "image" };

function toRefs(rows: readonly RawName[]): Ref[] {
  return rows.map((row) => ({ id: row.id, name: row.name }));
}

function toNameMap(rows: readonly RawName[]): Map<string, string> {
  return new Map(rows.map((row) => [row.id, row.name]));
}

function toEntryRow(raw: RawRow): EntryRow {
  return {
    id: raw.id,
    version: raw.version,
    type: raw.type as EntryRow["type"],
    occurredOn: raw.occurred_on,
    paidOn: raw.paid_on,
    description: raw.description,
    // Quantidade não é dinheiro: `numeric(14,3)` cabe em `number`.
    quantity: raw.quantity === null ? null : Number(raw.quantity),
    quantityUnit: raw.quantity_unit,
    orders: raw.orders,
    amountCents: toCents(raw.amount_cents),
    feeCents: toCents(raw.fee_cents),
    netCents: toCents(raw.net_cents),
    category: ref(raw.category_id, raw.category_name),
    supplier: ref(raw.supplier_id, raw.supplier_name),
    paymentMethod: ref(raw.payment_method_id, raw.payment_method_name),
    salesChannel: ref(raw.sales_channel_id, raw.sales_channel_name),
    unit: { id: raw.unit_id, name: raw.unit_name },
    createdBy: { id: raw.created_by, name: raw.created_by_name ?? "" },
    originChannel: raw.origin_channel as EntryRow["originChannel"],
    flags: raw.flags as EntryRow["flags"],
    createdAt: raw.created_at,
    categoryIsSensitive: raw.category_is_sensitive,
    createdById: raw.created_by,
    deletedAt: raw.deleted_at,
  };
}

/** Linha da lixeira: a da lista mais os dados da exclusão (RF24). */
export interface TrashRow extends EntryRow {
  deleted: EntryDeleted;
}

interface RawTrashRow extends RawRow {
  deleted_by: string;
  deleted_by_name: string | null;
  delete_reason: string | null;
  restorable_until: string;
}

function encodeTrashCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify({ s: "trash", v: cursor.v, id: cursor.id }), "utf8").toString(
    "base64url",
  );
}

/** Mesma conferência do cursor da lista: nada malformado chega ao SQL. */
function decodeTrashCursor(text: string): Cursor {
  if (text.length > ENTRY_CURSOR_MAX) throw new InvalidCursorError();
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(text, "base64url").toString("utf8"));
  } catch {
    throw new InvalidCursorError();
  }
  if (typeof payload !== "object" || payload === null) throw new InvalidCursorError();
  const { s, v, id } = payload as Record<string, unknown>;
  if (s !== "trash" || typeof v !== "string" || typeof id !== "string") {
    throw new InvalidCursorError();
  }
  if (!UUID_VALUE.test(id) || !isCreatedAtText(v)) throw new InvalidCursorError();
  return { v, id };
}

interface RawTotals extends Record<string, unknown> {
  revenue_cents: string;
  expense_cents: string;
  count: number;
}

// ---------------------------------------------------------------------------------------
// Leitor
// ---------------------------------------------------------------------------------------

/**
 * Consultas de leitura dos lançamentos do painel (RF22). Rodam na transação de `withTenant`;
 * quem chama já resolveu o recorte com `entryScopeFor`.
 */
/**
 * Teto de linhas dos candidatos de duplicidade (F3c-4): os mais recentes da janela. Sozinho o
 * painel nunca chega perto; a importação em massa (F13) deve pré-filtrar por valor e data.
 */
export const RECENT_LIMIT = 2000;

export const entryReader = {
  /**
   * Página da lista. `nextCursor` é nulo na última página.
   * @throws InvalidCursorError quando o cursor não é deste leitor ou é de outra ordenação.
   */
  async list(
    tx: Transaction,
    scope: EntryScope,
    query: EntryListQuery,
  ): Promise<{ rows: EntryRow[]; nextCursor: string | null }> {
    const sort = SORTS[query.sort];
    const direction = query.dir === "asc" ? "asc" : "desc";
    const cursor =
      query.cursor === undefined ? null : decodeCursor(query.cursor, query.sort, query.dir);

    let where = conditions(scope, query, "visible");
    if (cursor !== null) {
      // Comparação de tupla (coluna, id): continua exatamente depois da última linha entregue.
      const after = sql.raw(direction === "asc" ? ">" : "<");
      const value = sql`${cursor.v}::${sql.raw(sort.cast)}`;
      where = sql`${where} and (${sql.raw(sort.column)}, e.id) ${after} (${value}, ${cursor.id}::uuid)`;
    }

    const result = await tx.execute<RawListRow>(sql`
      select ${ROW_COLUMNS},
             ${sql.raw(sort.asText)} as cursor_value
      ${FROM}
      where ${where}
      order by ${sql.raw(`${sort.column} ${direction}, e.id ${direction}`)}
      limit ${query.limit + 1}
    `);

    // Uma linha a mais só para saber se existe próxima página.
    const page = result.rows.slice(0, query.limit);
    const last = page.at(-1);
    const nextCursor =
      result.rows.length > query.limit && last !== undefined
        ? encodeCursor(query.sort, query.dir, { v: last.cursor_value, id: last.id })
        : null;
    return { rows: page.map(toEntryRow), nextCursor };
  },

  /**
   * Totais do filtro, somados pelo banco sobre o valor bruto (RF22.Obs2). Não somam os
   * sensíveis que o ator não vê; `hasRestricted` só diz que eles existem no período e nas
   * unidades consultados, sem olhar os demais filtros (RF22.Obs7, DD-39).
   * `cursor`, `limit`, `sort` e `dir` não entram.
   */
  async totals(tx: Transaction, scope: EntryScope, query: EntryListQuery): Promise<EntryTotalsRow> {
    const result = await tx.execute<RawTotals>(sql`
      select coalesce(sum(e.amount_cents) filter (where e.type = 'revenue'), 0)::text as revenue_cents,
             coalesce(sum(e.amount_cents) filter (where e.type = 'expense'), 0)::text as expense_cents,
             count(*)::int as count
      ${FROM}
      where ${conditions(scope, query, "visible")}
    `);
    const row = result.rows[0];

    // O lançador só vê os próprios: nunca recebe o aviso.
    let hasRestricted = false;
    if (!scope.includeSensitive && scope.ownerUserId === null) {
      const restricted = await tx.execute(sql`
        select 1 ${FROM} where ${restrictedNoticeConditions(scope, query)} limit 1
      `);
      hasRestricted = restricted.rows.length > 0;
    }

    return {
      revenueCents: toCents(row?.revenue_cents ?? "0"),
      expenseCents: toCents(row?.expense_cents ?? "0"),
      count: row?.count ?? 0,
      hasRestricted,
    };
  },

  /**
   * Detalhe de um lançamento dentro do recorte, inclusive na lixeira enquanto for restaurável
   * (`restorable_until >= today`, RF24.R2). Devolve `null` sem dizer o motivo quando o
   * lançamento não existe, é de outra empresa, está fora do recorte (unidade, autor, sensível
   * sem permissão) ou na lixeira vencida: a rota responde 404 em todos os casos.
   *
   * @param today Data de negócio `AAAA-MM-DD` de quem chama (hoje no fuso da unidade).
   * @throws RangeError quando `today` não é uma data de negócio válida.
   */
  async find(
    tx: Transaction,
    scope: EntryScope,
    id: string,
    today: string,
  ): Promise<EntryDetailRow | null> {
    if (!isBusinessDate(today)) throw new RangeError("entryReader: data de hoje inválida");
    // Id malformado derrubaria a transação na conversão para `uuid`.
    if (!UUID_VALUE.test(id)) return null;

    const where = sql.join(
      [
        sql`e.id = ${id}::uuid`,
        // Lixeira sem prazo ou sem autor da exclusão não aparece (falha fechado).
        sql`(e.deleted_at is null
             or (e.restorable_until >= ${today}::date and e.deleted_by is not null))`,
        ...scopeConditions(scope, "visible"),
      ],
      sql` and `,
    );
    const result = await tx.execute<RawDetailRow>(sql`
      select ${ROW_COLUMNS},
             e.fee_percent_bp, e.fee_fixed_cents::text as fee_fixed_cents,
             ${sql.raw(isoInstant("e.updated_at"))} as updated_at,
             e.deleted_by, du.name as deleted_by_name, e.delete_reason,
             e.restorable_until::text as restorable_until
      ${FROM}
      left join users du on du.id = e.deleted_by
      where ${where}
      limit 1
    `);
    const raw = result.rows[0];
    if (raw === undefined) return null;

    const deleted: EntryDeleted | null =
      raw.deleted_at === null || raw.deleted_by === null || raw.restorable_until === null
        ? null
        : {
            at: raw.deleted_at,
            by: { id: raw.deleted_by, name: raw.deleted_by_name ?? "" },
            reason: raw.delete_reason,
            restorableUntil: raw.restorable_until,
          };
    return {
      ...toEntryRow(raw),
      feePercentBp: raw.fee_percent_bp,
      feeFixedCents: toCents(raw.fee_fixed_cents),
      updatedAt: raw.updated_at,
      deleted,
    };
  },

  /**
   * Histórico do lançamento em ordem crescente de versão, com `before` e `after` como estão
   * no banco (RF25.R4).
   *
   * PRÉ-CONDIÇÃO: não recebe recorte. Só chame depois de `find` ter devolvido este lançamento
   * para o ator; sozinha, esta função entrega o histórico de qualquer lançamento da empresa,
   * inclusive os sensíveis. `before` e `after` podem citar categoria sensível anterior: quem
   * chama monta o diff e decide o que é restrito.
   */
  async versions(tx: Transaction, entryId: string): Promise<EntryVersionRow[]> {
    if (!UUID_VALUE.test(entryId)) return [];
    const result = await tx.execute<RawVersion>(sql`
      select v.version, v.action, v.channel, v.changed_by, vu.name as changed_by_name,
             ${sql.raw(isoInstant("v.changed_at"))} as changed_at,
             v.before, v.after
        from entry_versions v
        left join users vu on vu.id = v.changed_by
       where v.entry_id = ${entryId}::uuid
       order by v.version asc
    `);
    return result.rows.map((raw) => ({
      version: raw.version,
      action: raw.action,
      channel: raw.channel,
      changedBy: { id: raw.changed_by, name: raw.changed_by_name ?? "" },
      changedAt: raw.changed_at,
      before: raw.before,
      after: raw.after,
    }));
  },

  /**
   * Origem do lançamento (RF25): canal, mensagem original, chave da nota, quem enviou e
   * quando. Sem mensagem de origem, `kind` é `none`. Nunca devolve o local do arquivo de
   * mídia. `null` quando o lançamento não existe nesta empresa.
   *
   * PRÉ-CONDIÇÃO: não recebe recorte. Só chame depois de `find` ter devolvido este lançamento
   * para o ator. O texto e a transcrição vêm sempre: quando `siblingsSensitive` é verdadeiro
   * e o ator não vê sensíveis, quem chama tem de omiti-los (RF25.Obs1).
   *
   * `siblingsSensitive` olha os outros lançamentos da mesma mensagem, inclusive os que estão
   * na lixeira (o texto continua citando o dado), com a mesma noção de sensível do recorte.
   */
  async source(tx: Transaction, entryId: string): Promise<EntrySourceRow | null> {
    if (!UUID_VALUE.test(entryId)) return null;
    const result = await tx.execute<RawSource>(sql`
      select ${ORIGIN_CHANNEL} as channel,
             im.id as message_id, im.type as message_type, im.text, im.transcription,
             (select fd.access_key from fiscal_documents fd
               where fd.tenant_id = e.tenant_id and fd.inbound_message_id = im.id
               order by fd.created_at, fd.id limit 1) as access_key,
             im.user_id as sent_by, su.name as sent_by_name,
             ${sql.raw(isoInstant("im.received_at"))} as sent_at,
             exists (
               select 1 from entries e2
                 left join categories c2 on c2.id = e2.category_id
                where e2.tenant_id = e.tenant_id
                  and e2.inbound_message_id = e.inbound_message_id
                  and e2.id <> e.id
                  and ${sql.raw(sensitiveExpression("e2", "c2"))}
             ) as siblings_sensitive
        from entries e
        ${sql.raw(FIRST_VERSION_JOIN)}
        left join inbound_messages im
          on im.tenant_id = e.tenant_id and im.id = e.inbound_message_id
        left join users su on su.id = im.user_id
       where e.id = ${entryId}::uuid
       limit 1
    `);
    const raw = result.rows[0];
    if (raw === undefined) return null;
    if (raw.message_id === null) {
      return {
        channel: raw.channel,
        kind: "none",
        text: null,
        transcription: null,
        accessKey: null,
        sentBy: null,
        sentAt: null,
        siblingsSensitive: raw.siblings_sensitive,
      };
    }
    return {
      channel: raw.channel,
      kind: MEDIA_KINDS[raw.message_type ?? ""] ?? "none",
      text: raw.text,
      transcription: raw.transcription,
      accessKey: raw.access_key,
      sentBy: raw.sent_by === null ? null : { id: raw.sent_by, name: raw.sent_by_name ?? "" },
      sentAt: raw.sent_at,
      siblingsSensitive: raw.siblings_sensitive,
    };
  },

  /**
   * Carga para escrita (edição, exclusão, restauração): os lançamentos pedidos que o ator
   * enxerga no recorte, inclusive os da lixeira ainda restaurável (`restorable_until >= today`).
   * Quem está fora do recorte, é de outra empresa ou venceu na lixeira simplesmente não vem:
   * a rota responde 404. `categoryIsSensitive` falha fechado (`sensitiveExpression`).
   * Ids malformados são descartados; a ordem do resultado é a do id.
   *
   * @param today Data de negócio `AAAA-MM-DD` de quem chama (hoje no fuso da unidade).
   * @throws RangeError quando `today` não é uma data de negócio válida.
   */
  async load(
    tx: Transaction,
    scope: EntryScope,
    ids: readonly string[],
    today: string,
  ): Promise<Array<{ entry: Entry; categoryIsSensitive: boolean }>> {
    if (!isBusinessDate(today)) throw new RangeError("entryReader: data de hoje inválida");
    const valid = [...new Set(ids.filter((id) => UUID_VALUE.test(id)))];
    if (valid.length === 0) return [];

    // Os apelidos "e" e "c" são os que `scopeConditions` e `sensitiveExpression` esperam.
    const e = alias(entries, "e");
    const c = alias(categories, "c");
    const rows = await tx
      .select({ row: e, sensitive: sql<boolean>`${IS_SENSITIVE}` })
      .from(e)
      .leftJoin(c, eq(c.id, e.categoryId))
      .where(
        sql.join(
          [
            sql`e.id = any(${arrayLiteral(valid)}::uuid[])`,
            sql`(e.deleted_at is null
                 or (e.restorable_until >= ${today}::date and e.deleted_by is not null))`,
            ...scopeConditions(scope, "visible"),
          ],
          sql` and `,
        ),
      )
      .orderBy(e.id);
    return rows.map(({ row, sensitive }) => ({
      entry: toEntry(row),
      categoryIsSensitive: sensitive,
    }));
  },

  /**
   * Lixeira (RF24.R2): excluídos ainda restauráveis (`restorable_until >= today`, inclusive),
   * dentro do recorte, na ordem `deleted_at` decrescente e id. O período filtra o dia da
   * exclusão no fuso da unidade (`units.timezone`). Lixeira sem autor da exclusão não aparece.
   *
   * @throws InvalidCursorError quando o cursor não é deste leitor.
   * @throws RangeError quando `today` não é uma data de negócio válida.
   */
  async trash(
    tx: Transaction,
    scope: EntryScope,
    query: TrashQuery,
    today: string,
  ): Promise<{ rows: TrashRow[]; nextCursor: string | null }> {
    if (!isBusinessDate(today)) throw new RangeError("entryReader: data de hoje inválida");
    const where: SQL[] = [
      sql`e.deleted_at is not null`,
      sql`e.deleted_by is not null`,
      sql`e.restorable_until >= ${today}::date`,
      sql`(e.deleted_at at time zone u.timezone)::date
          between ${query.deletedFrom}::date and ${query.deletedTo}::date`,
      ...scopeConditions(scope, "visible"),
    ];
    if (query.unitIds !== undefined) {
      where.push(sql`e.unit_id = any(${arrayLiteral(query.unitIds)}::uuid[])`);
    }
    if (query.deletedBy !== undefined) where.push(sql`e.deleted_by = ${query.deletedBy}::uuid`);
    if (query.cursor !== undefined) {
      const cursor = decodeTrashCursor(query.cursor);
      where.push(sql`(e.deleted_at, e.id) < (${cursor.v}::timestamptz, ${cursor.id}::uuid)`);
    }

    const result = await tx.execute<RawTrashRow>(sql`
      select ${ROW_COLUMNS},
             e.deleted_by, du.name as deleted_by_name, e.delete_reason,
             e.restorable_until::text as restorable_until
      ${FROM}
      left join users du on du.id = e.deleted_by
      where ${sql.join(where, sql` and `)}
      order by e.deleted_at desc, e.id desc
      limit ${query.limit + 1}
    `);
    const page = result.rows.slice(0, query.limit);
    const last = page.at(-1);
    let nextCursor: string | null = null;
    if (result.rows.length > query.limit && last !== undefined) {
      // A consulta só devolve excluídos; nulo aqui seria bug, e descartar o cursor em silêncio
      // faria a paginação parar sem aviso.
      if (last.deleted_at === null) throw new Error("entryReader: excluído sem deleted_at");
      nextCursor = encodeTrashCursor({ v: last.deleted_at, id: last.id });
    }
    return {
      rows: page.map((raw) => ({
        ...toEntryRow(raw),
        deleted: {
          at: raw.deleted_at ?? "",
          by: { id: raw.deleted_by, name: raw.deleted_by_name ?? "" },
          reason: raw.delete_reason,
          restorableUntil: raw.restorable_until,
        },
      })),
      nextCursor,
    };
  },

  /**
   * Quantidade e soma do valor bruto dos ids, calculadas pelo banco (RF24.Obs3), só do que o
   * ator enxerga: mesmo recorte, mesma noção de sensível (falha fechado) e mesmo prazo da
   * lixeira de `load`. O que está fora não entra na soma nem na contagem.
   *
   * @param today Data de negócio `AAAA-MM-DD` de quem chama (hoje no fuso da unidade).
   * @throws RangeError quando `today` não é uma data de negócio válida.
   */
  async sum(
    tx: Transaction,
    scope: EntryScope,
    ids: readonly string[],
    today: string,
  ): Promise<{ count: number; totalCents: number }> {
    if (!isBusinessDate(today)) throw new RangeError("entryReader: data de hoje inválida");
    const valid = [...new Set(ids.filter((id) => UUID_VALUE.test(id)))];
    if (valid.length === 0) return { count: 0, totalCents: 0 };
    const result = await tx.execute<{ count: number; total_cents: string }>(sql`
      select count(*)::int as count, coalesce(sum(e.amount_cents), 0)::text as total_cents
        from entries e
        left join categories c on c.id = e.category_id
       where ${sql.join(
         [
           sql`e.id = any(${arrayLiteral(valid)}::uuid[])`,
           sql`(e.deleted_at is null
                or (e.restorable_until >= ${today}::date and e.deleted_by is not null))`,
           ...scopeConditions(scope, "visible"),
         ],
         sql` and `,
       )}
    `);
    const row = result.rows[0];
    return { count: row?.count ?? 0, totalCents: toCents(row?.total_cents ?? "0") };
  },

  /**
   * Candidatos à possível duplicidade (RF26.R4, RF12.R13): lançamentos criados depois de
   * `since` (por `created_at`, não por data de negócio), fora da lixeira, nas unidades do
   * recorte. Inclui os dos colegas: `scope.ownerUserId` é ignorado de propósito (o lançador
   * também compara com a unidade inteira). Categoria sensível fica de fora quando o recorte
   * não a inclui (`sensitiveExpression`, falha fechado). Só devolve os campos da comparação.
   */
  async recent(
    tx: Transaction,
    scope: EntryScope,
    since: Date,
    limit: number = RECENT_LIMIT,
  ): Promise<readonly RecentEntry[]> {
    const where: SQL[] = [
      sql`e.deleted_at is null`,
      sql`e.created_at > ${since.toISOString()}::timestamptz`,
    ];
    if (scope.unitIds !== "all") {
      where.push(sql`e.unit_id = any(${arrayLiteral(scope.unitIds)}::uuid[])`);
    }
    if (!scope.includeSensitive) where.push(sql`not ${IS_SENSITIVE}`);
    const result = await tx.execute<{
      inbound_message_id: string | null;
      amount_cents: string;
      supplier_id: string | null;
      description: string;
      occurred_on: string;
    }>(sql`
      select e.inbound_message_id, e.amount_cents::text as amount_cents, e.supplier_id,
             e.description, e.occurred_on::text as occurred_on
        from entries e
        left join categories c on c.id = e.category_id
       where ${sql.join(where, sql` and `)}
       order by e.created_at desc, e.id desc
       limit ${Math.max(1, Math.floor(limit))}
    `);
    return result.rows.map((raw) => ({
      inboundMessageId: raw.inbound_message_id,
      amountCents: toCents(raw.amount_cents),
      supplierId: raw.supplier_id,
      description: raw.description,
      occurredOn: raw.occurred_on,
    }));
  },

  /**
   * Opções dos filtros da lista. Categorias sensíveis só para quem as vê; autores ("lançado
   * por") só os que têm lançamento no recorte, e nenhum para o lançador. Não filtra cadastro inativo: o
   * filtro precisa achar lançamento antigo.
   *
   * `units` devolve as unidades de `scope.unitIds`: passe o recorte com as unidades de
   * ACESSO do ator, não as do filtro de uma consulta.
   */
  async options(tx: Transaction, scope: EntryScope): Promise<EntryOptions> {
    const categories = await tx.execute<RawCategory>(sql`
      select id, name, kind, parent_id, requires_quantity, is_sensitive, status = 'active' as active
        from categories
       where ${scope.includeSensitive ? sql`true` : sql`is_sensitive is false`}
       order by name, id
    `);
    const suppliers = await tx.execute<RawName>(
      sql`select id, name from suppliers order by name, id`,
    );
    // Cadastro inativo continua na lista (o filtro precisa achar lançamento antigo); o
    // formulário de criação usa `active` para não oferecê-lo (F3c-2).
    const paymentMethods = await tx.execute<RawActive>(
      sql`select id, name, status = 'active' as active from payment_methods order by name, id`,
    );
    const salesChannels = await tx.execute<RawActive>(
      sql`select id, name, status = 'active' as active from sales_channels order by name, id`,
    );
    const units = await tx.execute<RawUnit>(sql`
      select id, name, status = 'active' as active, default_sales_channel_id, timezone from units
       where ${scope.unitIds === "all" ? sql`true` : sql`id = any(${arrayLiteral(scope.unitIds)}::uuid[])`}
       order by name, id
    `);
    const members =
      scope.ownerUserId !== null
        ? []
        : // Só quem tem lançamento dentro do recorte de quem consulta (unidades de acesso,
          // sem folha para quem não a vê): não lista contador sem lançamento, colega de
          // outra unidade nem autor que só lançou folha (F3-4, DD-39).
          (
            await tx.execute<RawName>(sql`
              select mu.id, mu.name
                from users mu
               where exists (
                 select 1
                   from entries e
                   left join categories c on c.id = e.category_id
                  where e.created_by = mu.id
                    and e.deleted_at is null
                    and ${sql.join([sql`true`, ...scopeConditions(scope, "visible")], sql` and `)}
               )
               order by mu.name, mu.id
            `)
          ).rows;

    return {
      categories: categories.rows.map((row) => ({
        id: row.id,
        name: row.name,
        kind: row.kind as EntryOptions["categories"][number]["kind"],
        parentId: row.parent_id,
        requiresQuantity: row.requires_quantity,
        active: row.active,
      })),
      suppliers: toRefs(suppliers.rows),
      paymentMethods: paymentMethods.rows.map((row) => ({
        id: row.id,
        name: row.name,
        active: row.active,
      })),
      salesChannels: salesChannels.rows.map((row) => ({
        id: row.id,
        name: row.name,
        active: row.active,
      })),
      units: units.rows.map((row) => ({
        id: row.id,
        name: row.name,
        active: row.active,
        defaultSalesChannelId: row.default_sales_channel_id,
        timezone: row.timezone,
      })),
      members: toRefs(members),
    };
  },

  /**
   * Nomes de todos os cadastros da empresa, por id, para trocar ids por nomes no histórico.
   *
   * PRÉ-CONDIÇÃO: não recebe recorte e inclui as categorias sensíveis (com `isSensitive`).
   * É insumo para montar o diff de um lançamento que `find` já devolveu; nunca vai inteiro
   * para a resposta.
   */
  async names(tx: Transaction): Promise<EntryNames> {
    const categories = await tx.execute<RawCategory>(
      sql`select id, name, kind, parent_id, requires_quantity, is_sensitive from categories`,
    );
    const suppliers = await tx.execute<RawName>(sql`select id, name from suppliers`);
    const paymentMethods = await tx.execute<RawName>(sql`select id, name from payment_methods`);
    const salesChannels = await tx.execute<RawName>(sql`select id, name from sales_channels`);
    const units = await tx.execute<RawName>(sql`select id, name from units`);
    return {
      categories: new Map(
        categories.rows.map((row) => [row.id, { name: row.name, isSensitive: row.is_sensitive }]),
      ),
      suppliers: toNameMap(suppliers.rows),
      paymentMethods: toNameMap(paymentMethods.rows),
      salesChannels: toNameMap(salesChannels.rows),
      units: toNameMap(units.rows),
    };
  },
};
