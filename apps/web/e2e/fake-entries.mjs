// Lançamentos da API falsa (A12, B8): 60 lançamentos da empresa T1 (Bistrô Demo), nas unidades
// Matriz e Filial, as rotas de leitura e de escrita de /api/entries* e /api/trash, e o reset de
// teste. Espelha o contrato de packages/core/src/contracts/entries.ts à mão (este arquivo não
// importa o TypeScript). O estado (lançamentos e fornecedores criados) fica em memória e volta ao
// inicial com resetEntries(). Sem Math.random e sem Date.now: datas e ids vêm de constantes fixas,
// do índice do laço ou de contador do estado.

const TENANT_T1 = "0190a000-0000-7000-8000-000000000001";
// Mesmos ids das unidades de fake-api.mjs (U1 e U2 da empresa T1).
const MATRIZ = { id: "0190a000-0000-7000-8000-0000000000a1", name: "Matriz" };
const FILIAL = { id: "0190a000-0000-7000-8000-0000000000a2", name: "Filial" };

// Instante das escritas e prazo da restauração (hoje + 30 dias). Data fixa, como o resto do arquivo.
const NOW = "2026-11-16T12:00:00.000Z";
const RESTORABLE_UNTIL = "2026-12-16";

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
// Ator de cada papel: quem aparece como autor das escritas feitas por essa persona.
const ACTOR_BY_ROLE = {
  owner: MEMBER.dono,
  manager: MEMBER.gerente,
  staff: MEMBER.lancador,
  accountant: MEMBER.contador,
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
    name: "Mercearia",
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
  const entry = {
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
    // Excluído: null, ou { at, by, reason, restorableUntil } (RF24).
    deleted: null,
  };
  // Histórico (RF25): uma entrada por versão, a da criação primeiro.
  entry.history = versionsOf(entry);
  return entry;
}

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
const INVALID = { status: 400, body: { code: "invalid_request" } };
const FORBIDDEN = { status: 403, body: { code: "forbidden" } };
const ACCOUNT_READ_ONLY = { status: 403, body: { code: "account_read_only" } };
const NOT_FOUND = { status: 404, body: { code: "not_found" } };
const UNKNOWN_REFERENCE = {
  status: 422,
  body: { code: "invalid_entry", reason: "UnknownReference" },
};
const NOT_DELETED = { status: 422, body: { code: "invalid_entry", reason: "EntryNotDeleted" } };
const ok = (body) => ({ status: 200, body });

// Estado em memória: lançamentos, fornecedores (os fixos mais os criados na edição) e o contador
// que dá o próximo id de fornecedor criado. `resetEntries()` volta tudo ao inicial.
// `nextEntry` é o contador de ids dos lançamentos criados (os 60 dos dados fixos usam 1 a 60).
// `requests` guarda chave de tentativa (`<ator>|<clientRequestId>`) → id do lançamento criado.
function freshState() {
  return {
    entries: Array.from({ length: 60 }, (_, i) => buildEntry(i)),
    suppliers: SUPPLIERS.map((s) => ({ ...s })),
    nextSupplier: 1,
    nextEntry: 61,
    requests: new Map(),
  };
}
let state = freshState();

export function resetEntries() {
  state = freshState();
}

function isDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

// Limite e cursor da query string (mesmas regras da lista).
function pageParams(params) {
  const rawLimit = params.get("limit") ?? undefined;
  if (rawLimit !== undefined && !/^\d+$/.test(rawLimit)) return null;
  const limit = rawLimit === undefined ? 50 : Number(rawLimit);
  if (limit < 1 || limit > 100) return null;
  const cursor = params.get("cursor") ?? undefined;
  if (cursor !== undefined && !/^\d+$/.test(cursor)) return null;
  return { cursor, limit };
}

