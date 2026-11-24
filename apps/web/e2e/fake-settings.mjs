// Configurações da API falsa (F6a, RF05, RF08, RF09): espelha /api/settings/* e /api/restricted/* à mão,
// sem a regra de verdade (validação, unicidade, último ativo e reaplicação ficam na API real). O estado
// fica em memória, por empresa, e volta ao inicial com resetSettings(). Sem Math.random e sem Date.now:
// ids, datas e contadores vêm de constantes fixas ou do contador do estado. O contrato é
// packages/core/src/contracts/settings.ts, espelhado à mão (este arquivo não importa o TypeScript).

const FIXED_TIME = "2026-11-23T12:00:00.000Z";
const FINISHED_TIME = "2026-11-23T12:01:00.000Z";
const GROSS_CENTS = 10000;
const MAX_FEE_BP = 10000;
const REAPPLY_MATCHED = 3;
const REAPPLY_DELTA_NET_CENTS = -960;
const REAPPLY_UPDATED = 3;
const FILIAL_SEED_N = 23;
const FIRST_CREATED_N = 100;

// Ids determinísticos e válidos (UUID v7 com variante 8), a partir do número.
const fixedId = (n) => `0190b000-0000-7000-8000-${String(n).padStart(12, "0")}`;

const PAYMENT_SEED = [
  { name: "Dinheiro", type: "cash" },
  { name: "Pix", type: "pix" },
  { name: "Débito", type: "debit" },
  { name: "Crédito", type: "credit", isDefaultCard: true },
  { name: "Voucher", type: "voucher" },
  { name: "Não informada", type: "other", protected: true },
];

const CHANNEL_SEED = [
  { name: "Salão", type: "dine_in" },
  { name: "Delivery próprio", type: "own_delivery" },
  { name: "iFood", type: "app" },
  { name: "Retirada", type: "pickup" },
  { name: "Não informado", type: "other", protected: true },
];

const notFound = { status: 404, body: { code: "not_found" } };
const forbidden = { status: 403, body: { code: "forbidden" } };
const accountReadOnly = { status: 403, body: { code: "account_read_only" } };
const invalidRequest = { status: 400, body: { code: "invalid_request" } };
const nameTaken = { status: 409, body: { code: "name_taken" } };
const ok = (body) => ({ status: 200, body });
const created = (body) => ({ status: 201, body });

const PAYMENT_KEYS = [
  "name",
  "type",
  "feePercentBp",
  "feeFixedCents",
  "aliases",
  "status",
  "isDefaultCard",
];
const CHANNEL_KEYS = ["name", "type", "feePercentBp", "aliases", "status"];
const UNIT_KEYS = [
  "name",
  "aliases",
  "cnpj",
  "uf",
  "city",
  "timezone",
  "status",
  "defaultSalesChannelId",
];

const isBp = (v) => Number.isInteger(v) && v >= 0 && v <= MAX_FEE_BP;
const isCents = (v) => Number.isInteger(v) && v >= 0;
const nonEmpty = (v) => typeof v === "string" && v.trim().length > 0;
const FIELD_CHECKS = {
  name: nonEmpty,
  type: nonEmpty,
  uf: nonEmpty,
  city: nonEmpty,
  timezone: nonEmpty,
  feePercentBp: isBp,
  feeFixedCents: isCents,
  aliases: (v) => Array.isArray(v) && v.every((x) => typeof x === "string" && x.length > 0),
  status: (v) => v === "active" || v === "inactive",
  isDefaultCard: (v) => typeof v === "boolean",
  cnpj: (v) => v === null || typeof v === "string",
  defaultSalesChannelId: (v) => v === null || typeof v === "string",
};

// Corpo válido: só chaves permitidas (o contrato é estrito), com o tipo certo, e com as obrigatórias.
function bodyIsValid(body, allowed, required) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  for (const key of Object.keys(body)) {
    if (!allowed.includes(key) || !FIELD_CHECKS[key](body[key])) return false;
  }
  return required.every((key) => key in body);
}

function paymentSeed() {
  return PAYMENT_SEED.map((p, i) => ({
    id: fixedId(i + 1),
    name: p.name,
    type: p.type,
    feePercentBp: 0,
    feeFixedCents: 0,
    aliases: [],
    status: "active",
    isDefaultCard: p.isDefaultCard === true,
    protected: p.protected === true,
  }));
}

