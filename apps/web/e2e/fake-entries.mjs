// Lançamentos fixos da API falsa (A12): 60 lançamentos da empresa T1 (Bistrô Demo), nas unidades
// Matriz e Filial, e as respostas das rotas de leitura /api/entries*. Espelha o contrato de
// packages/core/src/contracts/entries.ts à mão (este arquivo não importa o TypeScript).
// Sem Math.random e sem Date.now: datas e ids vêm do índice do laço.

const TENANT_T1 = "0190a000-0000-7000-8000-000000000001";
// Mesmos ids das unidades de fake-api.mjs (U1 e U2 da empresa T1).
const MATRIZ = { id: "0190a000-0000-7000-8000-0000000000a1", name: "Matriz" };
const FILIAL = { id: "0190a000-0000-7000-8000-0000000000a2", name: "Filial" };

// Ids fixos por grupo: `<grupo>-0000-7000-8000-<12 dígitos>` (UUID v7 válido para z.uuid()).
const fixedId = (group, n) => `${group}-0000-7000-8000-${String(n).padStart(12, "0")}`;
const ref = (r) => ({ id: r.id, name: r.name });

// Autores (membros da empresa). `-staff` é o Lançador: vê só os lançamentos dele.
const MEMBER = {
  dono: { id: fixedId("0190a600", 1), name: "Dono Demo" },
  gerente: { id: fixedId("0190a600", 2), name: "Gerente Demo" },
  lancador: { id: fixedId("0190a600", 3), name: "Lançador Demo" },
  contador: { id: fixedId("0190a600", 4), name: "Contador Demo" },
};

const CATEGORY = {
  vendas: {
    id: fixedId("0190a200", 1),
    name: "Vendas",
    kind: "revenue",
    parentId: null,
    requiresQuantity: false,
  },
  insumos: {
    id: fixedId("0190a200", 2),
    name: "Insumos",
    kind: "expense",
    parentId: null,
    requiresQuantity: false,
  },
  // Categoria sensível (RF22.Obs7, RF25): só dono e contador veem.
  salarios: {
    id: fixedId("0190a200", 3),
    name: "Salários",
    kind: "expense",
    parentId: null,
    requiresQuantity: false,
  },
  aluguel: {
    id: fixedId("0190a200", 4),
    name: "Aluguel",
    kind: "expense",
    parentId: null,
    requiresQuantity: false,
  },
  energia: {
    id: fixedId("0190a200", 5),
    name: "Energia",
    kind: "expense",
    parentId: null,
    requiresQuantity: false,
  },
  bebidas: {
    id: fixedId("0190a200", 6),
    name: "Bebidas",
    kind: "expense",
    parentId: null,
    requiresQuantity: true,
  },
  equipamentos: {
    id: fixedId("0190a200", 7),
    name: "Equipamentos",
    kind: "investment",
    parentId: null,
    requiresQuantity: false,
  },
};

const SUPPLIERS = [
  { id: fixedId("0190a300", 1), name: "Fornecedor Alfa" },
  { id: fixedId("0190a300", 2), name: "Fornecedor Beta" },
  { id: fixedId("0190a300", 3), name: "Fornecedor Gama" },
];
const PAYMENTS = [
  { id: fixedId("0190a400", 1), name: "Pix" },
  { id: fixedId("0190a400", 2), name: "Cartão de crédito" },
  { id: fixedId("0190a400", 3), name: "Dinheiro" },
];
const SALES = [
  { id: fixedId("0190a500", 1), name: "Salão" },
  { id: fixedId("0190a500", 2), name: "Delivery" },
];