// Filtros da query string (parâmetro repetido vira lista). Qualquer valor fora do contrato é 400.
function parseQuery(url) {
  const params = new URL(url, "http://localhost").searchParams;
  const one = (key) => params.get(key) ?? undefined;
  const many = (key) => params.getAll(key);
  const from = one("from");
  const to = one("to");
  if (!isDate(from) || !isDate(to) || from > to) return null;
  const page = pageParams(params);
  if (!page) return null;
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
    cursor: page.cursor,
    limit: page.limit,
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

// Query da lixeira (RF24): período sobre a data da exclusão, unidades e autor da exclusão.
function parseTrashQuery(url) {
  const params = new URL(url, "http://localhost").searchParams;
  const deletedFrom = params.get("deletedFrom");
  const deletedTo = params.get("deletedTo");
  if (!isDate(deletedFrom) || !isDate(deletedTo) || deletedFrom > deletedTo) return null;
  const page = pageParams(params);
  if (!page) return null;
  const unitIds = params.getAll("unitIds");
  const deletedBy = params.get("deletedBy") ?? undefined;
  if (!unitIds.every((id) => UUID.test(id))) return null;
  if (deletedBy !== undefined && !UUID.test(deletedBy)) return null;
  return { deletedFrom, deletedTo, unitIds, deletedBy };
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
  return company.tenantId === TENANT_T1 ? state.entries : [];
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

// Ver o lançamento não basta: a unidade também tem de ser de acesso da empresa. Vale para
// excluído também (o detalhe e a restauração precisam dele).
function findVisible(id, company) {
  const e = tenantEntries(company).find((x) => x.id === id.toLowerCase());
  return e && visible(e, company) && company.unitIds.includes(e.unit.id) ? e : null;
}

// Lançamento que pode ser editado ou excluído: visível e não excluído.
function findActive(id, company) {
  const e = findVisible(id, company);
  return e && e.deleted === null ? e : null;
}

// Filtros sem a visibilidade (o total de "restritos" conta o que casa com o filtro).
function matches(e, f, units) {
  if (e.occurredOn < f.from || e.occurredOn > f.to) return false;
  if (!units.includes(e.unit.id)) return false;
  if (f.type && e.type !== f.type) return false;
  if (f.categoryIds.length && !(e.category && f.categoryIds.includes(e.category.id))) return false;
  if (f.supplierId && e.supplier?.id !== f.supplierId) return false;
  if (f.paymentMethodId && e.paymentMethod?.id !== f.paymentMethodId) return false;
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
// Conta só leitura (`read_only`): tudo falso. Excluído: não edita nem exclui; restaura quem pode
// escrever (dono e gerente; o lançador só vê os próprios, pela visibilidade).
function permissions(company, e) {
  const writable = company.accountStatus === "active" && company.role !== "accountant";
  const live = e.deleted === null;
  return {
    canEdit: writable && live,
    canDelete: writable && live,
    canRestore: writable && !live,
  };
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
    paymentMethod: e.paymentMethod ? ref(e.paymentMethod) : null,
    salesChannel: e.salesChannel ? ref(e.salesChannel) : null,
    unit: ref(e.unit),
    createdBy: ref(e.createdBy),
    originChannel: e.originChannel,
    flags: [...e.flags],
    createdAt: e.createdAt,
    ...permissions(company, e),
  };
}

// Histórico inicial: a criação e, para a versão 2 dos dados fixos, uma edição de valor.
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

// O lançador não vê o nome de quem é da gestão: `deleted.by` (DD-39) e o autor das versões
// (DD-40) saem nulos quando não foi ele; a tela mostra "Gestão". Dono, gerente e contador veem.
const hiddenFor = (company, person) =>
  company.role === "staff" && person !== null && person.id !== MEMBER.lancador.id;

function deletedFor(e, company) {
  if (e.deleted === null || !hiddenFor(company, e.deleted.by)) return e.deleted;
  return { ...e.deleted, by: null };
}

function detailOf(e, company) {
  return {
    ...itemOf(e, company),
    feePercentBp: e.feePercentBp,
    feeFixedCents: e.feeFixedCents,
    updatedAt: e.updatedAt,
    deleted: deletedFor(e, company),
    versions: e.history.map((v) =>
      hiddenFor(company, v.changedBy) ? { ...v, changedBy: null } : v,
    ),
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
    .filter((e) => e.deleted === null && visible(e, company) && matches(e, f, units))
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
  const all = tenantEntries(company).filter((e) => e.deleted === null && matches(e, f, units));
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
        active: true,
      })),
    suppliers: state.suppliers.map(ref),
    paymentMethods: PAYMENTS.map((p) => ({ ...ref(p), active: true })),
    salesChannels: SALES.map((s) => ({ ...ref(s), active: true })),
    units: company.units.map((u) => ({
      ...ref(u),
      active: true,
      timezone: "America/Sao_Paulo",
      defaultSalesChannelId: SALES[0].id,
    })),
    members: company.role === "staff" ? [] : Object.values(MEMBER).map(ref),
  });
}