function channelSeed() {
  return CHANNEL_SEED.map((c, i) => ({
    id: fixedId(i + 11),
    name: c.name,
    type: c.type,
    feePercentBp: 0,
    aliases: [],
    status: "active",
    protected: c.protected === true,
  }));
}

function unitRow(id, name) {
  return {
    id,
    name,
    aliases: [],
    cnpj: null,
    uf: "SP",
    city: "São Paulo",
    timezone: "America/Sao_Paulo",
    status: "active",
    defaultSalesChannelId: null,
    onlyUnitMemberCount: 0,
  };
}

// Unidades da persona; se ela tem uma só, entra uma "Filial" fixa para os testes poderem inativar uma.
function unitSeed(company) {
  const units = company.units.map((u) => unitRow(u.id, u.name));
  if (units.length === 1) units.push(unitRow(fixedId(FILIAL_SEED_N), "Filial"));
  return units;
}

const stateByTenant = new Map();

function stateOf(company) {
  if (!stateByTenant.has(company.tenantId)) {
    stateByTenant.set(company.tenantId, {
      paymentMethods: paymentSeed(),
      salesChannels: channelSeed(),
      units: unitSeed(company),
      reapplications: [],
      createdUnitIds: new Set(),
      next: FIRST_CREATED_N,
    });
  }
  return stateByTenant.get(company.tenantId);
}

/** Unidades ativas criadas pela tela de configurações: o seletor de contexto (`GET /api/units`) as lista. */
export function createdUnits(tenantId) {
  const s = stateByTenant.get(tenantId);
  if (!s) return [];
  return s.units
    .filter((u) => s.createdUnitIds.has(u.id) && u.status === "active")
    .map((u) => ({ id: u.id, name: u.name }));
}

export function resetSettings() {
  stateByTenant.clear();
}

function nextId(s) {
  const id = fixedId(s.next);
  s.next += 1;
  return id;
}

// Nome igual sem caixa e sem acento (a unicidade da API real segue a mesma ideia).
function nameKey(name) {
  return name
    .normalize("NFD")
    .replace(/\p{Mn}/gu, "")
    .trim()
    .toLowerCase();
}

function isNameTaken(list, name, exceptId) {
  const key = nameKey(name);
  return list.some((x) => x.id !== exceptId && nameKey(x.name) === key);
}

function clearOtherDefaults(list, id) {
  for (const x of list) if (x.id !== id) x.isDefaultCard = false;
}

function listItems(items, searchParams) {
  const status = searchParams.get("status");
  const type = searchParams.get("type");
  return ok({
    items: items.filter((x) => (!status || x.status === status) && (!type || x.type === type)),
  });
}

// Leitura: qualquer papel com catalog:view (staff não tem). Escrita: dono, com a conta ativa.
function gateFor(company, write) {
  if (!write) return company.role === "staff" ? forbidden : null;
  if (company.role !== "owner") return forbidden;
  if (company.accountStatus !== "active") return accountReadOnly;
  return null;
}

function createPaymentMethod(s, input) {
  if (!bodyIsValid(input, PAYMENT_KEYS, ["name", "type"])) return invalidRequest;
  const name = input.name.trim();
  if (isNameTaken(s.paymentMethods, name)) return nameTaken;
  const item = {
    id: nextId(s),
    name,
    type: input.type,
    feePercentBp: input.feePercentBp ?? 0,
    feeFixedCents: input.feeFixedCents ?? 0,
    aliases: input.aliases ?? [],
    status: input.status ?? "active",
    isDefaultCard: input.isDefaultCard === true,
    protected: false,
  };
  if (item.isDefaultCard) clearOtherDefaults(s.paymentMethods, item.id);
  s.paymentMethods.push(item);
  return created(item);
}

function createSalesChannel(s, input) {
  if (!bodyIsValid(input, CHANNEL_KEYS, ["name", "type"])) return invalidRequest;
  const name = input.name.trim();
  if (isNameTaken(s.salesChannels, name)) return nameTaken;
  const item = {
    id: nextId(s),
    name,
    type: input.type,
    feePercentBp: input.feePercentBp ?? 0,
    aliases: input.aliases ?? [],
    status: input.status ?? "active",
    protected: false,
  };
  s.salesChannels.push(item);
  return created(item);
}

