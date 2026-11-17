import { createEntry, editEntry, type Money } from "@app/core";
import {
  batchPreviewSchema,
  type EntryDetail,
  type EntryListResponse,
  type EntryOptions,
  type EntrySource,
  type EntryTotals,
  entryDetailSchema,
  entryListResponseSchema,
  entryOptionsSchema,
  entrySourceSchema,
  entryStaleSchema,
  entryTotalsSchema,
  type TrashResponse,
  trashResponseSchema,
} from "@app/core/contracts";
import { createDatabase, createEntryStore, uuidv7 } from "@app/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type AuthHarness, startAuthHarness } from "./support/auth-harness";
import { type MatrixFixture, PERSONAS, type Persona, ROUTE_MATRIX } from "./support/route-matrix";

const PASSWORD = "senhaForte1";
const CTX = "__Secure-fr_ctx";
const PERIOD = "from=2026-11-01&to=2026-11-30";
let FIXTURE: MatrixFixture;

/** Texto com marcação: tem de voltar intacto, como string (RF25.R1). */
const SCRIPT = '<script>alert("x")</script> & <b>negrito</b>';
const OLD_PAYROLL_TEXT = "Salário antigo do João";
/** Mensagem que gerou o lançamento quando ele ainda era de folha. */
const OLD_PAYROLL_MESSAGE = "3100 salário do João";
const SHARED_MESSAGE_TEXT = "50 de gás e 1800 do salário da Maria";
const ACCESS_KEY = "35261112345678000195650010000012341000012345";
/** Os lançamentos do detalhe ficam em outubro, fora do período das listas (novembro). */
const OCTOBER = "2026-10-15";
/** O relógio do harness começa em 09/11/2026 12:00 UTC e este arquivo não o adianta. */
const TODAY = "2026-11-09";
const YESTERDAY = "2026-11-08";

const SECRET_B = "Segredo da empresa B";
const PAYROLL_TEXT = "Salário da cozinheira";

let h: AuthHarness;
let ipCounter = 0;
const nextIp = () => `10.8.${Math.floor(ipCounter / 250)}.${++ipCounter % 250}`;

interface PersonaSession {
  userId: string;
  session: string;
  /** Valor do `fr_ctx` e do `X-Context`; a sessão restrita não tem. */
  ctx?: string;
}

let personas: Record<Persona, PersonaSession>;
/** Dono da empresa B, para provar o isolamento nos dois sentidos. */
let ownerB: PersonaSession;

// Empresa A: três unidades; os gerentes acessam a 1 e a 2, o lançador só a 1.
let tenantA: string;
let unit1: string;
let unit2: string;
let unit3: string;
let categoryA: string;
let payrollA: string;
// Empresa B.
let tenantB: string;
let unitB: string;
let categoryB: string;
let entryB: string;

/** Lançamentos da empresa A, todos em 11/2026. */
let e1: string; // despesa, unidade 1, do dono, R$ 100,00
let e2: string; // receita, unidade 1, do lançador, R$ 500,00
let e3: string; // despesa, unidade 2, do gerente, R$ 30,00
let e4: string; // despesa, unidade 3, do dono, R$ 7,00
let e5: string; // folha, unidade 1, do dono, R$ 2.000,00
let e6: string; // folha, unidade 1, do lançador, R$ 15,00
/** Lançamentos de outubro, só para o detalhe e a origem. */
let movedOut: string; // unidade 1: nasceu na folha (v1), foi para Insumos (v2), valor mudou (v3)
let gas: string; // unidade 1: mesma mensagem que `salary`
let salary: string; // folha, unidade 1: mesma mensagem que `gas`
let scripted: string; // unidade 1, do lançador: áudio com marcação, na lixeira restaurável
let expired: string; // unidade 1: lixeira vencida
let invoice: string; // unidade 1: foto de nota com chave de acesso
let orphanCategory: string; // unidade 1: uma versão cita categoria que não existe mais
let entryC: string; // empresa C (somente leitura)

const admin = (sql: string, params: unknown[] = []) => h.db.admin.query(sql, params);

async function addTenant(name: string, unitNames: string[], status = "active") {
  const tenantId = uuidv7();
  await admin("insert into tenants (id, name, status) values ($1, $2, $3)", [
    tenantId,
    name,
    status,
  ]);
  const unitIds: string[] = [];
  for (const unitName of unitNames) {
    const id = uuidv7();
    await admin("insert into units (id, tenant_id, name) values ($1, $2, $3)", [
      id,
      tenantId,
      unitName,
    ]);
    unitIds.push(id);
  }
  return { tenantId, unitIds };
}

async function addCategory(tenantId: string, name: string, isSensitive = false): Promise<string> {
  const id = uuidv7();
  await admin(
    `insert into categories (id, tenant_id, name, kind, dre_group, is_sensitive)
     values ($1, $2, $3, 'expense', 'outras', $4)`,
    [id, tenantId, name, isSensitive],
  );
  return id;
}

/** Usuário com senha, sem vínculo ativo na empresa que o harness cria junto. */
async function addUser(): Promise<{ userId: string; email: string }> {
  const user = await h.createUser({ password: PASSWORD });
  await admin("update memberships set status = 'deactivated' where user_id = $1", [user.userId]);
  return user;
}