const CREATORS = [MEMBER.dono, MEMBER.gerente, MEMBER.lancador, MEMBER.contador];
const EXPENSE_CATEGORIES = [CATEGORY.insumos, CATEGORY.aluguel, CATEGORY.energia, CATEGORY.bebidas];
// Índices dos lançamentos especiais (todos dentro dos 60).
const SENSITIVE_INDEXES = new Set([8, 47]);
const AUDIO_INDEX = 4;
const IMAGE_INDEX = 11;
const SCRIPT_INDEX = 17;
// Mensagem que também gerou um lançamento sensível: a origem some para quem não vê o sensível.
const SHARED_MESSAGE_INDEX = 21;
const NO_CATEGORY_INDEX = 36;
const AMOUNT_450_INDEX = 2;
const FLAGGED = {
  5: ["category_to_review"],
  13: ["channel_to_review"],
  30: ["possible_duplicate", "old_date"],
};
const WHATSAPP_INDEXES = new Set([AUDIO_INDEX, IMAGE_INDEX, SCRIPT_INDEX, SHARED_MESSAGE_INDEX]);
// Chave de acesso fictícia de 44 dígitos.
const ACCESS_KEY = "35261111222233334444555566667777888899990001";
const SCRIPT_TEXT = "<script>alert(1)</script>";

function isoDay(offset) {
  return new Date(Date.UTC(2026, 9, 1 + offset)).toISOString().slice(0, 10);
}

function buildEntry(i) {
  const type = i % 5 === 0 ? "revenue" : "expense";
  let category;
  if (type === "revenue") category = CATEGORY.vendas;
  else if (SENSITIVE_INDEXES.has(i)) category = CATEGORY.salarios;
  else if (i === NO_CATEGORY_INDEX) category = null;
  else category = EXPENSE_CATEGORIES[i % 4];
  const payment = PAYMENTS[i % 3];
  const feePercentBp = type === "revenue" && payment.id === PAYMENTS[1].id ? 250 : 0;
  // O lançamento 3 vale R$ 450,00 exatos, para a busca por valor (RF22.CA05).
  const amountCents = i === AMOUNT_450_INDEX ? 45000 : 1000 + ((i * 7919) % 90000);
  const feeCents = Math.round((amountCents * feePercentBp) / 10000);
  const offset = (i * 11) % 60;
  const createdAt = new Date(Date.UTC(2026, 9, 1, 9) + i * 3600000).toISOString();
  const version = i % 7 === 0 ? 2 : 1;
  const isDrink = category?.id === CATEGORY.bebidas.id;
  let originChannel = "import";
  if (WHATSAPP_INDEXES.has(i) || i % 3 === 1) originChannel = "whatsapp";
  else if (i % 3 === 0) originChannel = "web";
  return {
    id: fixedId("0190a700", i + 1),
    index: i,
    version,
    type,
    occurredOn: isoDay(offset),
    paidOn: isoDay(offset + (i % 4)),
    description: `${category ? category.name : "Sem categoria"} #${i + 1}`,
    quantity: isDrink ? (i % 9) + 1 : null,
    quantityUnit: isDrink ? "L" : null,
    orders: type === "revenue" ? 10 + (i % 20) : null,
    amountCents,
    feePercentBp,
    feeFixedCents: 0,
    feeCents,
    netCents: amountCents - feeCents,
    category,
    supplier: type === "expense" && i % 3 !== 0 ? SUPPLIERS[(i % 3) - 1] : null,
    paymentMethod: payment,
    salesChannel: type === "revenue" ? SALES[i % 2] : null,
    unit: i % 2 === 0 ? MATRIZ : FILIAL,
    createdBy: CREATORS[i % 4],
    originChannel,
    flags: FLAGGED[i] ?? [],
    createdAt,
    updatedAt:
      version === 2 ? new Date(Date.parse(createdAt) + 86_400_000).toISOString() : createdAt,
  };
}

const ENTRIES = Array.from({ length: 60 }, (_, i) => buildEntry(i));