// Patch de forma de pagamento ou canal: item de sistema não muda (422), como na API real.
function patchCatalogItem(list, id, input, allowed) {
  const item = list.find((x) => x.id === id);
  if (!item) return notFound;
  if (item.protected) {
    return { status: 422, body: { code: "validation", field: "name", reason: "system_read_only" } };
  }
  if (!bodyIsValid(input, allowed, [])) return invalidRequest;
  if (typeof input.name === "string" && isNameTaken(list, input.name.trim(), id)) return nameTaken;
  for (const key of Object.keys(input)) item[key] = key === "name" ? input.name.trim() : input[key];
  if (item.isDefaultCard === true) clearOtherDefaults(list, id);
  return ok(item);
}

function createUnit(s, input) {
  if (!bodyIsValid(input, UNIT_KEYS, ["name"])) return invalidRequest;
  const name = input.name.trim();
  if (isNameTaken(s.units, name)) return nameTaken;
  const item = { ...unitRow(nextId(s), name), ...input, name };
  s.units.push(item);
  s.createdUnitIds.add(item.id);
  return created(item);
}

function patchUnit(s, id, input) {
  const item = s.units.find((u) => u.id === id);
  if (!item) return notFound;
  if (!bodyIsValid(input, UNIT_KEYS, [])) return invalidRequest;
  if (typeof input.name === "string" && isNameTaken(s.units, input.name.trim(), id))
    return nameTaken;
  for (const key of Object.keys(input)) item[key] = key === "name" ? input.name.trim() : input[key];
  return ok(item);
}

// Inativar a última unidade ativa é recusado (409); reativar é sempre permitido.
function setUnitStatus(s, id, status) {
  const item = s.units.find((u) => u.id === id);
  if (!item) return notFound;
  const activeCount = s.units.filter((u) => u.status === "active").length;
  if (status === "inactive" && item.status === "active" && activeCount <= 1) {
    return { status: 409, body: { code: "last_active_unit" } };
  }
  item.status = status;
  return ok(item);
}

// Prévia sobre R$ 100,00: com bp inteiro, bp × 10000 ÷ 10000 = bp, sem arredondamento.
function feePreview(searchParams) {
  const bp = searchParams.get("feePercentBp") ?? "";
  const fixed = searchParams.get("feeFixedCents") || "0";
  if (!/^\d+$/.test(bp) || Number(bp) > MAX_FEE_BP) {
    return {
      status: 422,
      body: { code: "validation", field: "fee_percent_bp", reason: "invalid" },
    };
  }
  if (!/^\d+$/.test(fixed)) {
    return {
      status: 422,
      body: { code: "validation", field: "fee_fixed_cents", reason: "invalid" },
    };
  }
  const feeCents = Number(bp) + Number(fixed);
  return ok({ grossCents: GROSS_CENTS, feeCents, netCents: GROSS_CENTS - feeCents });
}

function findTarget(s, kind, id) {
  const list =
    kind === "payment_method" ? s.paymentMethods : kind === "sales_channel" ? s.salesChannels : [];
  return list.find((x) => x.id === id) ?? null;
}

function reapplyPreview(s, input) {
  const target = findTarget(s, input.targetKind, input.targetId);
  if (!target) return notFound;
  return ok({
    matched: REAPPLY_MATCHED,
    deltaNetCents: REAPPLY_DELTA_NET_CENTS,
    feePercentBp: target.feePercentBp,
    feeFixedCents: target.feeFixedCents ?? 0,
  });
}

