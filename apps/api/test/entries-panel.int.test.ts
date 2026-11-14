import { createEntry, editEntry, type Money } from "@app/core";
import {
  type EntryDetail,
  type EntryListResponse,
  type EntryOptions,
  type EntrySource,
  type EntryTotals,
  entryDetailSchema,
  entryListResponseSchema,
  entryOptionsSchema,
  entrySourceSchema,
  entryTotalsSchema,
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
      const response = await h.app.inject({ method: "GET", url: route.url(FIXTURE, "owner") });
      expect(response.statusCode, route.name).toBe(401);
    }
  });
});

describe("contexto do painel nas rotas de lançamentos", () => {
  it("sem X-Context: 409 context_changed, sem dado", async () => {
    for (const route of ROUTE_MATRIX) {
      const response = await get(personas.owner, route.url(FIXTURE, "owner"), {
        xContext: null,
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
      for (const route of ROUTE_MATRIX) {
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
      const response = await get(personas.owner, route.url(FIXTURE, "owner"), { ctx: forged });
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
    expect(options.units).toEqual([{ id: unitB, name: "Unidade da B" }]);
    expect(options.categories.map((category) => category.id)).not.toContain(categoryA);
    expect(options.members.map((member) => member.id)).toEqual([ownerB.userId]);
  });
});

describe("GET /api/entries/options", () => {
  it("gerente com duas unidades de acesso e o seletor numa delas recebe as duas, e não a terceira", async () => {
    for (const who of [personas.manager, personas.managerNoPayroll]) {
      const options = await optionsOf(who);
      expect(options.units).toEqual([
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
    expect(options.units).toEqual([{ id: unit1, name: "Unidade 1" }]);
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