async function addMembership(
  userId: string,
  tenantId: string,
  options: {
    role: string;
    unitIds?: string[];
    permissions?: string[];
    panelAccess?: boolean;
  },
): Promise<void> {
  const id = uuidv7();
  await admin(
    `insert into memberships (id, tenant_id, user_id, role, all_units, panel_access, permissions)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      id,
      tenantId,
      userId,
      options.role,
      options.unitIds === undefined,
      options.panelAccess ?? true,
      JSON.stringify(options.permissions ?? []),
    ],
  );
  for (const unitId of options.unitIds ?? []) {
    await admin(
      "insert into membership_units (id, tenant_id, membership_id, unit_id) values ($1, $2, $3, $4)",
      [uuidv7(), tenantId, id, unitId],
    );
  }
}

/** Cada login sai de um IP diferente, para o limite por IP não entrar no caminho. */
async function login(email: string): Promise<string> {
  const response = await h.post(
    "/api/auth/sign-in/email",
    { email, password: PASSWORD },
    undefined,
    nextIp(),
  );
  expect(response.statusCode).toBe(200);
  return h.sessionCookie(response);
}

const salesChannels = new Map<string, string>();

/** Um canal de venda por empresa, criado na primeira receita. */
async function salesChannelOf(tenantId: string): Promise<string> {
  const known = salesChannels.get(tenantId);
  if (known !== undefined) return known;
  const id = uuidv7();
  await admin("insert into sales_channels (id, tenant_id, name) values ($1, $2, 'Salão')", [
    id,
    tenantId,
  ]);
  salesChannels.set(tenantId, id);
  return id;
}

async function addEntry(e: {
  tenantId: string;
  unitId: string;
  createdBy: string;
  amountCents: number;
  categoryId: string;
  type?: "expense" | "revenue";
  description?: string;
  occurredOn?: string;
  inboundMessageId?: string;
  /** Posição do lançamento dentro da mensagem de origem. */
  position?: number;
  /** Versão atual do lançamento; as versões além da 1 entram com `addVersion`. */
  version?: number;
  /** Categoria da versão 1, quando o lançamento nasceu em outra. */
  firstCategoryId?: string;
  firstDescription?: string;
  firstAmountCents?: number;
  /** Na lixeira, com a data até quando é restaurável. */
  deleted?: { by: string; reason: string | null; restorableUntil: string };
}): Promise<string> {
  const id = uuidv7();
  const type = e.type ?? "expense";
  const occurredOn = e.occurredOn ?? "2026-11-05";
  const description = e.description ?? "Lançamento";
  // Receita exige canal de venda (`entries_revenue_channel_check`).
  const salesChannelId = type === "revenue" ? await salesChannelOf(e.tenantId) : null;
  await admin(
    `insert into entries (id, tenant_id, unit_id, type, occurred_on, paid_on, description,
       amount_cents, net_cents, category_id, created_by, sales_channel_id, inbound_message_id,
       version, deleted_at, deleted_by, delete_reason, restorable_until, position)
     values ($1, $2, $3, $4, $5, $5, $6, $7, $7, $8, $9, $10, $11, $12,
       case when $13::uuid is null then null else now() end, $13, $14,
       $15::date, $16)`,
    [
      id,
      e.tenantId,
      e.unitId,
      type,
      occurredOn,
      description,
      e.amountCents,
      e.categoryId,
      e.createdBy,
      salesChannelId,
      e.inboundMessageId ?? null,
      e.version ?? 1,
      e.deleted?.by ?? null,
      e.deleted?.reason ?? null,
      e.deleted?.restorableUntil ?? null,
      e.position ?? 0,
    ],
  );
  // O `after` é o lançamento como o domínio grava em `entry_versions`.
  const first = snapshot({
    unitId: e.unitId,
    type,
    occurredOn,
    description: e.firstDescription ?? description,
    amountCents: e.firstAmountCents ?? e.amountCents,
    categoryId: e.firstCategoryId ?? e.categoryId,
    salesChannelId,
  });
  await addVersion({
    tenantId: e.tenantId,
    entryId: id,
    version: 1,
    action: "create",
    channel: "whatsapp",
    changedBy: e.createdBy,
    before: null,
    after: first,
  });
  firstSnapshots.set(id, first);
  return id;
}

type Snapshot = Record<string, unknown>;
const firstSnapshots = new Map<string, Snapshot>();

function snapshot(fields: {
  unitId: string;
  type: string;
  occurredOn: string;
  description: string;
  amountCents: number;
  categoryId: string | null;
  salesChannelId: string | null;
}): Snapshot {
  return {
    ...fields,
    paidOn: fields.occurredOn,
    quantity: null,
    quantityUnit: null,
    orders: null,
    feePercentBp: 0,
    feeFixedCents: 0,
    feeCents: 0,
    netCents: fields.amountCents,
    supplierId: null,
    paymentMethodId: null,
    flags: [],
    deleteReason: null,
  };
}

async function addVersion(v: {
  tenantId: string;
  entryId: string;
  version: number;
  action: "create" | "update" | "delete" | "restore";
  channel: string;
  changedBy: string;
  before: Snapshot | null;
  after: Snapshot;
}): Promise<void> {
  await admin(
    `insert into entry_versions (id, tenant_id, entry_id, version, action, before, after,
       changed_by, channel)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)`,
    [
      uuidv7(),
      v.tenantId,
      v.entryId,
      v.version,
      v.action,
      v.before === null ? null : JSON.stringify(v.before),
      JSON.stringify(v.after),
      v.changedBy,
      v.channel,
    ],
  );
}

async function addMessage(m: {
  tenantId: string;
  userId: string;
  type: "text" | "audio" | "image";
  text?: string;
  transcription?: string;
}): Promise<string> {
  const id = uuidv7();
  await admin(
    `insert into inbound_messages (id, tenant_id, user_id, wa_message_id, type, text,
       transcription, media_key, raw, status)
     values ($1, $2, $3, $4, $5, $6, $7, $8, '{}', 'processed')`,
    [
      id,
      m.tenantId,
      m.userId,
      `wamid.${id}`,
      m.type,
      m.text ?? null,
      m.transcription ?? null,
      m.type === "text" ? null : `tenants/${m.tenantId}/midia-secreta.bin`,
    ],
  );
  return id;
}

function call(
  who: PersonaSession,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  extra: { ctx?: string; xContext?: string | null; body?: unknown } = {},
) {
  const ctx = extra.ctx ?? who.ctx;
  const xContext = extra.xContext === undefined ? ctx : extra.xContext;
  const cookie = [who.session, ctx !== undefined ? `${CTX}=${ctx}` : ""].filter(Boolean).join("; ");
  return h.app.inject({
    method,
    url,
    remoteAddress: nextIp(),
    headers: {
      origin: h.origin,
      "user-agent": "vitest",
      cookie,
      ...(xContext != null ? { "x-context": xContext } : {}),
      ...(extra.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(extra.body !== undefined ? { payload: JSON.stringify(extra.body) } : {}),
  });
}

/**
 * A validação do contrato descarta campo desconhecido; comparar com o corpo recebido prova que
 * a resposta não traz nada além do contrato (nem os campos internos do leitor).
 */
function conforming<T>(parsed: T, body: unknown): T {
  expect(body).toEqual(parsed);
  return parsed;
}

const get = (who: PersonaSession, url: string, extra?: Parameters<typeof call>[3]) =>
  call(who, "GET", url, extra);

async function listOf(who: PersonaSession, query = ""): Promise<EntryListResponse> {
  const response = await get(who, `/api/entries?${PERIOD}${query}`);
  expect(response.statusCode).toBe(200);
  return conforming(entryListResponseSchema.parse(response.json()), response.json());
}

async function idsOf(who: PersonaSession, query = ""): Promise<string[]> {
  return (await listOf(who, query)).items.map((item) => item.id).sort();
}

async function totalsOf(who: PersonaSession, query = ""): Promise<EntryTotals> {
  const response = await get(who, `/api/entries/totals?${PERIOD}${query}`);
  expect(response.statusCode).toBe(200);
  return conforming(entryTotalsSchema.parse(response.json()), response.json());
}

async function detailOf(who: PersonaSession, id: string): Promise<EntryDetail> {
  const response = await get(who, `/api/entries/${id}`);
  expect(response.statusCode).toBe(200);
  return conforming(entryDetailSchema.parse(response.json()), response.json());
}

async function sourceOf(who: PersonaSession, id: string): Promise<EntrySource> {
  const response = await get(who, `/api/entries/${id}/source`);
  expect(response.statusCode).toBe(200);
  return conforming(entrySourceSchema.parse(response.json()), response.json());
}

/** As duas rotas do lançamento respondem o mesmo 404, só com o código. */
async function expectNotFound(who: PersonaSession, id: string, label = ""): Promise<void> {
  for (const path of [`/api/entries/${id}`, `/api/entries/${id}/source`]) {
    const response = await get(who, path);
    expect(response.statusCode, `${label} ${path}`).toBe(404);
    expect(response.json(), `${label} ${path}`).toEqual({ code: "not_found" });
  }
}

async function optionsOf(who: PersonaSession): Promise<EntryOptions> {
  const response = await get(who, "/api/entries/options");
  expect(response.statusCode).toBe(200);
  return conforming(entryOptionsSchema.parse(response.json()), response.json());
}

const sorted = (ids: string[]) => [...ids].sort();

beforeAll(async () => {
  h = await startAuthHarness();

  const a = await addTenant("Empresa A", ["Unidade 1", "Unidade 2", "Unidade 3"]);
  tenantA = a.tenantId;
  [unit1, unit2, unit3] = a.unitIds as [string, string, string];
  categoryA = await addCategory(tenantA, "Insumos");
  payrollA = await addCategory(tenantA, "Folha de pagamento", true);

  const b = await addTenant("Empresa B", ["Unidade da B"]);
  tenantB = b.tenantId;
  unitB = b.unitIds[0] as string;
  categoryB = await addCategory(tenantB, "Categoria da B");

  const c = await addTenant("Empresa C", ["Matriz"], "read_only");
  const categoryC = await addCategory(c.tenantId, "Insumos");

  const owner = await addUser();
  await addMembership(owner.userId, tenantA, { role: "owner" });
  const manager = await addUser();
  await addMembership(manager.userId, tenantA, {
    role: "manager",
    unitIds: [unit1, unit2],
    permissions: ["VER_FOLHA"],
  });
  const managerNoPayroll = await addUser();
  await addMembership(managerNoPayroll.userId, tenantA, {
    role: "manager",
    unitIds: [unit1, unit2],
  });
  const staff = await addUser();
  await addMembership(staff.userId, tenantA, { role: "staff", unitIds: [unit1] });
  const accountant = await addUser();
  await addMembership(accountant.userId, tenantA, { role: "accountant" });
  const restricted = await h.createUser({ membership: "deactivated", password: PASSWORD });
  const readOnly = await addUser();
  await addMembership(readOnly.userId, c.tenantId, { role: "owner" });
  const bOwner = await addUser();
  await addMembership(bOwner.userId, tenantB, { role: "owner" });
  const staffNoPanel = await addUser();
  // O painel é retirado depois do login (mais abaixo): sem painel ele nem consegue entrar.
  await addMembership(staffNoPanel.userId, tenantA, { role: "staff", unitIds: [unit1] });

  const base = { tenantId: tenantA, categoryId: categoryA };
  e1 = await addEntry({ ...base, unitId: unit1, createdBy: owner.userId, amountCents: 10_000 });
  e2 = await addEntry({
    ...base,
    unitId: unit1,
    createdBy: staff.userId,
    amountCents: 50_000,
    type: "revenue",
  });
  e3 = await addEntry({ ...base, unitId: unit2, createdBy: manager.userId, amountCents: 3_000 });
  e4 = await addEntry({ ...base, unitId: unit3, createdBy: owner.userId, amountCents: 700 });
  e5 = await addEntry({
    ...base,
    categoryId: payrollA,
    unitId: unit1,
    createdBy: owner.userId,
    amountCents: 200_000,
    description: PAYROLL_TEXT,
  });
  e6 = await addEntry({
    ...base,
    categoryId: payrollA,
    unitId: unit1,
    createdBy: staff.userId,
    amountCents: 1_500,
    description: PAYROLL_TEXT,
  });
  entryB = await addEntry({
    tenantId: tenantB,
    unitId: unitB,
    categoryId: categoryB,
    createdBy: bOwner.userId,
    amountCents: 999_999,
    type: "revenue",
    description: SECRET_B,
  });
  entryC = await addEntry({
    tenantId: c.tenantId,
    unitId: c.unitIds[0] as string,
    categoryId: categoryC,
    createdBy: readOnly.userId,
    amountCents: 4_200,
  });

  // --- Lançamentos de outubro: detalhe, histórico e origem ---
  const october = { ...base, unitId: unit1, createdBy: owner.userId, occurredOn: OCTOBER };

  // R6: nasceu na folha, foi reclassificado e depois teve o valor corrigido.
  const payrollMessage = await addMessage({
    tenantId: tenantA,
    userId: owner.userId,
    type: "audio",
    text: OLD_PAYROLL_MESSAGE,
    transcription: OLD_PAYROLL_MESSAGE,
  });
  movedOut = await addEntry({
    ...october,
    inboundMessageId: payrollMessage,
    amountCents: 45_000,
    description: "Compra de insumos",
    version: 3,
    firstCategoryId: payrollA,
    firstDescription: OLD_PAYROLL_TEXT,
    firstAmountCents: 310_000,
  });
  const v1 = firstSnapshots.get(movedOut) as Snapshot;
  const v2 = { ...v1, categoryId: categoryA, description: "Compra de insumos" };
  const v3 = { ...v2, amountCents: 45_000, netCents: 45_000 };
  const change = { tenantId: tenantA, entryId: movedOut, channel: "web" } as const;
  await addVersion({
    ...change,
    version: 2,
    action: "update",
    changedBy: owner.userId,
    before: v1,
    after: v2,
  });
  await addVersion({
    ...change,
    version: 3,
    action: "update",
    changedBy: manager.userId,
    before: v2,
    after: v3,
  });

  // R7: uma mensagem, dois lançamentos, um deles de folha.
  const shared = await addMessage({
    tenantId: tenantA,
    userId: owner.userId,
    type: "text",
    text: SHARED_MESSAGE_TEXT,
  });
  gas = await addEntry({ ...october, amountCents: 5_000, inboundMessageId: shared });
  salary = await addEntry({
    ...october,
    categoryId: payrollA,
    amountCents: 180_000,
    inboundMessageId: shared,
    position: 1,
  });

  // Texto com marcação em tudo que o usuário escreve; do lançador, na lixeira restaurável.
  const audio = await addMessage({
    tenantId: tenantA,
    userId: staff.userId,
    type: "audio",
    text: SCRIPT,
    transcription: SCRIPT,
  });
  scripted = await addEntry({
    ...october,
    createdBy: staff.userId,
    amountCents: 1_234,
    description: SCRIPT,
    inboundMessageId: audio,
    version: 2,
    // O prazo vence hoje: ainda é restaurável (a comparação inclui o dia).
    deleted: { by: staff.userId, reason: SCRIPT, restorableUntil: TODAY },
  });
  const scriptedV1 = firstSnapshots.get(scripted) as Snapshot;
  await addVersion({
    tenantId: tenantA,
    entryId: scripted,
    version: 2,
    action: "delete",
    channel: "whatsapp",
    changedBy: staff.userId,
    before: scriptedV1,
    after: { ...scriptedV1, deleteReason: SCRIPT },
  });

  expired = await addEntry({
    ...october,
    amountCents: 900,
    deleted: { by: owner.userId, reason: null, restorableUntil: YESTERDAY },
  });

  const photo = await addMessage({ tenantId: tenantA, userId: owner.userId, type: "image" });
  await admin(
    `insert into fiscal_documents (id, tenant_id, access_key, inbound_message_id, source, created_by)
     values ($1, $2, $3, $4, 'qrcode_sefaz', $5)`,
    [uuidv7(), tenantA, ACCESS_KEY, photo, owner.userId],
  );
  invoice = await addEntry({ ...october, amountCents: 31_000, inboundMessageId: photo });

  // Uma versão cita uma categoria que não está no cadastro: conta como sensível.
  orphanCategory = await addEntry({
    ...october,
    amountCents: 2_000,
    version: 2,
    firstCategoryId: uuidv7(),
  });
  const orphanV1 = firstSnapshots.get(orphanCategory) as Snapshot;
  await addVersion({
    tenantId: tenantA,
    entryId: orphanCategory,
    version: 2,
    action: "update",
    channel: "web",
    changedBy: owner.userId,
    before: orphanV1,
    after: { ...orphanV1, categoryId: categoryA },
  });

  const open = async (user: { userId: string; email: string }, ctx?: string) => ({
    userId: user.userId,
    session: await login(user.email),
    ctx,
  });
  personas = {
    owner: await open(owner, `${tenantA}.all`),
    manager: await open(manager, `${tenantA}.${unit1}`),
    managerNoPayroll: await open(managerNoPayroll, `${tenantA}.${unit1}`),
    staff: await open(staff, `${tenantA}.${unit1}`),
    accountant: await open(accountant, `${tenantA}.all`),
    restricted: await open(restricted),
    readOnly: await open(readOnly, `${c.tenantId}.all`),
    staffNoPanel: await open(staffNoPanel, `${tenantA}.${unit1}`),
  };
  // Sessão aberta e painel retirado em seguida: a sessão continua, o acesso não.
  await admin("update memberships set panel_access = false where user_id = $1", [
    staffNoPanel.userId,
  ]);
  FIXTURE = {
    period: PERIOD,
    entryIds: {
      owner: e1,
      manager: e1,
      managerNoPayroll: e1,
      // O lançador só abre o que ele mesmo lançou.
      staff: e2,
      accountant: e1,
      restricted: e1,
      readOnly: entryC,
      staffNoPanel: e2,
    },
  };
  ownerB = await open(bOwner, `${tenantB}.all`);
});

afterAll(async () => {
  await h?.stop();
});

describe("matriz papel × rota dos lançamentos (RF06.CA06)", () => {
  for (const route of ROUTE_MATRIX) {
    for (const persona of PERSONAS) {
      const status = route.expected[persona];
      it(`${route.name}: ${persona} recebe ${status}`, async () => {
        const response = await call(personas[persona], route.method, route.url(FIXTURE, persona), {
          body: route.body?.(FIXTURE),
        });
        expect(response.statusCode).toBe(status);
        if (status >= 400) {
          // Recusa não leva dado nenhum.
          expect(Object.keys(response.json())).not.toContain("items");
          expect(response.body).not.toContain(PAYROLL_TEXT);
        }
      });
    }
  }

  it("conta somente leitura continua lendo, mas nenhum lançamento vem como alterável, nem para o dono", async () => {
    const page = await listOf(personas.readOnly);
    expect(page.items.map((item) => item.amountCents)).toEqual([4_200]);
    expect(page.items[0]).toMatchObject({ canEdit: false, canDelete: false, canRestore: false });
    expect((await totalsOf(personas.readOnly)).expenseCents).toBe(4_200);
  });

  it("/api/me do lançador traz entry:view, para o painel mostrar Lançamentos (RF22.R3)", async () => {
    const response = await get(personas.staff, "/api/me");
    expect(response.statusCode).toBe(200);
    expect(response.json().context.allowedActions).toEqual([
      "entry:create",
      "entry:view",
      "entry:edit",
      "entry:delete",
      "entry:restore",
      "panel:access",
    ]);
  });

  it("sem sessão: 401 em todas as rotas", async () => {
    for (const route of ROUTE_MATRIX) {
      const response = await h.app.inject({
        method: route.method,
        url: route.url(FIXTURE, "owner"),
        // A escrita passa antes pelo hook de Origin: o que se prova aqui é o 401 da sessão.
        headers: {
          origin: h.origin,
          ...(route.body ? { "content-type": "application/json" } : {}),
        },
        ...(route.body ? { payload: JSON.stringify(route.body(FIXTURE)) } : {}),
      });
      expect(response.statusCode, route.name).toBe(401);
    }
  });
});

describe("contexto do painel nas rotas de lançamentos", () => {
  it("sem X-Context: 409 context_changed, sem dado", async () => {
    for (const route of ROUTE_MATRIX) {
      const response = await call(personas.owner, route.method, route.url(FIXTURE, "owner"), {
        xContext: null,
        body: route.body?.(FIXTURE),
      });
      expect(response.statusCode, route.name).toBe(409);
      expect(response.json(), route.name).toEqual({ code: "context_changed" });
    }
  });

  it("X-Context de outra unidade (aba antiga): 409 context_changed", async () => {
    const response = await get(personas.manager, `/api/entries?${PERIOD}`, {
      xContext: `${tenantA}.${unit2}`,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({ code: "context_changed" });
  });
});

describe("GET /api/entries: quem vê o quê", () => {
  it("dono com o seletor em todas vê os seis lançamentos da empresa, no formato do contrato", async () => {
    const page = await listOf(personas.owner);
    expect(page.nextCursor).toBeNull();
    expect(page.items.map((item) => item.id).sort()).toEqual(sorted([e1, e2, e3, e4, e5, e6]));
    const first = page.items.find((item) => item.id === e1);
    expect(first).toMatchObject({
      type: "expense",
      amountCents: 10_000,
      occurredOn: "2026-11-05",
      unit: { id: unit1, name: "Unidade 1" },
      category: { id: categoryA, name: "Insumos" },
      originChannel: "whatsapp",
      canEdit: true,
      canDelete: true,
      canRestore: false,
    });
  });

  it("gerente com VER_FOLHA vê a unidade do seletor, inclusive a folha", async () => {
    expect(await idsOf(personas.manager)).toEqual(sorted([e1, e2, e5, e6]));
  });

  it("gerente sem VER_FOLHA não recebe lançamento de folha", async () => {
    const response = await get(personas.managerNoPayroll, `/api/entries?${PERIOD}`);
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain(PAYROLL_TEXT);
    expect(response.body).not.toContain(payrollA);
    expect(await idsOf(personas.managerNoPayroll)).toEqual(sorted([e1, e2]));
  });

  it("filtro de unidade dentro do acesso prevalece sobre o seletor", async () => {
    const query = `&unitIds=${unit1}&unitIds=${unit2}`;
    expect(await idsOf(personas.managerNoPayroll, query)).toEqual(sorted([e1, e2, e3]));
    expect(await idsOf(personas.managerNoPayroll, `&unitIds=${unit2}`)).toEqual([e3]);
  });

  it("contador vê tudo, inclusive a folha, e não pode alterar nada", async () => {
    const page = await listOf(personas.accountant);
    expect(page.items).toHaveLength(6);
    for (const item of page.items) {
      expect([item.canEdit, item.canDelete, item.canRestore]).toEqual([false, false, false]);
    }
  });

  it("gerente altera os lançamentos das suas unidades; folha só com VER_FOLHA", async () => {
    const withPayroll = await listOf(personas.manager);
    expect(withPayroll.items.every((item) => item.canEdit && item.canDelete)).toBe(true);
    const without = await listOf(personas.managerNoPayroll);
    expect(without.items.every((item) => item.canEdit && item.canDelete)).toBe(true);
  });
});

describe("R3: gerente sem VER_FOLHA e a categoria sensível", () => {
  it("pedir a categoria de folha devolve lista vazia, total zero e o aviso de restritos", async () => {
    const query = `&categoryIds=${payrollA}`;
    const response = await get(personas.managerNoPayroll, `/api/entries?${PERIOD}${query}`);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [], nextCursor: null });
    expect(await totalsOf(personas.managerNoPayroll, query)).toEqual({
      revenueCents: 0,
      expenseCents: 0,
      resultCents: 0,
      count: 0,
      hasRestricted: true,
    });
  });

  it("buscar pelo texto ou pelo valor da folha também não a revela", async () => {
    for (const q of ["Sal%C3%A1rio", "2000,00"]) {
      const response = await get(personas.managerNoPayroll, `/api/entries?${PERIOD}&q=${q}`);
      expect(response.statusCode, q).toBe(200);
      expect(response.json(), q).toEqual({ items: [], nextCursor: null });
    }
    // Controle: a mesma busca acha a folha para quem pode vê-la.
    expect(await idsOf(personas.owner, "&q=Sal%C3%A1rio")).toEqual(sorted([e5, e6]));
    expect(await idsOf(personas.owner, "&q=2000,00")).toEqual([e5]);
  });

  it("os totais dele não somam a folha e avisam que há valores restritos", async () => {
    expect(await totalsOf(personas.managerNoPayroll)).toEqual({
      revenueCents: 50_000,
      expenseCents: 10_000,
      resultCents: 40_000,
      count: 2,
      hasRestricted: true,
    });
  });
});

describe("GET /api/entries/totals", () => {
  it("dono: receitas, despesas e resultado (negativo) calculados no servidor, sem aviso", async () => {
    expect(await totalsOf(personas.owner)).toEqual({
      revenueCents: 50_000,
      expenseCents: 215_200,
      resultCents: -165_200,
      count: 6,
      hasRestricted: false,
    });
  });

  it("gerente com VER_FOLHA soma a folha da unidade e não recebe aviso", async () => {
    expect(await totalsOf(personas.manager)).toEqual({
      revenueCents: 50_000,
      expenseCents: 211_500,
      resultCents: -161_500,
      count: 4,
      hasRestricted: false,
    });
  });

  it("os totais seguem os mesmos filtros da lista", async () => {
    expect(await totalsOf(personas.owner, "&type=revenue")).toMatchObject({
      revenueCents: 50_000,
      expenseCents: 0,
      resultCents: 50_000,
      count: 1,
    });
    expect(await totalsOf(personas.owner, `&unitIds=${unit3}`)).toMatchObject({
      expenseCents: 700,
      resultCents: -700,
      count: 1,
    });
  });
});

describe("R4: unidade fora do acesso e o lançador", () => {
  it("unidade fora do acesso no filtro: 403 forbidden sem dado, na lista e nos totais", async () => {
    for (const who of [personas.manager, personas.managerNoPayroll, personas.staff]) {
      for (const path of ["/api/entries", "/api/entries/totals"]) {
        for (const units of [`unitIds=${unit3}`, `unitIds=${unit1}&unitIds=${unit3}`]) {
          const response = await get(who, `${path}?${PERIOD}&${units}`);
          expect(response.statusCode, `${path} ${units}`).toBe(403);
          expect(response.json()).toEqual({ code: "forbidden" });
        }
      }
    }
  });

  it("lançador não pede unidade em que não trabalha, mesmo sendo da empresa", async () => {
    const response = await get(personas.staff, `/api/entries?${PERIOD}&unitIds=${unit2}`);
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ code: "forbidden" });
  });

  it("lançador vê só os próprios, e nem o próprio quando é de folha", async () => {
    const page = await listOf(personas.staff);
    expect(page.items.map((item) => item.id)).toEqual([e2]);
    expect(page.items[0]).toMatchObject({ canEdit: true, canDelete: true, canRestore: false });
  });

  it("'lançado por' enviado pelo lançador é ignorado: ele continua vendo só os próprios (RF22.CA03)", async () => {
    for (const other of [personas.owner.userId, personas.manager.userId]) {
      const query = `&createdBy=${other}`;
      expect(await idsOf(personas.staff, query)).toEqual([e2]);
      expect(await totalsOf(personas.staff, query)).toEqual({
        revenueCents: 50_000,
        expenseCents: 0,
        resultCents: 50_000,
        count: 1,
        hasRestricted: false,
      });
    }
  });

  it("'lançado por' vale para quem vê lançamento dos outros", async () => {
    const query = `&createdBy=${personas.staff.userId}`;
    expect(await idsOf(personas.owner, query)).toEqual(sorted([e2, e6]));
    expect(await idsOf(personas.managerNoPayroll, query)).toEqual([e2]);
  });
});

describe("R8: cursor", () => {
  it("a próxima página continua sem repetir; o mesmo cursor em outra ordenação é 400", async () => {
    const first = await listOf(personas.owner, "&limit=4");
    expect(first.items).toHaveLength(4);
    expect(first.nextCursor).not.toBeNull();
    const cursor = encodeURIComponent(first.nextCursor as string);

    const second = await listOf(personas.owner, `&limit=4&cursor=${cursor}`);
    expect(second.nextCursor).toBeNull();
    const all = [...first.items, ...second.items].map((item) => item.id);
    expect(sorted(all)).toEqual(sorted([e1, e2, e3, e4, e5, e6]));

    for (const other of ["&sort=amount", "&dir=asc", "&sort=occurred_on&dir=asc"]) {
      const response = await get(
        personas.owner,
        `/api/entries?${PERIOD}&limit=4&cursor=${cursor}${other}`,
      );
      expect(response.statusCode, other).toBe(400);
      expect(response.json(), other).toEqual({ code: "invalid_request" });
    }
  });

  it("cursor adulterado ou ilegível: 400 invalid_request, nunca 500", async () => {
    const first = await listOf(personas.owner, "&limit=2");
    const real = first.nextCursor as string;
    const payload = JSON.parse(Buffer.from(real, "base64url").toString("utf8"));
    const forge = (over: Record<string, unknown>) =>
      Buffer.from(JSON.stringify({ ...payload, ...over }), "utf8").toString("base64url");
    const tampered = [
      "lixo",
      `${real}xyz`,
      real.slice(0, -6),
      forge({ v: "ontem" }),
      forge({ v: "'; drop table entries; --" }),
      forge({ id: "1 or 1=1" }),
      forge({ id: null }),
      "a".repeat(600),
    ];
    for (const cursor of tampered) {
      const response = await get(
        personas.owner,
        `/api/entries?${PERIOD}&limit=2&cursor=${encodeURIComponent(cursor)}`,
      );
      expect(response.statusCode, cursor).toBe(400);
      expect(response.json(), cursor).toEqual({ code: "invalid_request" });
    }
    // A tabela continua lá.
    expect(await idsOf(personas.owner)).toHaveLength(6);
  });

  it("cursor forjado com o id de um lançamento de folha não fura o recorte", async () => {
    const forged = Buffer.from(
      JSON.stringify({ s: "created_at", d: "desc", v: "2099-01-01T00:00:00.000000Z", id: e5 }),
      "utf8",
    ).toString("base64url");
    expect(await idsOf(personas.managerNoPayroll, `&cursor=${forged}`)).toEqual(sorted([e1, e2]));
  });

  it("query inválida: 400 invalid_request", async () => {
    for (const query of [
      "",
      "from=2026-11-01",
      "from=2026-11-30&to=2026-11-01",
      `${PERIOD}&limit=500`,
    ]) {
      for (const path of ["/api/entries", "/api/entries/totals"]) {
        const response = await get(personas.owner, `${path}?${query}`);
        expect(response.statusCode, `${path}?${query}`).toBe(400);
        expect(response.json()).toEqual({ code: "invalid_request" });
      }
    }
  });
});

describe("R9: isolamento entre empresas (RNF02)", () => {
  it("sessão da empresa A nunca recebe lançamento, total ou cadastro da empresa B", async () => {
    for (const persona of ["owner", "accountant", "manager", "staff"] as const) {
      // Rota que a persona não pode usar (lixeira do contador) responde 403, sem dado.
      for (const route of ROUTE_MATRIX.filter(
        (candidate) => candidate.method === "GET" && candidate.expected[persona] === 200,
      )) {
        const response = await get(personas[persona], route.url(FIXTURE, persona));
        expect(response.statusCode, route.name).toBe(200);
        for (const secret of [SECRET_B, entryB, unitB, categoryB, tenantB, "Categoria da B"]) {
          expect(response.body, `${route.name} ${secret}`).not.toContain(secret);
        }
      }
    }
    expect((await totalsOf(personas.owner)).revenueCents).toBe(50_000);
  });

  it("filtros apontando para ids da empresa B devolvem vazio e total zero", async () => {
    const filters = [
      `&unitIds=${unitB}`,
      `&categoryIds=${categoryB}`,
      `&createdBy=${ownerB.userId}`,
      `&q=${encodeURIComponent(SECRET_B)}`,
      "&q=9999,99",
    ];
    for (const filter of filters) {
      const list = await get(personas.owner, `/api/entries?${PERIOD}${filter}`);
      expect(list.statusCode, filter).toBe(200);
      expect(list.json(), filter).toEqual({ items: [], nextCursor: null });
      expect(await totalsOf(personas.owner, filter), filter).toEqual({
        revenueCents: 0,
        expenseCents: 0,
        resultCents: 0,
        count: 0,
        hasRestricted: false,
      });
    }
  });

  it("cookie de contexto forjado para a empresa B: 403 context_invalid, sem dado", async () => {
    const forged = `${tenantB}.all`;
    for (const route of ROUTE_MATRIX) {
      const response = await call(personas.owner, route.method, route.url(FIXTURE, "owner"), {
        ctx: forged,
        body: route.body?.(FIXTURE),
      });
      expect(response.statusCode, route.name).toBe(403);
      expect(response.json(), route.name).toEqual({ code: "context_invalid" });
      expect(response.body).not.toContain(SECRET_B);
    }
  });

  it("tenantId na query é ignorado: o dado sai sempre da empresa do contexto", async () => {
    expect(await idsOf(personas.owner, `&tenantId=${tenantB}`)).toHaveLength(6);
  });

  it("o dono da empresa B vê só o que é da B", async () => {
    expect(await idsOf(ownerB)).toEqual([entryB]);
    expect(await totalsOf(ownerB)).toMatchObject({ revenueCents: 999_999, count: 1 });
    const options = await optionsOf(ownerB);
    expect(options.units.map((unit) => ({ id: unit.id, name: unit.name }))).toEqual([
      { id: unitB, name: "Unidade da B" },
    ]);
    expect(options.categories.map((category) => category.id)).not.toContain(categoryA);
    expect(options.members.map((member) => member.id)).toEqual([ownerB.userId]);
  });
});

describe("GET /api/entries/options", () => {
  it("gerente com duas unidades de acesso e o seletor numa delas recebe as duas, e não a terceira", async () => {
    for (const who of [personas.manager, personas.managerNoPayroll]) {
      const options = await optionsOf(who);
      expect(options.units.map((unit) => ({ id: unit.id, name: unit.name }))).toEqual([
        { id: unit1, name: "Unidade 1" },
        { id: unit2, name: "Unidade 2" },
      ]);
    }
  });

  it("unitIds na query não muda as unidades oferecidas nem vira erro", async () => {
    const response = await get(personas.manager, `/api/entries/options?unitIds=${unit3}`);
    expect(response.statusCode).toBe(200);
    const options = entryOptionsSchema.parse(response.json());
    expect(options.units.map((unit) => unit.id)).toEqual([unit1, unit2]);
  });

  it("dono e contador recebem as três unidades", async () => {
    for (const who of [personas.owner, personas.accountant]) {
      expect((await optionsOf(who)).units.map((unit) => unit.id)).toEqual([unit1, unit2, unit3]);
    }
  });

  it("lançador recebe só a sua unidade e nenhum membro", async () => {
    const options = await optionsOf(personas.staff);
    expect(options.units.map((unit) => ({ id: unit.id, name: unit.name }))).toEqual([
      { id: unit1, name: "Unidade 1" },
    ]);
    expect(options.members).toEqual([]);
  });

  it("quem vê lançamento dos outros recebe os membros da empresa", async () => {
    const members = (await optionsOf(personas.managerNoPayroll)).members.map((m) => m.id);
    expect(members).toEqual(expect.arrayContaining([personas.owner.userId, personas.staff.userId]));
    expect(members).not.toContain(ownerB.userId);
  });

  it("categoria sensível só vai para quem vê folha", async () => {
    const idsFor = async (who: PersonaSession) =>
      (await optionsOf(who)).categories.map((category) => category.id);
    for (const who of [personas.owner, personas.manager, personas.accountant]) {
      const ids = await idsFor(who);
      expect(ids).toContain(payrollA);
      expect(ids).toContain(categoryA);
    }
    for (const who of [personas.managerNoPayroll, personas.staff]) {
      const response = await get(who, "/api/entries/options");
      expect(response.body).not.toContain(payrollA);
      expect(response.body).not.toContain("Folha de pagamento");
      expect(await idsFor(who)).toContain(categoryA);
    }
  });
});

describe("GET /api/entries/:id: detalhe e histórico (RF25)", () => {
  it("dono abre o lançamento com os dados, as ações e a versão de criação campo a campo", async () => {
    const detail = await detailOf(personas.owner, e1);
    expect(detail).toMatchObject({
      id: e1,
      version: 1,
      type: "expense",
      amountCents: 10_000,
      feePercentBp: 0,
      feeFixedCents: 0,
      unit: { id: unit1, name: "Unidade 1" },
      category: { id: categoryA, name: "Insumos" },
      deleted: null,
      canEdit: true,
      canDelete: true,
      canRestore: false,
    });
    expect(detail.versions).toHaveLength(1);
    expect(detail.versions[0]).toMatchObject({
      version: 1,
      action: "create",
      channel: "whatsapp",
      changedBy: { id: personas.owner.userId },
      restricted: false,
    });
    const changes = detail.versions[0]?.changes ?? [];
    expect(changes).toEqual(
      expect.arrayContaining([
        { field: "amountCents", before: null, after: 10_000 },
        { field: "category", before: null, after: "Insumos" },
        { field: "unit", before: null, after: "Unidade 1" },
      ]),
    );
    // Nome no lugar de id: nenhum id de cadastro aparece no histórico.
    expect(JSON.stringify(detail.versions)).not.toContain(categoryA);
    expect(JSON.stringify(detail.versions)).not.toContain(unit1);
  });

  it("id que não é UUID: 400 invalid_request nas duas rotas", async () => {
    for (const id of ["abc", "42", `${e1}x`]) {
      for (const path of [`/api/entries/${id}`, `/api/entries/${id}/source`]) {
        const response = await get(personas.owner, path);
        expect(response.statusCode, path).toBe(400);
        expect(response.json(), path).toEqual({ code: "invalid_request" });
      }
    }
  });

  it("lançamento que não existe: 404 not_found", async () => {
    await expectNotFound(personas.owner, uuidv7());
  });

  it("R9: lançamento de outra empresa responde o mesmo 404, nos dois sentidos", async () => {
    for (const who of [personas.owner, personas.accountant, personas.manager, personas.staff]) {
      await expectNotFound(who, entryB);
    }
    await expectNotFound(ownerB, e1);
    await expectNotFound(ownerB, movedOut);
    expect((await detailOf(ownerB, entryB)).description).toBe(SECRET_B);
  });

  it("lançamento de folha: 404 para quem não vê folha, inclusive o lançador que o lançou", async () => {
    await expectNotFound(personas.managerNoPayroll, e5);
    await expectNotFound(personas.managerNoPayroll, salary);
    await expectNotFound(personas.staff, e6);
    for (const who of [personas.owner, personas.manager, personas.accountant]) {
      expect((await detailOf(who, e5)).description).toBe(PAYROLL_TEXT);
    }
  });

  it("lançador abre o próprio lançamento e recebe 404 no de outra pessoa", async () => {
    const own = await detailOf(personas.staff, e2);
    expect(own).toMatchObject({ id: e2, canEdit: true, canDelete: true, canRestore: false });
    await expectNotFound(personas.staff, e1);
    await expectNotFound(personas.staff, gas);
  });

  it("gerente abre lançamento de outra unidade do seu acesso, mas não o de unidade fora dele", async () => {
    // Seletor na unidade 1; a lista mostra a unidade 2 pelo filtro, então o detalhe abre.
    for (const who of [personas.manager, personas.managerNoPayroll]) {
      expect((await detailOf(who, e3)).unit).toEqual({ id: unit2, name: "Unidade 2" });
      await expectNotFound(who, e4);
    }
    expect((await detailOf(personas.owner, e4)).unit.id).toBe(unit3);
  });

  it("contador abre tudo e não recebe ação nenhuma", async () => {
    for (const id of [e1, e5, scripted]) {
      expect(await detailOf(personas.accountant, id)).toMatchObject({
        canEdit: false,
        canDelete: false,
        canRestore: false,
      });
    }
  });

  it("conta somente leitura: o dono abre o detalhe sem ação nenhuma", async () => {
    expect(await detailOf(personas.readOnly, entryC)).toMatchObject({
      amountCents: 4_200,
      canEdit: false,
      canDelete: false,
      canRestore: false,
    });
  });

  it("lixeira dentro do prazo abre com quem excluiu e o motivo; só restaurar é oferecido", async () => {
    const detail = await detailOf(personas.staff, scripted);
    expect(detail.deleted).toMatchObject({
      by: { id: personas.staff.userId },
      reason: SCRIPT,
      restorableUntil: TODAY,
    });
    expect(detail).toMatchObject({ canEdit: false, canDelete: false, canRestore: true });
    expect(detail.versions.map((version) => version.action)).toEqual(["create", "delete"]);
    expect(detail.versions[1]?.changes).toEqual([
      { field: "deleteReason", before: null, after: SCRIPT },
    ]);
  });

  it("lixeira que venceu ontem: 404 até para o dono", async () => {
    await expectNotFound(personas.owner, expired);
    await expectNotFound(personas.accountant, expired);
  });

  it("texto com marcação volta intacto, como string, na descrição, no motivo e no histórico", async () => {
    const detail = await detailOf(personas.owner, scripted);
    expect(detail.description).toBe(SCRIPT);
    expect(detail.deleted?.reason).toBe(SCRIPT);
    expect(detail.versions[0]?.changes).toContainEqual({
      field: "description",
      before: null,
      after: SCRIPT,
    });
  });
});

describe("R6: histórico de lançamento que já esteve na folha", () => {
  it("quem não vê folha recebe as versões que passaram pela folha como restritas, sem campo", async () => {
    const response = await get(personas.managerNoPayroll, `/api/entries/${movedOut}`);
    expect(response.statusCode).toBe(200);
    const detail = conforming(entryDetailSchema.parse(response.json()), response.json());
    expect(detail.category).toEqual({ id: categoryA, name: "Insumos" });
    expect(detail.versions.map((v) => [v.version, v.action, v.restricted])).toEqual([
      [1, "create", true],
      // O antes da versão 2 ainda é a folha.
      [2, "update", true],
      [3, "update", false],
    ]);
    expect(detail.versions[0]?.changes).toEqual([]);
    expect(detail.versions[1]?.changes).toEqual([]);
    expect(detail.versions[2]?.changes).toEqual([
      { field: "amountCents", before: 310_000, after: 45_000 },
      { field: "netCents", before: 310_000, after: 45_000 },
    ]);
    // Nada da folha antiga sai: nem o texto, nem o nome, nem o id da categoria.
    for (const secret of [OLD_PAYROLL_TEXT, "Folha de pagamento", payrollA]) {
      expect(response.body, secret).not.toContain(secret);
    }
    // Quem alterou e quando continuam visíveis.
    expect(detail.versions[1]?.changedBy.id).toBe(personas.owner.userId);
  });

  it("quem vê folha recebe o diff completo, com o nome da categoria antiga", async () => {
    for (const who of [personas.owner, personas.manager, personas.accountant]) {
      const detail = await detailOf(who, movedOut);
      expect(detail.versions.map((v) => v.restricted)).toEqual([false, false, false]);
      expect(detail.versions[0]?.changes).toEqual(
        expect.arrayContaining([
          { field: "description", before: null, after: OLD_PAYROLL_TEXT },
          { field: "category", before: null, after: "Folha de pagamento" },
          { field: "amountCents", before: null, after: 310_000 },
        ]),
      );
      expect(detail.versions[1]?.changes).toEqual([
        { field: "description", before: OLD_PAYROLL_TEXT, after: "Compra de insumos" },
        { field: "category", before: "Folha de pagamento", after: "Insumos" },
      ]);
    }
  });

  it("versão que cita categoria fora do cadastro é restrita para quem não vê folha, e o id nunca sai", async () => {
    const hidden = await detailOf(personas.managerNoPayroll, orphanCategory);
    expect(hidden.versions.map((v) => [v.restricted, v.changes.length])).toEqual([
      [true, 0],
      [true, 0],
    ]);
    const response = await get(personas.owner, `/api/entries/${orphanCategory}`);
    const full = entryDetailSchema.parse(response.json());
    expect(full.versions[1]?.changes).toEqual([
      { field: "category", before: "(removido)", after: "Insumos" },
    ]);
    const orphanId = (firstSnapshots.get(orphanCategory) as Snapshot).categoryId as string;
    expect(response.body).not.toContain(orphanId);
  });
});

describe("GET /api/entries/:id/source: origem (RF25)", () => {
  it("mensagem de texto: canal, texto original, quem enviou e quando; mídia indisponível", async () => {
    // `gas` divide a mensagem com um lançamento de folha: quem vê folha recebe o texto.
    for (const who of [personas.owner, personas.manager, personas.accountant]) {
      const source = await sourceOf(who, gas);
      expect(source).toMatchObject({
        channel: "whatsapp",
        kind: "text",
        text: SHARED_MESSAGE_TEXT,
        transcription: null,
        accessKey: null,
        sentBy: { id: personas.owner.userId },
        restricted: false,
        mediaAvailable: false,
      });
      expect(source.sentAt).not.toBeNull();
    }
  });

  it("R7: mensagem que também gerou lançamento de folha vem restrita e sem texto para quem não vê folha", async () => {
    const response = await get(personas.managerNoPayroll, `/api/entries/${gas}/source`);
    expect(response.statusCode).toBe(200);
    const source = conforming(entrySourceSchema.parse(response.json()), response.json());
    expect(source).toMatchObject({
      channel: "whatsapp",
      kind: "text",
      text: null,
      transcription: null,
      accessKey: null,
      restricted: true,
      mediaAvailable: false,
    });
    expect(response.body).not.toContain("salário");
    expect(response.body).not.toContain("1800");
    // O detalhe do lançamento de gás continua aberto para ele.
    expect((await detailOf(personas.managerNoPayroll, gas)).amountCents).toBe(5_000);
  });

  it("I1: lançamento que nasceu na folha e foi reclassificado não entrega a mensagem original a quem não vê folha", async () => {
    const response = await get(personas.managerNoPayroll, `/api/entries/${movedOut}/source`);
    expect(response.statusCode).toBe(200);
    const source = conforming(entrySourceSchema.parse(response.json()), response.json());
    expect(source).toMatchObject({
      kind: "audio",
      text: null,
      transcription: null,
      accessKey: null,
      restricted: true,
      mediaAvailable: false,
    });
    for (const secret of [OLD_PAYROLL_MESSAGE, "3100", "salário", "João"]) {
      expect(response.body, secret).not.toContain(secret);
    }
    // Quem vê folha recebe a mensagem inteira.
    for (const who of [personas.owner, personas.manager, personas.accountant]) {
      expect(await sourceOf(who, movedOut)).toMatchObject({
        text: OLD_PAYROLL_MESSAGE,
        transcription: OLD_PAYROLL_MESSAGE,
        restricted: false,
      });
    }
  });

  it("lançamento comum, sem passado na folha e sem irmão de folha, mantém o texto para quem não vê folha", async () => {
    const message = await addMessage({
      tenantId: tenantA,
      userId: personas.owner.userId,
      type: "text",
      text: "120 de gelo",
    });
    const plain = await addEntry({
      tenantId: tenantA,
      categoryId: categoryA,
      unitId: unit1,
      createdBy: personas.owner.userId,
      occurredOn: OCTOBER,
      amountCents: 12_000,
      inboundMessageId: message,
    });
    for (const who of [personas.managerNoPayroll, personas.owner]) {
      expect(await sourceOf(who, plain)).toMatchObject({
        kind: "text",
        text: "120 de gelo",
        restricted: false,
      });
    }
  });

  it("versão ilegível no histórico restringe a origem para quem não vê folha (falha fechado)", async () => {
    const message = await addMessage({
      tenantId: tenantA,
      userId: personas.owner.userId,
      type: "text",
      text: "texto de origem duvidosa",
    });
    const odd = await addEntry({
      tenantId: tenantA,
      categoryId: categoryA,
      unitId: unit1,
      createdBy: personas.owner.userId,
      occurredOn: OCTOBER,
      amountCents: 700,
      inboundMessageId: message,
      version: 2,
    });
    await admin(
      `insert into entry_versions (id, tenant_id, entry_id, version, action, before, after,
         changed_by, channel)
       values ($1, $2, $3, 2, 'update', '"ilegivel"'::jsonb, '{}'::jsonb, $4, 'web')`,
      [uuidv7(), tenantA, odd, personas.owner.userId],
    );
    const response = await get(personas.managerNoPayroll, `/api/entries/${odd}/source`);
    expect(entrySourceSchema.parse(response.json())).toMatchObject({
      text: null,
      restricted: true,
    });
    expect(response.body).not.toContain("duvidosa");
    expect((await sourceOf(personas.owner, odd)).text).toBe("texto de origem duvidosa");
  });

  it("lançamento sem mensagem de origem: kind none, sem texto e sem restrição", async () => {
    expect(await sourceOf(personas.owner, e1)).toEqual({
      channel: "whatsapp",
      kind: "none",
      text: null,
      transcription: null,
      accessKey: null,
      sentBy: null,
      sentAt: null,
      restricted: false,
      mediaAvailable: false,
    });
  });

  it("áudio: texto e transcrição com marcação voltam intactos, e o local do arquivo nunca sai", async () => {
    for (const who of [personas.owner, personas.staff, personas.managerNoPayroll]) {
      const response = await get(who, `/api/entries/${scripted}/source`);
      expect(response.statusCode).toBe(200);
      const source = conforming(entrySourceSchema.parse(response.json()), response.json());
      expect(source).toMatchObject({
        kind: "audio",
        text: SCRIPT,
        transcription: SCRIPT,
        sentBy: { id: personas.staff.userId },
        restricted: false,
        mediaAvailable: false,
      });
      expect(response.body).not.toContain("midia-secreta");
    }
  });

  it("foto de nota: a chave de acesso vem junto, e o local do arquivo não", async () => {
    const response = await get(personas.managerNoPayroll, `/api/entries/${invoice}/source`);
    const source = conforming(entrySourceSchema.parse(response.json()), response.json());
    expect(source).toMatchObject({ kind: "image", accessKey: ACCESS_KEY, restricted: false });
    expect(response.body).not.toContain("midia-secreta");
  });
});

describe("histórico gravado pelo caminho real do canal (domínio e entryStore)", () => {
  it("criação e edição gravadas pelo entryStore voltam no detalhe campo a campo", async () => {
    const store = createEntryStore(createDatabase(h.appPool));
    const author = personas.owner.userId;
    const message = await addMessage({
      tenantId: tenantA,
      userId: author,
      type: "text",
      text: "80 de embalagem",
    });
    const id = uuidv7();
    const created = createEntry(
      {
        unitId: unit1,
        type: "expense",
        occurredOn: OCTOBER,
        description: "Embalagem",
        quantity: 2.5,
        quantityUnit: "kg",
        amountCents: 8_000 as Money,
        feePercentBp: 0,
        feeFixedCents: 0,
        categoryId: categoryA,
        supplierId: null,
        paymentMethodId: null,
        salesChannelId: null,
        inboundMessageId: message,
        flags: ["old_date"],
      },
      {
        id,
        tenantId: tenantA,
        actorId: author,
        channel: "whatsapp",
        at: new Date("2026-11-09T12:00:00Z"),
      },
    );
    if (!created.ok) throw new Error(created.error.code);
    await store.register({
      tenantId: tenantA,
      userId: author,
      inboundMessageId: message,
      entries: [{ position: 0, change: created.value }],
      newSuppliers: [],
      usage: [],
    });
    const edited = editEntry(
      created.value.entry,
      { amountCents: 9_500 as Money, categoryId: payrollA, paidOn: "2026-10-20" },
      { actorId: author, channel: "whatsapp", at: new Date("2026-11-09T12:05:00Z") },
    );
    if (!edited.ok) throw new Error(edited.error.code);
    expect(await store.applyChanges(tenantA, [edited.value])).toBe(true);

    const detail = await detailOf(personas.owner, id);
    expect(detail.versions.map((v) => [v.version, v.action, v.channel, v.restricted])).toEqual([
      [1, "create", "whatsapp", false],
      [2, "update", "whatsapp", false],
    ]);
    expect(detail.versions[0]?.changes).toEqual([
      { field: "type", before: null, after: "expense" },
      { field: "occurredOn", before: null, after: OCTOBER },
      { field: "paidOn", before: null, after: OCTOBER },
      { field: "description", before: null, after: "Embalagem" },
      { field: "quantity", before: null, after: 2.5 },
      { field: "quantityUnit", before: null, after: "kg" },
      { field: "amountCents", before: null, after: 8_000 },
      { field: "feePercentBp", before: null, after: 0 },
      { field: "feeFixedCents", before: null, after: 0 },
      { field: "feeCents", before: null, after: 0 },
      { field: "netCents", before: null, after: 8_000 },
      { field: "category", before: null, after: "Insumos" },
      { field: "unit", before: null, after: "Unidade 1" },
      { field: "flags", before: null, after: "old_date" },
    ]);
    expect(detail.versions[1]?.changes).toEqual([
      { field: "paidOn", before: OCTOBER, after: "2026-10-20" },
      { field: "amountCents", before: 8_000, after: 9_500 },
      { field: "netCents", before: 8_000, after: 9_500 },
      { field: "category", before: "Insumos", after: "Folha de pagamento" },
    ]);
    // O formato real também alimenta a regra de sensível: agora é folha.
    await expectNotFound(personas.managerNoPayroll, id);
  });
});

describe("registro de log do detalhe e da origem (RNF11)", () => {
  it("nenhuma linha traz texto de mensagem, descrição, motivo, id do lançamento ou valor", async () => {
    h.logLines.length = 0;
    await get(personas.owner, `/api/entries/${scripted}`);
    await get(personas.owner, `/api/entries/${scripted}/source`);
    await get(personas.owner, `/api/entries/${movedOut}`);
    await get(personas.owner, `/api/entries/${gas}/source`);
    await get(personas.managerNoPayroll, `/api/entries/${e5}`);
    await get(personas.managerNoPayroll, `/api/entries/${e5}/source`);
    await get(personas.owner, "/api/entries/nao-e-uuid");
    expect(h.logLines.length).toBeGreaterThan(0);
    const logs = h.logLines.join("\n");
    for (const secret of [
      "script",
      SHARED_MESSAGE_TEXT,
      OLD_PAYROLL_TEXT,
      PAYROLL_TEXT,
      "Folha de pagamento",
      "310000",
      "@ex.com",
    ]) {
      expect(logs, secret).not.toContain(secret);
    }
  });
});

describe("registro de log das rotas de lançamentos (RNF11)", () => {
  it("nenhuma linha traz descrição, busca, cursor, contexto, e-mail ou cookie", async () => {
    const who = personas.owner;
    const first = await listOf(who, "&limit=2");
    const cursor = first.nextCursor as string;
    h.logLines.length = 0;
    await get(who, `/api/entries?${PERIOD}&q=salario-da-maria&cursor=${cursor}&limit=2`);
    await get(who, `/api/entries?${PERIOD}&cursor=cursor-adulterado`);
    await get(who, `/api/entries/totals?${PERIOD}&q=busca-secreta`);
    await get(who, "/api/entries/options");
    await get(personas.manager, `/api/entries?${PERIOD}&unitIds=${unit3}`);
    await get(who, `/api/entries?${PERIOD}`, { xContext: null });
    expect(h.logLines.length).toBeGreaterThan(0);
    const logs = h.logLines.join("\n");
    for (const secret of [
      PAYROLL_TEXT,
      "salario-da-maria",
      "busca-secreta",
      "cursor-adulterado",
      cursor,
      who.ctx as string,
      unit3,
      who.session.split("=")[1] as string,
      "@ex.com",
    ]) {
      expect(logs, secret).not.toContain(secret);
    }
  });
});

// ---------------------------------------------------------------------------------------
// PATCH /api/entries/:id (F3b, RF23)
// ---------------------------------------------------------------------------------------

const patchEntry = (who: PersonaSession, id: string, body: unknown, extra = {}) =>
  call(who, "PATCH", `/api/entries/${id}`, { body, ...extra });

/** Lançamento novo da empresa A em outubro, para cada teste mexer no seu. */
const freshEntry = (over: Partial<Parameters<typeof addEntry>[0]> & { by?: PersonaSession } = {}) =>
  addEntry({
    tenantId: tenantA,
    unitId: unit1,
    categoryId: categoryA,
    createdBy: (over.by ?? personas.owner).userId,
    amountCents: 10_000,
    occurredOn: OCTOBER,
    ...over,
  });

const rowOf = async (id: string) =>
  (await admin("select * from entries where id = $1", [id])).rows[0] as Record<string, unknown>;

const versionsOf = async (id: string) =>
  (
    await admin(
      "select version, action, channel, changed_by, before, after from entry_versions where entry_id = $1 order by version",
      [id],
    )
  ).rows as Array<{
    version: number;
    action: string;
    channel: string;
    changed_by: string;
    before: { flags: string[] } | null;
    after: { description: string; flags: string[] };
  }>;

describe("PATCH /api/entries/:id: edição com versão esperada (RF23)", () => {
  it("S1: duas abas na mesma versão: a segunda recebe 409 entry_stale com o detalhe atual e nada é sobrescrito (RF23.CA02)", async () => {
    const id = await freshEntry({ description: "Original" });
    const first = await patchEntry(personas.owner, id, {
      expectedVersion: 1,
      patch: { description: "Da aba A" },
    });
    expect(first.statusCode).toBe(200);
    expect(entryDetailSchema.parse(first.json())).toMatchObject({
      id,
      version: 2,
      description: "Da aba A",
    });

    const second = await patchEntry(personas.manager, id, {
      expectedVersion: 1,
      patch: { description: "Da aba B", amountCents: 99_999 },
    });
    expect(second.statusCode).toBe(409);
    const body = entryStaleSchema.parse(second.json());
    expect(body.current).toMatchObject({ id, version: 2, description: "Da aba A" });
    // O 409 traz só o código e o detalhe atual.
    expect(Object.keys(second.json()).sort()).toEqual(["code", "current"]);
    expect(await rowOf(id)).toMatchObject({
      description: "Da aba A",
      amount_cents: "10000",
      version: 2,
    });
    expect(await versionsOf(id)).toHaveLength(2);
  });

  it("S1: o 409 de quem não vê folha vem filtrado: versões da folha restritas, sem o salário antigo", async () => {
    const response = await patchEntry(personas.managerNoPayroll, movedOut, {
      expectedVersion: 1,
      patch: { description: "Tentativa" },
    });
    expect(response.statusCode).toBe(409);
    const { current } = entryStaleSchema.parse(response.json());
    expect(current.versions.filter((version) => version.restricted).map((v) => v.version)).toEqual([
      1, 2,
    ]);
    expect(response.body).not.toContain(OLD_PAYROLL_TEXT);
    expect(response.body).not.toContain(OLD_PAYROLL_MESSAGE);
  });

  it("edição de valor gera versão 2 com canal web, quem, antes e depois, lida pelo GET (RF23.CA03)", async () => {
    const id = await freshEntry({ amountCents: 10_000 });
    const response = await patchEntry(personas.manager, id, {
      expectedVersion: 1,
      patch: { amountCents: 123_456 },
    });
    expect(response.statusCode).toBe(200);
    const detail = await detailOf(personas.manager, id);
    const version = detail.versions.at(-1);
    expect(version).toMatchObject({
      version: 2,
      action: "update",
      channel: "web",
      changedBy: { id: personas.manager.userId },
      restricted: false,
    });
    expect(version?.changes).toEqual(
      expect.arrayContaining([{ field: "amountCents", before: 10_000, after: 123_456 }]),
    );
    expect(await rowOf(id)).toMatchObject({ amount_cents: "123456", net_cents: "123456" });
  });

  it("S4: trocar só a descrição mantém as taxas copiadas; trocar a forma de pagamento recopia e recalcula o líquido (RF23.Obs4)", async () => {
    const credit = uuidv7();
    const pix = uuidv7();
    await admin(
      `insert into payment_methods (id, tenant_id, name, fee_percent_bp, fee_fixed_cents, type)
       values ($1, $3, 'Crédito S4', 320, 0, 'credit'), ($2, $3, 'Pix S4', 0, 0, 'pix')`,
      [credit, pix, tenantA],
    );
    const id = await freshEntry({ type: "revenue", amountCents: 10_000 });
    // Taxa copiada de uma configuração antiga: 5% fora da forma atual.
    await admin(
      `update entries set fee_percent_bp = 500, fee_cents = 500, net_cents = 9500 where id = $1`,
      [id],
    );

    const description = await patchEntry(personas.owner, id, {
      expectedVersion: 1,
      patch: { description: "Só a descrição" },
    });
    expect(description.statusCode).toBe(200);
    expect(await rowOf(id)).toMatchObject({
      fee_percent_bp: 500,
      fee_cents: "500",
      net_cents: "9500",
    });

    const method = await patchEntry(personas.owner, id, {
      expectedVersion: 2,
      patch: { paymentMethodId: credit },
    });
    expect(method.statusCode).toBe(200);
    expect(await rowOf(id)).toMatchObject({
      fee_percent_bp: 320,
      fee_cents: "320",
      net_cents: "9680",
    });

    const pixChange = await patchEntry(personas.owner, id, {
      expectedVersion: 3,
      patch: { paymentMethodId: pix },
    });
    expect(pixChange.statusCode).toBe(200);
    expect(await rowOf(id)).toMatchObject({
      fee_percent_bp: 0,
      fee_cents: "0",
      net_cents: "10000",
    });
  });

  it("S2: gerente sem VER_FOLHA enviando categoria sensível existente ou inexistente: a mesma resposta 422 UnknownReference e nada gravado", async () => {
    const id = await freshEntry();
    const bodies: string[] = [];
    for (const categoryId of [payrollA, uuidv7()]) {
      const response = await patchEntry(personas.managerNoPayroll, id, {
        expectedVersion: 1,
        patch: { categoryId },
      });
      expect(response.statusCode).toBe(422);
      expect(response.json()).toEqual({
        code: "invalid_entry",
        reason: "UnknownReference",
        field: "categoryId",
      });
      bodies.push(response.body);
    }
    // Sensível e inexistente são indistinguíveis: não dá para sondar quais ids são folha.
    expect(bodies[0]).toBe(bodies[1]);
    expect(await rowOf(id)).toMatchObject({ category_id: categoryA, version: 1 });
    expect(await versionsOf(id)).toHaveLength(1);
  });

  it("S2: o dono troca para a categoria sensível", async () => {
    const id = await freshEntry();
    const response = await patchEntry(personas.owner, id, {
      expectedVersion: 1,
      patch: { categoryId: payrollA },
    });
    expect(response.statusCode).toBe(200);
    expect(await rowOf(id)).toMatchObject({ category_id: payrollA, version: 2 });
  });

  it("S2: gerente com VER_FOLHA troca para a categoria sensível", async () => {
    const id = await freshEntry();
    const response = await patchEntry(personas.manager, id, {
      expectedVersion: 1,
      patch: { categoryId: payrollA },
    });
    expect(response.statusCode).toBe(200);
    expect(await rowOf(id)).toMatchObject({ category_id: payrollA, version: 2 });
  });

  it("S2: editar um lançamento sensível pelo id: 404 para gerente sem VER_FOLHA e para o lançador, nada gravado", async () => {
    for (const [who, id] of [
      [personas.managerNoPayroll, e5],
      [personas.managerNoPayroll, salary],
      [personas.staff, e6],
    ] as const) {
      const response = await patchEntry(who, id, {
        expectedVersion: 1,
        patch: { description: "invasão" },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ code: "not_found" });
      expect((await rowOf(id)).description).not.toBe("invasão");
    }
  });

  it("S2: unidade nova fora do acesso do gerente: 403; unidade antiga fora do acesso: 404", async () => {
    const id = await freshEntry();
    const toOutside = await patchEntry(personas.manager, id, {
      expectedVersion: 1,
      patch: { unitId: unit3 },
    });
    expect(toOutside.statusCode).toBe(403);
    expect(toOutside.json()).toEqual({ code: "forbidden" });
    expect((await rowOf(id)).unit_id).toBe(unit1);

    const inOutside = await patchEntry(personas.manager, e4, {
      expectedVersion: 1,
      patch: { description: "x" },
    });
    expect(inOutside.statusCode).toBe(404);
  });

  it("lançador edita o próprio e não o de outra pessoa (404, nunca 403)", async () => {
    const own = await freshEntry({ by: personas.staff });
    const mine = await patchEntry(personas.staff, own, {
      expectedVersion: 1,
      patch: { description: "meu" },
    });
    expect(mine.statusCode).toBe(200);
    const theirs = await patchEntry(personas.staff, e1, {
      expectedVersion: 1,
      patch: { description: "alheio" },
    });
    expect(theirs.statusCode).toBe(404);
    expect(theirs.json()).toEqual({ code: "not_found" });
  });

  it("S3: contador e conta somente leitura recebem 403 e nada é gravado (RF23.CA04)", async () => {
    const id = await freshEntry();
    const accountant = await patchEntry(personas.accountant, id, {
      expectedVersion: 1,
      patch: { description: "contador" },
    });
    expect(accountant.statusCode).toBe(403);
    expect(accountant.json()).toEqual({ code: "forbidden" });
    const readOnly = await patchEntry(personas.readOnly, entryC, {
      expectedVersion: 1,
      patch: { description: "somente leitura" },
    });
    expect(readOnly.statusCode).toBe(403);
    expect(readOnly.json()).toEqual({ code: "account_read_only" });
    expect((await rowOf(id)).description).not.toBe("contador");
    expect((await rowOf(entryC)).description).not.toBe("somente leitura");
  });

  it("isolamento: o dono da empresa B não edita lançamento da A (404) e o da A não edita o da B", async () => {
    const id = await freshEntry({ description: "da A" });
    const fromB = await patchEntry(ownerB, id, { expectedVersion: 1, patch: { description: "x" } });
    expect(fromB.statusCode).toBe(404);
    expect(fromB.json()).toEqual({ code: "not_found" });
    const toB = await patchEntry(personas.owner, entryB, {
      expectedVersion: 1,
      patch: { description: "x" },
    });
    expect(toB.statusCode).toBe(404);
    expect((await rowOf(id)).description).toBe("da A");
    expect((await rowOf(entryB)).description).toBe(SECRET_B);
  });

  it("lixeira vencida: 404; lixeira restaurável: 422 EntryDeleted", async () => {
    const gone = await patchEntry(personas.owner, expired, {
      expectedVersion: 1,
      patch: { description: "x" },
    });
    expect(gone.statusCode).toBe(404);
    const inTrash = await patchEntry(personas.owner, scripted, {
      expectedVersion: 2,
      patch: { description: "x" },
    });
    expect(inTrash.statusCode).toBe(422);
    expect(inTrash.json()).toEqual({ code: "invalid_entry", reason: "EntryDeleted" });
  });

  describe("erros de domínio e de pedido", () => {
    it("S7: data de competência hoje + 60 aceita, hoje + 61 recusada com reason", async () => {
      const id = await freshEntry();
      const tooFar = await patchEntry(personas.owner, id, {
        expectedVersion: 1,
        patch: { occurredOn: "2027-01-09" },
      });
      expect(tooFar.statusCode).toBe(422);
      expect(tooFar.json()).toEqual({
        code: "invalid_entry",
        reason: "DateTooFarAhead",
        field: "occurredOn",
      });
      const ok = await patchEntry(personas.owner, id, {
        expectedVersion: 1,
        patch: { occurredOn: "2027-01-08" },
      });
      expect(ok.statusCode).toBe(200);
    });

    it("S7: hoje é o do fuso da unidade do lançamento, não o de São Paulo", async () => {
      const tokyo = uuidv7();
      await admin(
        "insert into units (id, tenant_id, name, timezone) values ($1, $2, 'Tóquio', 'Asia/Tokyo')",
        [tokyo, tenantA],
      );
      const inTokyo = await freshEntry({ unitId: tokyo });
      const inSaoPaulo = await freshEntry();
      // 23h30 UTC: em São Paulo ainda é 09/11 (hoje + 60 = 08/01); em Tóquio já é 10/11 (09/01).
      h.clock.advance(11.5 * 60 * 60 * 1000);
      try {
        const tokyoPatch = await patchEntry(personas.owner, inTokyo, {
          expectedVersion: 1,
          patch: { occurredOn: "2027-01-09" },
        });
        const saoPauloPatch = await patchEntry(personas.owner, inSaoPaulo, {
          expectedVersion: 1,
          patch: { occurredOn: "2027-01-09" },
        });
        expect(tokyoPatch.statusCode).toBe(200);
        expect(saoPauloPatch.statusCode).toBe(422);
      } finally {
        h.clock.reset();
      }
    });

    it("categoria que exige quantidade sem quantidade: 422 QuantityRequired", async () => {
      const meat = uuidv7();
      await admin(
        `insert into categories (id, tenant_id, name, kind, dre_group, requires_quantity)
         values ($1, $2, 'Carnes S', 'expense', 'cmv', true)`,
        [meat, tenantA],
      );
      const id = await freshEntry();
      const response = await patchEntry(personas.owner, id, {
        expectedVersion: 1,
        patch: { categoryId: meat },
      });
      expect(response.statusCode).toBe(422);
      expect(response.json()).toEqual({
        code: "invalid_entry",
        reason: "QuantityRequired",
        field: "quantity",
      });
    });

    it("cadastro desconhecido ou de outra empresa: 422 UnknownReference", async () => {
      const id = await freshEntry();
      for (const patch of [
        { categoryId: uuidv7() },
        { categoryId: categoryB },
        { unitId: unitB },
        { supplier: { id: uuidv7() } },
      ]) {
        const response = await patchEntry(personas.owner, id, { expectedVersion: 1, patch });
        expect(response.statusCode, JSON.stringify(patch)).toBe(422);
        expect(response.json().code).toBe("invalid_entry");
        expect(response.json().reason).toBe("UnknownReference");
      }
      expect(await versionsOf(id)).toHaveLength(1);
    });

    it("sem nada para mudar: 422 NothingToChange, com patch vazio ou igual ao atual", async () => {
      const id = await freshEntry({ description: "Igual" });
      for (const body of [
        { expectedVersion: 1 },
        { expectedVersion: 1, patch: {} },
        { expectedVersion: 1, patch: { description: "Igual" } },
      ]) {
        const response = await patchEntry(personas.owner, id, body);
        expect(response.statusCode, JSON.stringify(body)).toBe(422);
        expect(response.json()).toEqual({ code: "invalid_entry", reason: "NothingToChange" });
      }
      expect(await versionsOf(id)).toHaveLength(1);
    });

    it("corpo inválido: 400 invalid_request, só com o código", async () => {
      const id = await freshEntry();
      for (const body of [
        { patch: { description: "sem versão" } },
        { expectedVersion: 0, patch: { description: "x" } },
        { expectedVersion: 1, patch: { amountCents: 12.5 } },
        { expectedVersion: 1, patch: { tenantId: tenantB } },
        "texto",
      ]) {
        const response = await patchEntry(personas.owner, id, body);
        expect(response.statusCode, JSON.stringify(body)).toBe(400);
        expect(response.json()).toEqual({ code: "invalid_request" });
      }
      const badId = await patchEntry(personas.owner, "nao-e-uuid", {
        expectedVersion: 1,
        patch: { description: "x" },
      });
      expect(badId.statusCode).toBe(400);
    });

    it("sem Origin: 403 origin_forbidden, e sem X-Context: 409 context_changed", async () => {
      const id = await freshEntry();
      const body = { expectedVersion: 1, patch: { description: "x" } };
      const noOrigin = await h.app.inject({
        method: "PATCH",
        url: `/api/entries/${id}`,
        headers: {
          cookie: `${personas.owner.session}; ${CTX}=${personas.owner.ctx}`,
          "x-context": personas.owner.ctx as string,
          "content-type": "application/json",
        },
        payload: JSON.stringify(body),
      });
      expect(noOrigin.statusCode).toBe(403);
      expect(noOrigin.json()).toEqual({ code: "origin_forbidden" });
      const noContext = await patchEntry(personas.owner, id, body, { xContext: null });
      expect(noContext.statusCode).toBe(409);
      expect(noContext.json()).toEqual({ code: "context_changed" });
      expect((await rowOf(id)).version).toBe(1);
    });
  });

  describe("marcar como revisado (RF23.R2)", () => {
    const withFlags = async () => {
      const id = await freshEntry({ description: "Com sinal" });
      await admin("update entries set flags = '{category_to_review,old_date}' where id = $1", [id]);
      return id;
    };

    it("S9: edição e revisão juntas gravam duas versões, na ordem alteração e revisão, com sinais vazios", async () => {
      const id = await withFlags();
      const response = await patchEntry(personas.owner, id, {
        expectedVersion: 1,
        patch: { description: "Corrigido" },
        markReviewed: true,
      });
      expect(response.statusCode).toBe(200);
      expect(entryDetailSchema.parse(response.json())).toMatchObject({
        version: 3,
        description: "Corrigido",
        flags: [],
      });
      const versions = await versionsOf(id);
      expect(versions.map((v) => [v.version, v.action, v.channel])).toEqual([
        [1, "create", "whatsapp"],
        [2, "update", "web"],
        [3, "update", "web"],
      ]);
      // A alteração ainda leva os sinais; a revisão os tira.
      expect(versions[1]?.after.description).toBe("Corrigido");
      expect(versions[1]?.after.flags).toEqual(["category_to_review", "old_date"]);
      expect(versions[2]?.before?.flags).toEqual(["category_to_review", "old_date"]);
      expect(versions[2]?.after.flags).toEqual([]);
      expect((await rowOf(id)).flags).toEqual([]);
    });

    it("S9: revisar sozinho grava uma versão e limpa os sinais", async () => {
      const id = await withFlags();
      const response = await patchEntry(personas.owner, id, {
        expectedVersion: 1,
        markReviewed: true,
      });
      expect(response.statusCode).toBe(200);
      expect(entryDetailSchema.parse(response.json())).toMatchObject({ version: 2, flags: [] });
      expect(await versionsOf(id)).toHaveLength(2);
    });

    it("S9: revisar lançamento sem sinais e sem edição: 200, sem versão nova", async () => {
      const id = await freshEntry();
      const response = await patchEntry(personas.owner, id, {
        expectedVersion: 1,
        markReviewed: true,
      });
      expect(response.statusCode).toBe(200);
      expect(entryDetailSchema.parse(response.json())).toMatchObject({ version: 1 });
      expect(await versionsOf(id)).toHaveLength(1);
    });

    it("S9: edição igual ao atual com revisão vira só a revisão", async () => {
      const id = await withFlags();
      const response = await patchEntry(personas.owner, id, {
        expectedVersion: 1,
        patch: { description: "Com sinal" },
        markReviewed: true,
      });
      expect(response.statusCode).toBe(200);
      expect(await versionsOf(id)).toHaveLength(2);
    });

    it("S9: versão esperada velha com revisão: 409 e os sinais continuam", async () => {
      const id = await withFlags();
      const response = await patchEntry(personas.owner, id, {
        expectedVersion: 7,
        markReviewed: true,
      });
      expect(response.statusCode).toBe(409);
      expect((await rowOf(id)).flags).toEqual(["category_to_review", "old_date"]);
    });
  });

  describe("fornecedor (RF12.R7, RF10)", () => {
    const suppliersNamed = async (name: string) =>
      (await admin("select id, tenant_id from suppliers where name = $1", [name])).rows;

    it("nome digitado que já existe, sem caixa nem acento, associa o cadastrado e não cria outro", async () => {
      const known = uuidv7();
      await admin("insert into suppliers (id, tenant_id, name) values ($1, $2, 'Atacadão S')", [
        known,
        tenantA,
      ]);
      const id = await freshEntry();
      const response = await patchEntry(personas.owner, id, {
        expectedVersion: 1,
        patch: { supplier: { name: "  ATACADAO s " } },
      });
      expect(response.statusCode).toBe(200);
      expect((await rowOf(id)).supplier_id).toBe(known);
      expect(await suppliersNamed("Atacadão S")).toHaveLength(1);
      expect(
        (
          await admin(
            "select count(*)::int as n from suppliers where tenant_id = $1 and name ilike 'atacadao s'",
            [tenantA],
          )
        ).rows[0],
      ).toEqual({ n: 0 });
    });

    it("nome novo cria o fornecedor na empresa, junto da edição", async () => {
      const id = await freshEntry();
      const response = await patchEntry(personas.owner, id, {
        expectedVersion: 1,
        patch: { supplier: { name: "Padaria Nova S" } },
      });
      expect(response.statusCode).toBe(200);
      const created = await suppliersNamed("Padaria Nova S");
      expect(created).toHaveLength(1);
      expect(created[0]?.tenant_id).toBe(tenantA);
      expect((await rowOf(id)).supplier_id).toBe(created[0]?.id);
      expect(entryDetailSchema.parse(response.json()).supplier).toEqual({
        id: created[0]?.id,
        name: "Padaria Nova S",
      });
    });

    it("edição recusada (versão velha ou erro de domínio) não deixa fornecedor criado", async () => {
      const id = await freshEntry();
      const stale = await patchEntry(personas.owner, id, {
        expectedVersion: 5,
        patch: { supplier: { name: "Fantasma Um S" } },
      });
      expect(stale.statusCode).toBe(409);
      const invalid = await patchEntry(personas.owner, id, {
        expectedVersion: 1,
        patch: { supplier: { name: "Fantasma Dois S" }, occurredOn: "2030-01-01" },
      });
      expect(invalid.statusCode).toBe(422);
      expect(await suppliersNamed("Fantasma Um S")).toHaveLength(0);
      expect(await suppliersNamed("Fantasma Dois S")).toHaveLength(0);
    });

    it("limpar o fornecedor com null e escolher um de outra empresa: 422", async () => {
      const own = uuidv7();
      await admin("insert into suppliers (id, tenant_id, name) values ($1, $2, 'Dono do S')", [
        own,
        tenantA,
      ]);
      const id = await freshEntry();
      await admin("update entries set supplier_id = $2 where id = $1", [id, own]);
      const cleared = await patchEntry(personas.owner, id, {
        expectedVersion: 1,
        patch: { supplier: null },
      });
      expect(cleared.statusCode).toBe(200);
      expect((await rowOf(id)).supplier_id).toBeNull();

      const foreign = uuidv7();
      await admin("insert into suppliers (id, tenant_id, name) values ($1, $2, 'Da B')", [
        foreign,
        tenantB,
      ]);
      const other = await patchEntry(personas.owner, id, {
        expectedVersion: 2,
        patch: { supplier: { id: foreign } },
      });
      expect(other.statusCode).toBe(422);
      expect(other.json()).toEqual({
        code: "invalid_entry",
        reason: "UnknownReference",
        field: "supplier",
      });
    });
  });

  it("registro de log da edição: nenhuma linha traz descrição, nome de fornecedor nem contexto (RNF11)", async () => {
    const id = await freshEntry();
    h.logLines.length = 0;
    await patchEntry(personas.owner, id, {
      expectedVersion: 1,
      patch: { description: "descricao-secreta-log", supplier: { name: "fornecedor-secreto-log" } },
    });
    await patchEntry(personas.owner, id, {
      expectedVersion: 1,
      patch: { description: "outra-descricao-secreta" },
    });
    await patchEntry(personas.owner, id, {
      expectedVersion: 2,
      patch: { occurredOn: "2030-01-01", description: "terceira-secreta" },
    });
    expect(h.logLines.length).toBeGreaterThan(0);
    const logs = h.logLines.join("\n");
    for (const secret of [
      "descricao-secreta-log",
      "fornecedor-secreto-log",
      "outra-descricao-secreta",
      "terceira-secreta",
      personas.owner.ctx as string,
      personas.owner.session.split("=")[1] as string,
    ]) {
      expect(logs, secret).not.toContain(secret);
    }
  });
});

// ---------------------------------------------------------------------------------------
// Exclusão, restauração e lote (F3b, RF24)
// ---------------------------------------------------------------------------------------

const deleteEntry = (who: PersonaSession, id: string, body?: unknown) =>
  call(who, "DELETE", `/api/entries/${id}`, { body });
const restoreEntryCall = (who: PersonaSession, id: string) =>
  call(who, "POST", `/api/entries/${id}/restore`);
const batchPreview = (who: PersonaSession, ids: string[]) =>
  call(who, "POST", "/api/entries/batch/preview", { body: { ids } });
const batchDelete = (who: PersonaSession, ids: string[], reason?: string) =>
  call(who, "POST", "/api/entries/batch/delete", { body: { ids, reason } });

const isDeleted = async (id: string) => (await rowOf(id)).deleted_at !== null;

/** Soma independente, direto no banco, dos valores brutos dos ids. */
const sumInDb = async (ids: string[]) =>
  Number(
    (
      await admin(
        "select coalesce(sum(amount_cents), 0)::text as s from entries where id = any($1)",
        [ids],
      )
    ).rows[0]?.s,
  );

describe("DELETE e restauração de um lançamento (RF24)", () => {
  it("excluído some da lista e dos totais (CA01), continua no banco com deleted_at (CA03) e o histórico mostra exclusão e restauração com canal web (CA02)", async () => {
    const id = await freshEntry({ amountCents: 777_700, occurredOn: "2026-11-07" });
    const before = await totalsOf(personas.owner);
    expect(await idsOf(personas.owner)).toContain(id);

    const deleted = await deleteEntry(personas.owner, id, { reason: "Lançado em duplicidade" });
    expect(deleted.statusCode).toBe(200);
    expect(entryDetailSchema.parse(deleted.json())).toMatchObject({ id, version: 2 });
    expect(await idsOf(personas.owner)).not.toContain(id);
    expect((await totalsOf(personas.owner)).expenseCents).toBe(before.expenseCents - 777_700);
    // Nada é apagado de verdade (RNF04): a linha fica, com autor, motivo e prazo.
    expect(await rowOf(id)).toMatchObject({
      delete_reason: "Lançado em duplicidade",
      deleted_by: personas.owner.userId,
    });
    expect((await rowOf(id)).deleted_at).not.toBeNull();
    expect((await rowOf(id)).restorable_until).not.toBeNull();

    const restored = await restoreEntryCall(personas.manager, id);
    expect(restored.statusCode).toBe(200);
    expect(await idsOf(personas.owner)).toContain(id);
    expect((await totalsOf(personas.owner)).expenseCents).toBe(before.expenseCents);
    expect(await rowOf(id)).toMatchObject({
      deleted_at: null,
      deleted_by: null,
      delete_reason: null,
      restorable_until: null,
      version: 3,
    });

    const detail = await detailOf(personas.owner, id);
    expect(detail.versions.map((v) => [v.version, v.action, v.channel])).toEqual([
      [1, "create", "whatsapp"],
      [2, "delete", "web"],
      [3, "restore", "web"],
    ]);
    expect(detail.versions[1]?.changedBy.id).toBe(personas.owner.userId);
    expect(detail.versions[2]?.changedBy.id).toBe(personas.manager.userId);
  });

  it("sem corpo e com motivo só de espaços: exclui sem motivo", async () => {
    const a = await freshEntry();
    const b = await freshEntry();
    expect((await deleteEntry(personas.owner, a)).statusCode).toBe(200);
    expect((await deleteEntry(personas.owner, b, { reason: "   " })).statusCode).toBe(200);
    expect((await rowOf(a)).delete_reason).toBeNull();
    expect((await rowOf(b)).delete_reason).toBeNull();
  });

  it("motivo de 200 caracteres passa; de 201 dá 400 invalid_request e nada muda (RF24.R1)", async () => {
    const id = await freshEntry();
    const long = await deleteEntry(personas.owner, id, { reason: "a".repeat(201) });
    expect(long.statusCode).toBe(400);
    expect(long.json()).toEqual({ code: "invalid_request" });
    expect(await isDeleted(id)).toBe(false);
    expect((await deleteEntry(personas.owner, id, { reason: "a".repeat(200) })).statusCode).toBe(
      200,
    );
  });

  it("excluir de novo um excluído: 422 invalid_entry EntryAlreadyDeleted; restaurar um ativo: 422 EntryNotDeleted", async () => {
    const id = await freshEntry();
    const notDeleted = await restoreEntryCall(personas.owner, id);
    expect(notDeleted.statusCode).toBe(422);
    expect(notDeleted.json()).toEqual({ code: "invalid_entry", reason: "EntryNotDeleted" });
    await deleteEntry(personas.owner, id);
    const again = await deleteEntry(personas.owner, id);
    expect(again.statusCode).toBe(422);
    expect(again.json()).toEqual({ code: "invalid_entry", reason: "EntryAlreadyDeleted" });
    expect((await rowOf(id)).version).toBe(2);
  });

  it("S6: no 30º dia (prazo vence hoje) restaura; no 31º (venceu ontem) dá 404 e nada muda (RF24.R2, CA02)", async () => {
    const inTime = await freshEntry({
      deleted: { by: personas.owner.userId, reason: null, restorableUntil: TODAY },
    });
    const late = await freshEntry({
      deleted: { by: personas.owner.userId, reason: null, restorableUntil: YESTERDAY },
    });
    const ok = await restoreEntryCall(personas.owner, inTime);
    expect(ok.statusCode).toBe(200);
    expect((await rowOf(inTime)).deleted_at).toBeNull();

    const gone = await restoreEntryCall(personas.owner, late);
    expect(gone.statusCode).toBe(404);
    expect(gone.json()).toEqual({ code: "not_found" });
    expect(await isDeleted(late)).toBe(true);
    expect((await rowOf(late)).version).toBe(1);
    // Excluir o que está na lixeira vencida também é 404.
    expect((await deleteEntry(personas.owner, late)).statusCode).toBe(404);
  });

  it("S8: lançador exclui e restaura os próprios; o alheio dá 404 e nada muda", async () => {
    const own = await freshEntry({ by: personas.staff });
    const foreign = await freshEntry({ by: personas.owner });
    const foreignTrash = await freshEntry({
      by: personas.owner,
      deleted: { by: personas.owner.userId, reason: null, restorableUntil: TODAY },
    });

    expect((await deleteEntry(personas.staff, own)).statusCode).toBe(200);
    expect((await restoreEntryCall(personas.staff, own)).statusCode).toBe(200);

    const del = await deleteEntry(personas.staff, foreign);
    expect(del.statusCode).toBe(404);
    expect(del.json()).toEqual({ code: "not_found" });
    const res = await restoreEntryCall(personas.staff, foreignTrash);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ code: "not_found" });
    expect(await isDeleted(foreign)).toBe(false);
    expect(await isDeleted(foreignTrash)).toBe(true);
  });

  it("gerente sem VER_FOLHA: lançamento da folha (sensível) dá 404 na exclusão e na restauração, e nada muda", async () => {
    const payroll = await freshEntry({ categoryId: payrollA });
    const payrollTrash = await freshEntry({
      categoryId: payrollA,
      deleted: { by: personas.owner.userId, reason: null, restorableUntil: TODAY },
    });
    expect((await deleteEntry(personas.managerNoPayroll, payroll)).statusCode).toBe(404);
    expect((await restoreEntryCall(personas.managerNoPayroll, payrollTrash)).statusCode).toBe(404);
    expect(await isDeleted(payroll)).toBe(false);
    expect(await isDeleted(payrollTrash)).toBe(true);
    // Com VER_FOLHA o mesmo lançamento é tratado normalmente.
    expect((await deleteEntry(personas.manager, payroll)).statusCode).toBe(200);
  });

  it("outra empresa e unidade fora do acesso: 404 igual ao de id inexistente", async () => {
    const outOfUnit = await freshEntry({ unitId: unit3 });
    for (const id of [entryB, outOfUnit, uuidv7()]) {
      const del = await deleteEntry(personas.manager, id);
      expect(del.statusCode, id).toBe(404);
      expect(del.json()).toEqual({ code: "not_found" });
      expect((await restoreEntryCall(personas.manager, id)).statusCode, id).toBe(404);
    }
    expect(await isDeleted(entryB)).toBe(false);
    expect(await isDeleted(outOfUnit)).toBe(false);
  });

  it("S3: contador e conta somente leitura recebem 403 e o lançamento não muda", async () => {
    const id = await freshEntry();
    expect((await deleteEntry(personas.accountant, id)).statusCode).toBe(403);
    expect((await deleteEntry(personas.readOnly, entryC)).statusCode).toBe(403);
    expect(await isDeleted(id)).toBe(false);
    expect(await isDeleted(entryC)).toBe(false);
  });
});

describe("lote: prévia e exclusão (RF24.Obs3)", () => {
  const trio = async () => [
    await freshEntry({ amountCents: 1_111 }),
    await freshEntry({ amountCents: 2_222, type: "revenue" }),
    await freshEntry({ amountCents: 3_333, unitId: unit2 }),
  ];

  it("a prévia devolve quantidade e soma iguais à soma independente do banco e não grava nada", async () => {
    const ids = await trio();
    const response = await batchPreview(personas.manager, ids);
    expect(response.statusCode).toBe(200);
    const body = batchPreviewSchema.parse(response.json());
    expect(body).toEqual({ count: 3, totalCents: await sumInDb(ids) });
    expect(body.totalCents).toBe(6_666);
    for (const id of ids) expect(await isDeleted(id)).toBe(false);
  });

  it("a exclusão apaga todos de uma vez, devolve a mesma quantidade e soma, e gera uma versão delete web por lançamento", async () => {
    const ids = await trio();
    const total = await sumInDb(ids);
    const response = await batchDelete(personas.owner, ids, "Limpeza");
    expect(response.statusCode).toBe(200);
    expect(batchPreviewSchema.parse(response.json())).toEqual({ count: 3, totalCents: total });
    for (const id of ids) {
      expect(await rowOf(id)).toMatchObject({ delete_reason: "Limpeza", version: 2 });
      expect((await rowOf(id)).deleted_at).not.toBeNull();
      expect((await versionsOf(id)).map((v) => [v.action, v.channel])).toEqual([
        ["create", "whatsapp"],
        ["delete", "web"],
      ]);
    }
    expect(await idsOf(personas.owner)).not.toEqual(expect.arrayContaining(ids));
  });

  it("S5: um id de outra empresa, de unidade fora do acesso ou inexistente: 404 e nada é excluído", async () => {
    const outOfUnit = await freshEntry({ unitId: unit3 });
    for (const bad of [entryB, outOfUnit, uuidv7()]) {
      const ids = await trio();
      for (const run of [batchPreview, (w: PersonaSession, i: string[]) => batchDelete(w, i)]) {
        const response = await run(personas.manager, [...ids, bad]);
        expect(response.statusCode, bad).toBe(404);
        expect(response.json()).toEqual({ code: "not_found" });
      }
      for (const id of ids) expect(await isDeleted(id)).toBe(false);
    }
    expect(await isDeleted(entryB)).toBe(false);
    expect(await isDeleted(outOfUnit)).toBe(false);
  });

  it("S5: um sensível invisível ao gerente sem VER_FOLHA: 404, nada excluído, e o 404 não revela o motivo", async () => {
    const ids = await trio();
    const payroll = await freshEntry({ categoryId: payrollA });
    const response = await batchDelete(personas.managerNoPayroll, [...ids, payroll]);
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ code: "not_found" });
    const preview = await batchPreview(personas.managerNoPayroll, [...ids, payroll]);
    expect(preview.statusCode).toBe(404);
    for (const id of [...ids, payroll]) expect(await isDeleted(id)).toBe(false);
    // Com VER_FOLHA o mesmo lote passa.
    expect((await batchDelete(personas.manager, [...ids, payroll])).statusCode).toBe(200);
  });

  it("S5: um já excluído (mesmo na lixeira restaurável): 404 e nada é excluído", async () => {
    const ids = await trio();
    const trashed = await freshEntry({
      deleted: { by: personas.owner.userId, reason: null, restorableUntil: TODAY },
    });
    const response = await batchDelete(personas.owner, [...ids, trashed]);
    expect(response.statusCode).toBe(404);
    for (const id of ids) expect(await isDeleted(id)).toBe(false);
    expect((await rowOf(trashed)).version).toBe(1);
  });

  it("ids repetidos (também em maiúsculas), vazios ou mais de 100: 400 invalid_request", async () => {
    const [a] = await trio();
    const dup = await batchDelete(personas.owner, [a as string, (a as string).toUpperCase()]);
    expect(dup.statusCode).toBe(400);
    expect(dup.json()).toEqual({ code: "invalid_request" });
    expect((await batchDelete(personas.owner, [])).statusCode).toBe(400);
    const many = Array.from({ length: 101 }, () => uuidv7());
    expect((await batchPreview(personas.owner, many)).statusCode).toBe(400);
    expect(await isDeleted(a as string)).toBe(false);
  });

  it("S8: lançador no lote, mesmo só com os próprios: 403 e nada muda", async () => {
    const own = await freshEntry({ by: personas.staff });
    for (const run of [batchPreview, (w: PersonaSession, i: string[]) => batchDelete(w, i)]) {
      const response = await run(personas.staff, [own]);
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ code: "forbidden" });
    }
    expect(await isDeleted(own)).toBe(false);
  });

  it("S3: contador e conta somente leitura: 403 e nada muda", async () => {
    const id = await freshEntry();
    expect((await batchDelete(personas.accountant, [id])).statusCode).toBe(403);
    expect((await batchPreview(personas.accountant, [id])).statusCode).toBe(403);
    expect((await batchDelete(personas.readOnly, [entryC])).statusCode).toBe(403);
    expect(await isDeleted(id)).toBe(false);
    expect(await isDeleted(entryC)).toBe(false);
  });
});

describe("registro de log da exclusão e do lote (RNF11)", () => {
  it("nenhuma linha traz motivo, descrição nem contexto", async () => {
    const id = await freshEntry({ description: "descricao-secreta-exclusao" });
    const other = await freshEntry({ description: "descricao-secreta-lote" });
    h.logLines.length = 0;
    await deleteEntry(personas.owner, id, { reason: "motivo-secreto-log" });
    await batchDelete(personas.owner, [other, entryB], "motivo-secreto-lote");
    await restoreEntryCall(personas.owner, id);
    await deleteEntry(personas.owner, id, { reason: "x".repeat(201) });
    const logs = h.logLines.join("\n");
    for (const secret of [
      "descricao-secreta-exclusao",
      "descricao-secreta-lote",
      "motivo-secreto-log",
      "motivo-secreto-lote",
      personas.owner.ctx as string,
      personas.owner.session.split("=")[1] as string,
    ]) {
      expect(logs, secret).not.toContain(secret);
    }
  });
});

describe("Origin nas escritas de exclusão, restauração e lote (RNF01.R10)", () => {
  it("sem Origin: 403 origin_forbidden em DELETE e nos POSTs, e nada muda", async () => {
    const id = await freshEntry();
    const headers = {
      cookie: `${personas.owner.session}; ${CTX}=${personas.owner.ctx}`,
      "x-context": personas.owner.ctx as string,
      "content-type": "application/json",
    };
    const requests: Array<["DELETE" | "POST", string, unknown]> = [
      ["DELETE", `/api/entries/${id}`, {}],
      ["POST", `/api/entries/${id}/restore`, {}],
      ["POST", "/api/entries/batch/preview", { ids: [id] }],
      ["POST", "/api/entries/batch/delete", { ids: [id] }],
    ];
    for (const [method, url, body] of requests) {
      const response = await h.app.inject({ method, url, headers, payload: JSON.stringify(body) });
      expect(response.statusCode, url).toBe(403);
      expect(response.json()).toEqual({ code: "origin_forbidden" });
    }
    expect(await isDeleted(id)).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------
// GET /api/trash (F3b, RF24)
// ---------------------------------------------------------------------------------------

const TRASH_PERIOD = "deletedFrom=2000-01-01&deletedTo=2100-12-31";

async function trashOf(who: PersonaSession, query = ""): Promise<TrashResponse> {
  const response = await get(who, `/api/trash?${TRASH_PERIOD}${query}`);
  expect(response.statusCode).toBe(200);
  return conforming(trashResponseSchema.parse(response.json()), response.json());
}

const trashIds = async (who: PersonaSession, query = "") =>
  (await trashOf(who, query)).items.map((item) => item.id);

/** Lançamento da empresa A já na lixeira, com prazo que vence hoje (30º dia). */
const inTrash = (over: Partial<Parameters<typeof freshEntry>[0]> = {}) =>
  freshEntry({
    deleted: { by: personas.owner.userId, reason: "Motivo interno", restorableUntil: TODAY },
    ...over,
  });

describe("GET /api/trash: lixeira (RF24.R2)", () => {
  it("contador: 403 forbidden, só o código, sem dado", async () => {
    const id = await inTrash();
    const response = await get(personas.accountant, `/api/trash?${TRASH_PERIOD}`);
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ code: "forbidden" });
    expect(response.body).not.toContain(id);
  });

  it("S6: prazo que vence hoje (30º dia) aparece; o que venceu ontem (31º) não", async () => {
    const day30 = await inTrash();
    const day31 = await inTrash({
      deleted: { by: personas.owner.userId, reason: null, restorableUntil: YESTERDAY },
    });
    const page = await trashOf(personas.owner);
    const ids = page.items.map((item) => item.id);
    expect(ids).toContain(day30);
    expect(ids).not.toContain(day31);
    expect(page.items.find((item) => item.id === day30)).toMatchObject({
      canRestore: true,
      deleted: {
        by: { id: personas.owner.userId },
        reason: "Motivo interno",
        restorableUntil: TODAY,
      },
    });
    // O mesmo critério da restauração: o que a lixeira não mostra, restaurar recusa.
    expect((await restoreEntryCall(personas.owner, day31)).statusCode).toBe(404);
  });

  it("lançador vê só os próprios excluídos, e o filtro de quem excluiu é ignorado para ele", async () => {
    const own = await inTrash({ by: personas.staff });
    const foreign = await inTrash({ by: personas.owner });
    const mine = await trashIds(personas.staff);
    expect(mine).toContain(own);
    expect(mine).not.toContain(foreign);
    const filtered = await trashIds(personas.staff, `&deletedBy=${personas.manager.userId}`);
    expect(filtered).toContain(own);
    expect(filtered).not.toContain(foreign);
    expect((await trashOf(personas.staff)).items.every((item) => item.canRestore)).toBe(true);
  });

  it("gerente sem VER_FOLHA não vê a folha excluída; gerente com VER_FOLHA e dono veem", async () => {
    const payroll = await inTrash({ categoryId: payrollA, description: PAYROLL_TEXT });
    const plain = await inTrash();
    const blind = await get(personas.managerNoPayroll, `/api/trash?${TRASH_PERIOD}`);
    expect(blind.body).not.toContain(payroll);
    expect(blind.body).not.toContain(PAYROLL_TEXT);
    expect(blind.body).toContain(plain);
    for (const who of [personas.owner, personas.manager]) {
      expect(await trashIds(who)).toEqual(expect.arrayContaining([payroll, plain]));
    }
  });

  it("outra empresa e unidade fora do acesso ficam invisíveis; tenantId na query é ignorado", async () => {
    const other = await addEntry({
      tenantId: tenantB,
      unitId: unitB,
      createdBy: ownerB.userId,
      amountCents: 1_234,
      categoryId: categoryB,
      deleted: { by: ownerB.userId, reason: SECRET_B, restorableUntil: TODAY },
    });
    const outOfUnit = await inTrash({ unitId: unit3 });
    const response = await get(personas.manager, `/api/trash?${TRASH_PERIOD}&tenantId=${tenantB}`);
    expect(response.statusCode).toBe(200);
    for (const secret of [other, SECRET_B, outOfUnit]) {
      expect(response.body).not.toContain(secret);
    }
    expect(await trashIds(ownerB)).toEqual([other]);
    expect(await trashIds(personas.owner)).not.toContain(other);
  });

  it("filtros: período da exclusão, unidade e quem excluiu; unidade fora do acesso dá 403", async () => {
    const early = await inTrash({
      deleted: { by: personas.manager.userId, reason: null, restorableUntil: TODAY },
    });
    const late = await inTrash({ unitId: unit2 });
    await admin("update entries set deleted_at = $2 where id = $1", [
      early,
      "2026-11-05T15:00:00Z",
    ]);
    await admin("update entries set deleted_at = $2 where id = $1", [late, "2026-11-08T15:00:00Z"]);
    const mine = new Set([early, late]);
    const idsOf2 = async (query: string) => {
      const response = await get(personas.owner, `/api/trash?${query}`);
      expect(response.statusCode, query).toBe(200);
      return (response.json() as TrashResponse).items
        .map((item) => item.id)
        .filter((id) => mine.has(id));
    };
    expect(await idsOf2("deletedFrom=2026-11-05&deletedTo=2026-11-05")).toEqual([early]);
    expect(await idsOf2("deletedFrom=2026-11-06&deletedTo=2026-11-09")).toEqual([late]);
    expect(await idsOf2(`${TRASH_PERIOD}&unitIds=${unit2}`)).toEqual([late]);
    expect(await idsOf2(`${TRASH_PERIOD}&deletedBy=${personas.manager.userId}`)).toEqual([early]);
    const denied = await get(personas.manager, `/api/trash?${TRASH_PERIOD}&unitIds=${unit3}`);
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toEqual({ code: "forbidden" });
  });

  it("paginação por cursor: sem repetir nem pular; cursor adulterado dá 400", async () => {
    const created = [await inTrash(), await inTrash(), await inTrash()];
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 100; guard++) {
      const page: TrashResponse = await trashOf(
        personas.owner,
        `&limit=2${cursor === null ? "" : `&cursor=${cursor}`}`,
      );
      expect(page.items.length).toBeLessThanOrEqual(2);
      seen.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
      if (cursor === null) break;
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).toEqual(expect.arrayContaining(created));
    const bad = await get(personas.owner, `/api/trash?${TRASH_PERIOD}&cursor=xxxx`);
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toEqual({ code: "invalid_request" });
  });

  it("pedido inválido: 400 invalid_request só com o código", async () => {
    for (const query of [
      "",
      "deletedFrom=2026-11-09&deletedTo=2026-11-01",
      `${TRASH_PERIOD}&limit=101`,
    ]) {
      const response = await get(personas.owner, `/api/trash?${query}`);
      expect(response.statusCode, query).toBe(400);
      expect(response.json()).toEqual({ code: "invalid_request" });
    }
  });

  it("conta somente leitura lê a lixeira, sem ação de restaurar", async () => {
    const row = (await admin("select * from entries where id = $1", [entryC])).rows[0] as {
      tenant_id: string;
      unit_id: string;
      category_id: string;
    };
    const id = await addEntry({
      tenantId: row.tenant_id,
      unitId: row.unit_id,
      createdBy: personas.readOnly.userId,
      amountCents: 500,
      categoryId: row.category_id,
      deleted: { by: personas.readOnly.userId, reason: null, restorableUntil: TODAY },
    });
    const page = await trashOf(personas.readOnly);
    expect(page.items.find((item) => item.id === id)).toMatchObject({ canRestore: false });
  });
});