// Mesmo clientRequestId devolve a mesma linha; outra reaplicação em andamento no mesmo alvo dá 409.
function createReapply(s, input) {
  if (typeof input.clientRequestId !== "string") return invalidRequest;
  if (!findTarget(s, input.targetKind, input.targetId)) return notFound;
  const same = s.reapplications.find((e) => e.clientRequestId === input.clientRequestId);
  if (same) return ok({ ...same.row });
  const busy = s.reapplications.find(
    (e) =>
      e.targetKind === input.targetKind &&
      e.targetId === input.targetId &&
      (e.row.status === "queued" || e.row.status === "running"),
  );
  if (busy) {
    return { status: 409, body: { code: "reapply_in_progress", item: { ...busy.row } } };
  }
  const row = {
    id: nextId(s),
    targetKind: input.targetKind,
    targetId: input.targetId,
    from: input.from ?? null,
    to: input.to ?? null,
    status: "queued",
    errorCode: null,
    matched: REAPPLY_MATCHED,
    updated: 0,
    skipped: 0,
    createdAt: FIXED_TIME,
    finishedAt: null,
  };
  s.reapplications.push({
    clientRequestId: input.clientRequestId,
    targetKind: input.targetKind,
    targetId: input.targetId,
    row,
  });
  return { status: 202, body: { ...row } };
}

// Snapshot da última reaplicação do alvo, depois um passo: queued → running → done.
function reapplyStatus(s, searchParams) {
  const kind = searchParams.get("targetKind");
  const id = searchParams.get("targetId");
  const last = s.reapplications.filter((e) => e.targetKind === kind && e.targetId === id).at(-1);
  if (!last) return ok({ item: null });
  const snapshot = { ...last.row };
  if (last.row.status === "queued") {
    last.row.status = "running";
  } else if (last.row.status === "running") {
    last.row.status = "done";
    last.row.updated = REAPPLY_UPDATED;
    last.row.finishedAt = FINISHED_TIME;
  }
  return ok({ item: snapshot });
}

function answerRestricted(method, pathname) {
  if (method === "GET" && pathname === "/api/restricted/units") return ok({ units: [] });
  return notFound;
}

// Roteia /api/settings* e /api/restricted* (GET, POST, PATCH). Sessão e contexto ficam em fake-api.mjs.
export function answerSettings(method, url, body, company) {
  const { pathname, searchParams } = new URL(url, "http://localhost");
  const input = body && typeof body === "object" ? body : {};

  if (pathname.startsWith("/api/restricted")) return answerRestricted(method, pathname);

  if (method === "GET" && pathname === "/api/settings/fee-preview") {
    return gateFor(company, false) ?? feePreview(searchParams);
  }

  if (method === "POST" && pathname === "/api/settings/fee-reapplications/preview") {
    return gateFor(company, false) ?? reapplyPreview(stateOf(company), input);
  }

  if (pathname === "/api/settings/fee-reapplications") {
    if (method === "GET")
      return gateFor(company, false) ?? reapplyStatus(stateOf(company), searchParams);
    if (method === "POST") return gateFor(company, true) ?? createReapply(stateOf(company), input);
    return notFound;
  }

  const match =
    /^\/api\/settings\/(payment-methods|sales-channels|units)(?:\/([^/]+)(?:\/(deactivate|reactivate))?)?$/.exec(
      pathname,
    );
  if (!match) return notFound;
  const [, kind, id, action] = match;
  const write = method !== "GET";

  if (method === "GET" && id) return notFound;
  if (method === "POST" && !id && action) return notFound;
  if (method === "POST" && id && (!action || kind !== "units")) return notFound;
  if (method === "PATCH" && (!id || action)) return notFound;
  if (!["GET", "POST", "PATCH"].includes(method)) return notFound;

  const denied = gateFor(company, write);
  if (denied) return denied;

  const s = stateOf(company);
  if (method === "GET") {
    const list =
      kind === "payment-methods"
        ? s.paymentMethods
        : kind === "sales-channels"
          ? s.salesChannels
          : s.units;
    return listItems(list, searchParams);
  }
  if (method === "POST" && action) {
    return setUnitStatus(s, id, action === "deactivate" ? "inactive" : "active");
  }
  if (method === "POST") {
    if (kind === "payment-methods") return createPaymentMethod(s, input);
    if (kind === "sales-channels") return createSalesChannel(s, input);
    return createUnit(s, input);
  }
  // PATCH
  if (kind === "payment-methods")
    return patchCatalogItem(s.paymentMethods, id, input, PAYMENT_KEYS);
  if (kind === "sales-channels") return patchCatalogItem(s.salesChannels, id, input, CHANNEL_KEYS);
  return patchUnit(s, id, input);
}