// ---------------------------------------------------------------------------------------
// Escrita (B8): PATCH, DELETE, restauração, lote e lixeira.
// ---------------------------------------------------------------------------------------

const PATCH_KEYS = [
  "type",
  "occurredOn",
  "paidOn",
  "description",
  "quantity",
  "quantityUnit",
  "orders",
  "amountCents",
  "categoryId",
  "supplier",
  "paymentMethodId",
  "salesChannelId",
  "unitId",
];

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isUuid = (v) => typeof v === "string" && UUID.test(v);
const isPositiveInt = (v) => Number.isSafeInteger(v) && v >= 1;
const isNullOr = (v, check) => v === null || check(v);
const textLength = (v) => [...v.trim()].length;
const isText = (v, max) => typeof v === "string" && textLength(v) >= 1 && textLength(v) <= max;
// Compara ids sem diferenciar maiúsculas (a API aceita o id em qualquer caixa).
const idIs = (a, b) => a.toLowerCase() === b.toLowerCase();

// Quem fez a escrita: o ator do papel da persona.
function actorOf(company) {
  return ACTOR_BY_ROLE[company.role];
}

// Recusas que valem antes de qualquer checagem do corpo ou do lançamento. Conta só leitura vem
// antes do contador, como na API real.
function writeProblem(company, batch) {
  if (company.accountStatus !== "active") return ACCOUNT_READ_ONLY;
  if (company.role === "accountant") return FORBIDDEN;
  if (batch && company.role === "staff") return FORBIDDEN;
  return null;
}

function validSupplier(s) {
  if (!isPlainObject(s)) return false;
  const keys = Object.keys(s);
  if (keys.length !== 1) return false;
  if (keys[0] === "id") return isUuid(s.id);
  if (keys[0] === "name") return isText(s.name, 120);
  return false;
}

function validPatchField(key, v) {
  switch (key) {
    case "type":
      return ENTRY_TYPES.includes(v);
    case "occurredOn":
    case "paidOn":
      return isDate(v);
    case "description":
      return isText(v, 200);
    case "quantity":
      return isNullOr(v, (x) => typeof x === "number" && x > 0);
    case "quantityUnit":
      return isNullOr(v, (x) => isText(x, 20));
    case "orders":
      return isNullOr(v, isPositiveInt);
    case "amountCents":
      return isPositiveInt(v);
    case "categoryId":
    case "unitId":
      return isUuid(v);
    case "paymentMethodId":
    case "salesChannelId":
      return isNullOr(v, isUuid);
    case "supplier":
      return isNullOr(v, validSupplier);
    default:
      return false;
  }
}

// Corpo do PATCH (contrato `entryUpdateBodySchema`): formato, chave conhecida e algo a mudar.
function validEdit(body) {
  if (!isPlainObject(body) || !isPositiveInt(body.expectedVersion)) return false;
  const patch = body.patch === undefined ? {} : body.patch;
  const markReviewed = body.markReviewed === undefined ? false : body.markReviewed;
  if (typeof markReviewed !== "boolean") return false;
  if (!isPlainObject(patch)) return false;
  const fieldsOk = Object.entries(patch).every(
    ([k, v]) => PATCH_KEYS.includes(k) && validPatchField(k, v),
  );
  return fieldsOk && (markReviewed || Object.keys(patch).length > 0);
}

// Motivo (RF24.R1): texto de até 200 caracteres, sem as pontas.
function validReason(reason) {
  return reason === undefined || (typeof reason === "string" && textLength(reason) <= 200);
}

function reasonOf(reason) {
  return reason === undefined ? null : reason.trim();
}

function validBatch(body) {
  if (!isPlainObject(body) || !validReason(body.reason)) return false;
  const ids = body.ids;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 100) return false;
  if (!ids.every(isUuid)) return false;
  return new Set(ids.map((id) => id.toLowerCase())).size === ids.length;
}