const ENTRY_TYPES = ["expense", "revenue"];
const ORIGINS = ["whatsapp", "web", "import", "email", "system"];
const FLAGS = ["category_to_review", "channel_to_review", "possible_duplicate", "old_date"];
const SORTS = ["created_at", "occurred_on", "paid_on", "amount"];
const DIRS = ["desc", "asc"];
const SORT_KEY = {
  created_at: (e) => e.createdAt,
  occurred_on: (e) => e.occurredOn,
  paid_on: (e) => e.paidOn,
  amount: (e) => e.amountCents,
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BAD_QUERY = { status: 400, body: { code: "invalid_request" } };
const FORBIDDEN = { status: 403, body: { code: "forbidden" } };
const NOT_FOUND = { status: 404, body: { code: "not_found" } };
const ok = (body) => ({ status: 200, body });

function isDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

// Filtros da query string (parâmetro repetido vira lista). Qualquer valor fora do contrato é 400.
function parseQuery(url) {
  const params = new URL(url, "http://localhost").searchParams;
  const one = (key) => params.get(key) ?? undefined;
  const many = (key) => params.getAll(key);
  const from = one("from");
  const to = one("to");
  if (!isDate(from) || !isDate(to) || from > to) return null;
  const rawLimit = one("limit");
  if (rawLimit !== undefined && !/^\d+$/.test(rawLimit)) return null;
  const limit = rawLimit === undefined ? 50 : Number(rawLimit);
  if (limit < 1 || limit > 100) return null;
  const cursor = one("cursor");
  if (cursor !== undefined && !/^\d+$/.test(cursor)) return null;
  const q = one("q")?.trim();
  if (q !== undefined && (q === "" || [...q].length > 100)) return null;
  const f = {
    from,
    to,
    type: one("type"),
    unitIds: many("unitIds"),
    categoryIds: many("categoryIds"),
    supplierId: one("supplierId"),
    paymentMethodId: one("paymentMethodId"),
    salesChannelId: one("salesChannelId"),
    createdBy: one("createdBy"),
    originChannel: one("originChannel"),
    flags: many("flags"),
    q,
    sort: one("sort") ?? "created_at",
    dir: one("dir") ?? "desc",
    cursor,
    limit,
  };
  const ids = [...f.unitIds, ...f.categoryIds];
  const singleIds = [f.supplierId, f.paymentMethodId, f.salesChannelId, f.createdBy];
  const valid =
    (f.type === undefined || ENTRY_TYPES.includes(f.type)) &&
    ids.every((id) => UUID.test(id)) &&
    singleIds.every((id) => id === undefined || UUID.test(id)) &&
    (f.originChannel === undefined || ORIGINS.includes(f.originChannel)) &&
    f.flags.every((flag) => FLAGS.includes(flag)) &&
    SORTS.includes(f.sort) &&
    DIRS.includes(f.dir);
  return valid ? f : null;
}

// Unidades que a consulta pode ver: filtro explícito (fora do acesso é 403), senão a unidade do
// contexto (`all` = todas as de acesso).
function scopeUnits(company, unitId, f) {
  if (f.unitIds.length) {
    return f.unitIds.every((id) => company.unitIds.includes(id)) ? f.unitIds : null;
  }
  return unitId === "all" ? company.unitIds : [unitId];
}

// Só a empresa T1 tem lançamentos; as outras respondem vazio.
function tenantEntries(company) {
  return company.tenantId === TENANT_T1 ? ENTRIES : [];
}

// Dono e contador veem a categoria sensível; gerente e lançador não.
function canSeeSensitive(company) {
  return company.role === "owner" || company.role === "accountant";
}

function isSensitive(e) {
  return e.category?.id === CATEGORY.salarios.id;
}

// Visibilidade por papel (sem contar unidade): o lançador só vê os próprios.
function visible(e, company) {
  if (isSensitive(e) && !canSeeSensitive(company)) return false;
  if (company.role === "staff") return e.createdBy.id === MEMBER.lancador.id;
  return true;
}

// Ver o lançamento não basta: a unidade também tem de ser de acesso da empresa.
function findVisible(id, company) {
  const e = tenantEntries(company).find((x) => x.id === id.toLowerCase());
  return e && visible(e, company) && company.unitIds.includes(e.unit.id) ? e : null;
}

// Filtros sem a visibilidade (o total de "restritos" conta o que casa com o filtro).
function matches(e, f, units) {
  if (e.occurredOn < f.from || e.occurredOn > f.to) return false;
  if (!units.includes(e.unit.id)) return false;
  if (f.type && e.type !== f.type) return false;
  if (f.categoryIds.length && !(e.category && f.categoryIds.includes(e.category.id))) return false;
  if (f.supplierId && e.supplier?.id !== f.supplierId) return false;
  if (f.paymentMethodId && e.paymentMethod.id !== f.paymentMethodId) return false;
  if (f.salesChannelId && e.salesChannel?.id !== f.salesChannelId) return false;
  if (f.createdBy && !f.ignoreCreatedBy && e.createdBy.id !== f.createdBy) return false;
  if (f.originChannel && e.originChannel !== f.originChannel) return false;
  if (f.flags.length && !f.flags.some((flag) => e.flags.includes(flag))) return false;
  if (f.q && !matchesSearch(e, f.q)) return false;
  return true;
}

// "450" ou "450,00" viram centavos (só o formato simples; a regra de verdade é parseBRLInput).
function searchCents(q) {
  const match = /^(\d+)(?:,(\d{1,2}))?$/.exec(q);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

// Busca livre (RF22.R5): valor exato, descrição ou fornecedor.
function matchesSearch(e, q) {
  const text = q.toLowerCase();
  if (searchCents(q) === e.amountCents) return true;
  if (e.description.toLowerCase().includes(text)) return true;
  return e.supplier?.name.toLowerCase().includes(text) ?? false;
}

// Ordenação com desempate pelo id, na mesma direção.
function compare(a, b, sort, dir) {
  const ka = SORT_KEY[sort](a);
  const kb = SORT_KEY[sort](b);
  let r = ka < kb ? -1 : ka > kb ? 1 : 0;
  if (r === 0) r = a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  return dir === "asc" ? r : -r;
}

// Permissões de conforto (a API real repete a checagem em cada mutação). Contador: tudo falso.
// Conta só leitura (`read_only`): tudo falso. `canRestore` é sempre falso nesta etapa.
function permissions(company) {
  const writable = company.accountStatus === "active" && company.role !== "accountant";
  return { canEdit: writable, canDelete: writable, canRestore: false };
}

function itemOf(e, company) {
  return {
    id: e.id,
    version: e.version,
    type: e.type,
    occurredOn: e.occurredOn,
    paidOn: e.paidOn,
    description: e.description,
    quantity: e.quantity,
    quantityUnit: e.quantityUnit,
    orders: e.orders,
    amountCents: e.amountCents,
    feeCents: e.feeCents,
    netCents: e.netCents,
    category: e.category ? ref(e.category) : null,
    supplier: e.supplier ? ref(e.supplier) : null,
    paymentMethod: ref(e.paymentMethod),
    salesChannel: e.salesChannel ? ref(e.salesChannel) : null,
    unit: ref(e.unit),
    createdBy: ref(e.createdBy),
    originChannel: e.originChannel,
    flags: [...e.flags],
    createdAt: e.createdAt,
    ...permissions(company),
  };
}

function versionsOf(e) {
  const created = {
    version: 1,
    action: "create",
    channel: e.originChannel,
    changedBy: ref(e.createdBy),
    changedAt: e.createdAt,
    restricted: false,
    changes: [],
  };
  if (e.version === 1) return [created];
  return [
    created,
    {
      version: 2,
      action: "update",
      channel: "web",
      changedBy: ref(MEMBER.dono),
      changedAt: e.updatedAt,
      restricted: false,
      changes: [{ field: "amountCents", before: e.amountCents - 100, after: e.amountCents }],
    },
  ];
}

function detailOf(e, company) {
  return {
    ...itemOf(e, company),
    feePercentBp: e.feePercentBp,
    feeFixedCents: e.feeFixedCents,
    updatedAt: e.updatedAt,
    deleted: null,
    versions: versionsOf(e),
  };
}

// Origem da mensagem. Só o lançamento de mensagem de WhatsApp tem texto ou mídia; a
// mensagem compartilhada vira `restricted` para quem não vê o sensível (RF25.Obs1).
function sourceOf(e, company) {
  const channel = e.originChannel;
  if (channel !== "whatsapp") {
    return {
      channel,
      kind: "none",
      text: null,
      transcription: null,
      accessKey: null,
      sentBy: null,
      sentAt: null,
      restricted: false,
      mediaAvailable: false,
    };
  }
  const sent = { sentBy: ref(e.createdBy), sentAt: e.createdAt };
  const base = { channel, ...sent, mediaAvailable: false };
  if (e.index === SHARED_MESSAGE_INDEX && !canSeeSensitive(company)) {
    return {
      ...base,
      kind: "text",
      text: null,
      transcription: null,
      accessKey: null,
      restricted: true,
    };
  }
  const plain = { ...base, restricted: false };
  if (e.index === AUDIO_INDEX) {
    return {
      ...plain,
      kind: "audio",
      text: null,
      transcription: "Recebi mil e duzentos reais de insumos",
      accessKey: null,
    };
  }
  if (e.index === IMAGE_INDEX) {
    return { ...plain, kind: "image", text: null, transcription: null, accessKey: ACCESS_KEY };
  }
  if (e.index === SCRIPT_INDEX) {
    return { ...plain, kind: "text", text: SCRIPT_TEXT, transcription: null, accessKey: null };
  }
  return {
    ...plain,
    kind: "text",
    text: `Lançamento ${e.index + 1} pelo WhatsApp`,
    transcription: null,
    accessKey: null,
  };
}

function list(url, company, unitId) {
  const f = parseQuery(url);
  if (!f) return BAD_QUERY;
  // O filtro "lançado por" enviado por um lançador é ignorado (RF22.R3, CA03).
  f.ignoreCreatedBy = company.role === "staff";
  const units = scopeUnits(company, unitId, f);
  if (!units) return FORBIDDEN;
  const found = tenantEntries(company)
    .filter((e) => visible(e, company) && matches(e, f, units))
    .sort((a, b) => compare(a, b, f.sort, f.dir));
  const offset = f.cursor === undefined ? 0 : Number(f.cursor);
  const items = found.slice(offset, offset + f.limit).map((e) => itemOf(e, company));
  const next = offset + f.limit;
  return ok({ items, nextCursor: next < found.length ? String(next) : null });
}

function totals(url, company, unitId) {
  const f = parseQuery(url);
  if (!f) return BAD_QUERY;
  f.ignoreCreatedBy = company.role === "staff";
  const units = scopeUnits(company, unitId, f);
  if (!units) return FORBIDDEN;
  const all = tenantEntries(company).filter((e) => matches(e, f, units));
  const shown = all.filter((e) => visible(e, company));
  const sumOf = (type) =>
    shown.filter((e) => e.type === type).reduce((sum, e) => sum + e.amountCents, 0);
  const revenueCents = sumOf("revenue");
  const expenseCents = sumOf("expense");
  return ok({
    revenueCents,
    expenseCents,
    resultCents: revenueCents - expenseCents,
    count: shown.length,
    // Para o lançador é sempre falso: ele só vê os próprios (desenho, 1.6).
    hasRestricted:
      company.role !== "staff" && !canSeeSensitive(company) && all.some((e) => isSensitive(e)),
  });
}

function options(company) {
  if (company.tenantId !== TENANT_T1) {
    return ok({
      categories: [],
      suppliers: [],
      paymentMethods: [],
      salesChannels: [],
      units: [],
      members: [],
    });
  }
  return ok({
    categories: Object.values(CATEGORY)
      .filter((c) => canSeeSensitive(company) || c.id !== CATEGORY.salarios.id)
      .map(({ id, name, kind, parentId, requiresQuantity }) => ({
        id,
        name,
        kind,
        parentId,
        requiresQuantity,
      })),
    suppliers: SUPPLIERS.map(ref),
    paymentMethods: PAYMENTS.map(ref),
    salesChannels: SALES.map(ref),
    units: company.units.map(ref),
    members: company.role === "staff" ? [] : Object.values(MEMBER).map(ref),
  });
}

// Roteia /api/entries*. Os guards de sessão e de contexto ficam em fake-api.mjs, como em /api/units.
export function answerEntries(url, company, unitId) {
  const path = new URL(url, "http://localhost").pathname;
  if (path === "/api/entries") return list(url, company, unitId);
  if (path === "/api/entries/totals") return totals(url, company, unitId);
  if (path === "/api/entries/options") return options(company);
  const source = /^\/api\/entries\/([^/]+)\/source$/.exec(path);
  if (source) {
    const e = findVisible(source[1], company);
    return e ? ok(sourceOf(e, company)) : NOT_FOUND;
  }
  const detail = /^\/api\/entries\/([^/]+)$/.exec(path);
  if (detail) {
    const e = findVisible(detail[1], company);
    return e ? ok(detailOf(e, company)) : NOT_FOUND;
  }
  return { status: 404, body: { error: "not_found" } };
}