// Referências do corpo que precisam existir (categoria, unidade, forma, canal, fornecedor).
function referencesKnown(patch, company) {
  const absent = (v) => v === undefined || v === null;
  if (patch.categoryId !== undefined) {
    if (!Object.values(CATEGORY).some((c) => idIs(c.id, patch.categoryId))) return false;
  }
  if (patch.unitId !== undefined) {
    if (!company.unitIds.some((id) => idIs(id, patch.unitId))) return false;
  }
  if (!absent(patch.paymentMethodId)) {
    if (!PAYMENTS.some((p) => idIs(p.id, patch.paymentMethodId))) return false;
  }
  if (!absent(patch.salesChannelId)) {
    if (!SALES.some((s) => idIs(s.id, patch.salesChannelId))) return false;
  }
  if (patch.supplier && "id" in patch.supplier) {
    if (!state.suppliers.some((s) => idIs(s.id, patch.supplier.id))) return false;
  }
  return true;
}

// Acrescenta uma versão ao histórico (RF25.R4): número seguinte, canal da web e autor da escrita.
function addVersion(e, actor, action, changes) {
  e.version += 1;
  e.updatedAt = NOW;
  e.history.push({
    version: e.version,
    action,
    channel: "web",
    changedBy: ref(actor),
    changedAt: NOW,
    restricted: false,
    changes,
  });
}

// Anota a mudança só quando o valor de fato muda.
function note(changes, field, before, after) {
  if (before !== after) changes.push({ field, before, after });
}

// Aplica o patch já validado e devolve as mudanças (antes e depois). Em receita, taxa e líquido
// são recalculados com aritmética inteira; em despesa, a taxa é zero. O valor do fornecedor criado
// vem do contador do estado.
function applyPatch(e, patch, company) {
  const changes = [];
  for (const key of ["type", "occurredOn", "paidOn", "quantity", "orders", "amountCents"]) {
    if (patch[key] === undefined) continue;
    note(changes, key, e[key], patch[key]);
    e[key] = patch[key];
  }
  if (patch.description !== undefined) {
    const description = patch.description.trim();
    note(changes, "description", e.description, description);
    e.description = description;
  }
  if (patch.quantityUnit !== undefined) {
    const unit = patch.quantityUnit === null ? null : patch.quantityUnit.trim();
    note(changes, "quantityUnit", e.quantityUnit, unit);
    e.quantityUnit = unit;
  }
  if (patch.categoryId !== undefined) {
    const category = Object.values(CATEGORY).find((c) => idIs(c.id, patch.categoryId));
    note(changes, "category", e.category?.name ?? null, category.name);
    e.category = ref(category);
  }
  if (patch.supplier !== undefined) {
    const supplier = supplierFrom(patch.supplier);
    note(changes, "supplier", e.supplier?.name ?? null, supplier?.name ?? null);
    e.supplier = supplier ? ref(supplier) : null;
  }
  if (patch.paymentMethodId !== undefined) {
    const payment = PAYMENTS.find((p) => idIs(p.id, patch.paymentMethodId ?? ""));
    note(changes, "paymentMethod", e.paymentMethod?.name ?? null, payment?.name ?? null);
    e.paymentMethod = payment ? ref(payment) : null;
  }
  if (patch.salesChannelId !== undefined) {
    const sales = SALES.find((s) => idIs(s.id, patch.salesChannelId ?? ""));
    note(changes, "salesChannel", e.salesChannel?.name ?? null, sales?.name ?? null);
    e.salesChannel = sales ? ref(sales) : null;
  }
  if (patch.unitId !== undefined) {
    const unit = company.units.find((u) => idIs(u.id, patch.unitId));
    note(changes, "unit", e.unit.name, unit.name);
    e.unit = ref(unit);
  }
  if (patch.amountCents !== undefined || patch.type !== undefined) {
    const { feeCents, netCents } = settleFee(e);
    note(changes, "feeCents", e.feeCents, feeCents);
    note(changes, "netCents", e.netCents, netCents);
    e.feeCents = feeCents;
    e.netCents = netCents;
  }
  return changes;
}

// Exclusão lógica (RF24): marca, registra a versão e tira da lista e dos totais.
function markDeleted(e, actor, reason) {
  e.deleted = {
    at: NOW,
    by: ref(actor),
    reason,
    restorableUntil: RESTORABLE_UNTIL,
  };
  addVersion(e, actor, "delete", [{ field: "deleteReason", before: null, after: reason }]);
}

function editEntry(id, body, company) {
  const refused = writeProblem(company, false);
  if (refused) return refused;
  if (!validEdit(body)) return INVALID;
  const e = findActive(id, company);
  if (!e) return NOT_FOUND;
  if (body.expectedVersion !== e.version) {
    return { status: 409, body: { code: "entry_stale", current: detailOf(e, company) } };
  }
  const patch = body.patch === undefined ? {} : body.patch;
  if (!referencesKnown(patch, company)) return UNKNOWN_REFERENCE;
  const actor = actorOf(company);
  if (Object.keys(patch).length > 0) {
    const changes = applyPatch(e, patch, company);
    addVersion(e, actor, "update", changes);
  }
  // Revisão: limpa os sinais e registra outra versão (ordem: alteração, depois revisão).
  if (body.markReviewed === true) {
    const before = e.flags.join(",");
    e.flags = [];
    addVersion(e, actor, "update", before ? [{ field: "flags", before, after: "" }] : []);
  }
  return ok(detailOf(e, company));
}

function deleteEntry(id, body, company) {
  const refused = writeProblem(company, false);
  if (refused) return refused;
  if (!validReason(body.reason)) return INVALID;
  const e = findActive(id, company);
  if (!e) return NOT_FOUND;
  markDeleted(e, actorOf(company), reasonOf(body.reason));
  return ok(detailOf(e, company));
}

function restoreEntry(id, company) {
  const refused = writeProblem(company, false);
  if (refused) return refused;
  const e = findVisible(id, company);
  if (!e) return NOT_FOUND;
  if (e.deleted === null) return NOT_DELETED;
  e.deleted = null;
  addVersion(e, actorOf(company), "restore", []);
  return ok(detailOf(e, company));
}

// Prévia (`remove` falso) e exclusão em lote: tudo ou nada. Qualquer id inexistente ou excluído
// faz a resposta inteira ser 404 e nada muda.
function batch(body, company, remove) {
  const refused = writeProblem(company, true);
  if (refused) return refused;
  if (!validBatch(body)) return INVALID;
  const found = body.ids.map((id) => findActive(id, company));
  if (found.some((e) => e === null)) return NOT_FOUND;
  const preview = {
    count: found.length,
    totalCents: found.reduce((sum, e) => sum + e.amountCents, 0),
  };
  if (remove) {
    const actor = actorOf(company);
    const reason = reasonOf(body.reason);
    for (const e of found) markDeleted(e, actor, reason);
  }
  return ok(preview);
}

// Lixeira (RF24): só os excluídos, no período da exclusão. Contador não vê; o lançador só os seus.
function trash(url, company, unitId) {
  if (company.role === "accountant") return FORBIDDEN;
  const f = parseTrashQuery(url);
  if (!f) return BAD_QUERY;
  const units = scopeUnits(company, unitId, { unitIds: f.unitIds });
  if (!units) return FORBIDDEN;
  const found = tenantEntries(company)
    .filter((e) => {
      if (e.deleted === null || !units.includes(e.unit.id) || !visible(e, company)) return false;
      const day = e.deleted.at.slice(0, 10);
      if (day < f.deletedFrom || day > f.deletedTo) return false;
      return f.deletedBy === undefined || e.deleted.by.id === f.deletedBy;
    })
    .sort((a, b) => {
      if (a.deleted.at !== b.deleted.at) return a.deleted.at < b.deleted.at ? 1 : -1;
      return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
    });
  const items = found.map((e) => ({ ...itemOf(e, company), deleted: deletedFor(e, company) }));
  return ok({ items, nextCursor: null });
}

// Fornecedor do corpo (edição e criação): `{id}` acha um existente; `{name}` cria um novo, com o
// contador do estado; null ou ausente não tem fornecedor.
function supplierFrom(value) {
  if (!value) return null;
  if ("id" in value) return state.suppliers.find((s) => idIs(s.id, value.id)) ?? null;
  state.nextSupplier += 1;
  const supplier = { id: fixedId("0190a300", 100 + state.nextSupplier), name: value.name.trim() };
  state.suppliers.push(supplier);
  return supplier;
}

// Taxa e líquido (RF12): receita usa a taxa percentual e fixa do lançamento; despesa não tem taxa.
function settleFee(e) {
  const feeCents =
    e.type === "revenue"
      ? Math.floor((e.amountCents * e.feePercentBp) / 10000) + e.feeFixedCents
      : 0;
  return { feeCents, netCents: e.amountCents - feeCents };
}

// Corpo da criação (contrato `entryCreateBodySchema`): chaves conhecidas, formato e as regras do
// superRefine (receita pede canal; despesa não aceita canal nem pedidos; quantidade e unidade juntas).
const CREATE_KEYS = [
  "clientRequestId",
  "type",
  "occurredOn",
  "paidOn",
  "description",
  "amountCents",
  "categoryId",
  "unitId",
  "supplier",
  "paymentMethodId",
  "salesChannelId",
  "orders",
  "quantity",
  "quantityUnit",
];
// Mesma lista de packages/core/src/entry/quantity-units.ts.
const QUANTITY_UNIT_LIST = ["KG", "G", "L", "ML", "UN", "DZ", "CX", "PCT", "FD", "SC", "OUTRA"];
const optional = (v, check) => v === undefined || check(v);

function validCreate(body) {
  if (!isPlainObject(body) || !Object.keys(body).every((k) => CREATE_KEYS.includes(k)))
    return false;
  if (!isUuid(body.clientRequestId) || !ENTRY_TYPES.includes(body.type)) return false;
  if (!isDate(body.occurredOn) || !optional(body.paidOn, isDate)) return false;
  if (!isText(body.description, 200) || !isPositiveInt(body.amountCents)) return false;
  if (!isUuid(body.categoryId) || !isUuid(body.unitId)) return false;
  if (!optional(body.supplier, (v) => isNullOr(v, validSupplier))) return false;
  if (!optional(body.paymentMethodId, (v) => isNullOr(v, isUuid))) return false;
  if (!optional(body.salesChannelId, (v) => isNullOr(v, isUuid))) return false;
  if (!optional(body.orders, (v) => isNullOr(v, isPositiveInt))) return false;
  if (!optional(body.quantity, (v) => isNullOr(v, (x) => typeof x === "number" && x > 0))) {
    return false;
  }
  if (!optional(body.quantityUnit, (v) => isNullOr(v, (x) => QUANTITY_UNIT_LIST.includes(x)))) {
    return false;
  }
  const revenue = body.type === "revenue";
  if (revenue && body.salesChannelId == null) return false;
  if (!revenue && (body.salesChannelId != null || body.orders != null)) return false;
  return (body.quantity == null) === (body.quantityUnit == null);
}

// Aviso de possível duplicata (RF12): outro lançamento ativo que o ator vê, com o mesmo valor e
// fornecedor, ou com a mesma descrição (sem caixa) e a mesma data.
function isPossibleDuplicate(candidate, company) {
  const supplierId = candidate.supplier?.id ?? null;
  const description = candidate.description.toLowerCase();
  return tenantEntries(company).some(
    (e) =>
      e.deleted === null &&
      visible(e, company) &&
      ((e.amountCents === candidate.amountCents && (e.supplier?.id ?? null) === supplierId) ||
        (e.description.toLowerCase() === description && e.occurredOn === candidate.occurredOn)),
  );
}

// Aviso de data antiga (RF12): mais de 60 dias antes de "hoje", a data fixa da API falsa (NOW).
const OLD_DATE_DAYS = 60;
const TODAY = NOW.slice(0, 10);
function isOldDate(occurredOn) {
  return (Date.parse(TODAY) - Date.parse(occurredOn)) / 86_400_000 > OLD_DATE_DAYS;
}

// Criação pelo painel (RF26). A mesma chave de tentativa do mesmo ator devolve o lançamento já criado
// (200), sem criar outro; a primeira vez responde 201. A conta só leitura e o contador recebem 403.
function createEntry(body, company) {
  const refused = writeProblem(company, false);
  if (refused) return refused;
  if (!validCreate(body)) return INVALID;
  // Só a empresa T1 tem catálogo e lançamentos na API falsa.
  if (company.tenantId !== TENANT_T1) return UNKNOWN_REFERENCE;
  const actor = actorOf(company);
  const requestKey = `${actor.id}|${body.clientRequestId.toLowerCase()}`;
  const again = state.requests.get(requestKey);
  if (again) {
    return ok(
      detailOf(
        state.entries.find((e) => e.id === again),
        company,
      ),
    );
  }
  if (!referencesKnown(body, company)) return UNKNOWN_REFERENCE;

  const category = Object.values(CATEGORY).find((c) => idIs(c.id, body.categoryId));
  const unit = company.units.find((u) => idIs(u.id, body.unitId));
  const payment = PAYMENTS.find((p) => idIs(p.id, body.paymentMethodId ?? "")) ?? null;
  const sales = SALES.find((s) => idIs(s.id, body.salesChannelId ?? "")) ?? null;
  const supplier = supplierFrom(body.supplier ?? null);
  // Mesma regra dos dados fixos: receita no cartão de crédito tem taxa de 2,5%.
  const feePercentBp = body.type === "revenue" && payment?.id === PAYMENTS[1].id ? 250 : 0;
  const draft = {
    type: body.type,
    amountCents: body.amountCents,
    feePercentBp,
    feeFixedCents: 0,
    description: body.description.trim(),
    occurredOn: body.occurredOn,
    supplier: supplier ? ref(supplier) : null,
  };
  const { feeCents, netCents } = settleFee(draft);
  const flags = [];
  if (isPossibleDuplicate(draft, company)) flags.push("possible_duplicate");
  if (isOldDate(body.occurredOn)) flags.push("old_date");

  const entry = {
    id: fixedId("0190a700", state.nextEntry),
    version: 1,
    type: body.type,
    occurredOn: body.occurredOn,
    // Sem data de pagamento no corpo, vale a de ocorrência (o contrato exige a data).
    paidOn: body.paidOn ?? body.occurredOn,
    description: draft.description,
    quantity: body.quantity ?? null,
    quantityUnit: body.quantityUnit ?? null,
    orders: body.orders ?? null,
    amountCents: body.amountCents,
    feePercentBp,
    feeFixedCents: 0,
    feeCents,
    netCents,
    category: ref(category),
    supplier: draft.supplier,
    paymentMethod: payment ? ref(payment) : null,
    salesChannel: sales ? ref(sales) : null,
    unit: ref(unit),
    createdBy: ref(actor),
    originChannel: "web",
    flags,
    createdAt: NOW,
    updatedAt: NOW,
    deleted: null,
    // Versão 1 da criação, pelo canal da web e pelo autor da escrita (RF25.R4).
    history: [
      {
        version: 1,
        action: "create",
        channel: "web",
        changedBy: ref(actor),
        changedAt: NOW,
        restricted: false,
        changes: [],
      },
    ],
  };
  state.entries.push(entry);
  state.nextEntry += 1;
  state.requests.set(requestKey, entry.id);
  return { status: 201, body: detailOf(entry, company) };
}

// Roteia /api/entries* e /api/trash. Os guards de sessão e de contexto ficam em fake-api.mjs,
// como em /api/units. `body` é o JSON já lido (vazio nas leituras).
export function answerEntries(method, url, body, company, unitId) {
  const input = isPlainObject(body) ? body : {};
  const path = new URL(url, "http://localhost").pathname;
  if (method === "GET") {
    if (path === "/api/trash") return trash(url, company, unitId);
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
  }
  if (method === "POST" && path === "/api/entries") return createEntry(input, company);
  if (method === "POST" && path === "/api/entries/batch/preview") {
    return batch(input, company, false);
  }
  if (method === "POST" && path === "/api/entries/batch/delete") {
    return batch(input, company, true);
  }
  const restore = /^\/api\/entries\/([^/]+)\/restore$/.exec(path);
  if (method === "POST" && restore) return restoreEntry(restore[1], company);
  const item = /^\/api\/entries\/([^/]+)$/.exec(path);
  if (item && method === "PATCH") return editEntry(item[1], input, company);
  if (item && method === "DELETE") return deleteEntry(item[1], input, company);
  return { status: 404, body: { error: "not_found" } };
}
