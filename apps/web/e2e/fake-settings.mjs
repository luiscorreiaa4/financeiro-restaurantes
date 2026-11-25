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
const MEMBER_INPUT_KEYS = [
  "displayName",
  "phone",
  "email",
  "role",
  "allUnits",
  "unitIds",
  "defaultUnitId",
  "panelAccess",
  "permissions",
];
const MEMBER_PATCH_KEYS = [...MEMBER_INPUT_KEYS, "confirmPhoneChange"];
const MEMBER_ROLE_LIST = ["owner", "manager", "staff"];
const PERMISSION_LIST = [
  "VER_FOLHA",
  "EXPORTAR_DADOS",
  "RECEBER_RESUMO_SEMANAL",
  "CONSULTAR_RELATORIOS_WHATSAPP",
];
// Mesmo formato de e-mail do core (registry/member.ts): sem espaço e com domínio.
const EMAIL_FORMAT = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

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
  displayName: (v) => typeof v === "string" && v.trim().length >= 2 && v.length <= 120,
  phone: nonEmpty,
  email: (v) => v === null || (typeof v === "string" && v.length <= 254 && EMAIL_FORMAT.test(v)),
  role: (v) => MEMBER_ROLE_LIST.includes(v),
  allUnits: (v) => typeof v === "boolean",
  unitIds: (v) => Array.isArray(v) && v.every(nonEmpty),
  defaultUnitId: (v) => v === null || nonEmpty(v),
  panelAccess: (v) => typeof v === "boolean",
  permissions: (v) => Array.isArray(v) && v.every((x) => PERMISSION_LIST.includes(x)),
  confirmPhoneChange: (v) => v === true,
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

// Colaboradores de partida (F6b, RF05): dono, gerente e lançador; os dois últimos na primeira unidade.
function memberSeed(units) {
  const first = units[0].id;
  return [
    {
      id: fixedId(31),
      displayName: "Dono Demo",
      phone: "+5511988880001",
      email: "dono@exemplo.com.br",
      role: "owner",
      allUnits: true,
      unitIds: [],
      defaultUnitId: null,
      panelAccess: true,
      permissions: [],
      status: "active",
      invitedAt: null,
      deactivatedAt: null,
      previousStatus: "active",
    },
    {
      id: fixedId(32),
      displayName: "Gerente Demo",
      phone: "+5511988880002",
      email: "gerente@exemplo.com.br",
      role: "manager",
      allUnits: false,
      unitIds: [first],
      defaultUnitId: first,
      panelAccess: true,
      permissions: [],
      status: "active",
      invitedAt: FIXED_TIME,
      deactivatedAt: null,
      previousStatus: "active",
    },
    {
      id: fixedId(33),
      displayName: "Lançador Demo",
      phone: "+5511988880003",
      email: null,
      role: "staff",
      allUnits: false,
      unitIds: [first],
      defaultUnitId: first,
      panelAccess: false,
      permissions: [],
      status: "invited",
      invitedAt: FIXED_TIME,
      deactivatedAt: null,
      previousStatus: "invited",
    },
  ];
}

// Categorias (F6c, RF08): árvore do sistema de partida; ids 1001+ para não colidir com os criados (100+).
const CATEGORY_NATURES = ["fixed", "variable"];
const CATEGORY_STATUS_LIST = ["active", "inactive"];
const SUPPLIER_STATUS_LIST = ["active", "inactive"];
const SUPPLIER_LIST_STATUSES = ["active", "inactive", "all"];
const SUPPLIER_FROM_DEFAULT = "2026-11-01";
const SUPPLIER_TO_DEFAULT = "2026-11-30";
const SUPPLIER_ALIASES_MAX = 10;

const sys = (name, kind, nature, dreGroup, flags = {}) => ({
  name,
  kind,
  nature,
  dreGroup,
  sensitive: flags.sensitive === true,
  quantity: flags.quantity === true,
});

const CATEGORY_SEED = [
  sys("Vendas", "revenue", null, "receita_bruta"),
  sys("Outras receitas", "revenue", null, "receita_bruta"),
  sys("Impostos sobre faturamento", "deduction", null, "deducoes"),
  sys("Taxas de cartão", "deduction", null, "deducoes"),
  sys("Comissões de aplicativos", "deduction", null, "deducoes"),
  sys("Carnes", "expense", "variable", "cmv", { quantity: true }),
  sys("Hortifrúti", "expense", "variable", "cmv", { quantity: true }),
  sys("Bebidas", "expense", "variable", "cmv", { quantity: true }),
  sys("Mercearia", "expense", "variable", "cmv", { quantity: true }),
  sys("Embalagens e descartáveis", "expense", "variable", "cmv", { quantity: true }),
  sys("Salários", "expense", "fixed", "pessoal", { sensitive: true }),
  sys("Encargos", "expense", "fixed", "pessoal", { sensitive: true }),
  sys("Benefícios", "expense", "fixed", "pessoal", { sensitive: true }),
  sys("Pró-labore", "expense", "fixed", "pessoal", { sensitive: true }),
  sys("Extras e freelas", "expense", "variable", "pessoal", { sensitive: true }),
  sys("Aluguel", "expense", "fixed", "ocupacao"),
  sys("Condomínio", "expense", "fixed", "ocupacao"),
  sys("IPTU", "expense", "fixed", "ocupacao"),
  sys("Energia", "expense", "variable", "utilidades"),
  sys("Água", "expense", "variable", "utilidades"),
  sys("Gás", "expense", "variable", "utilidades"),
  sys("Internet e telefone", "expense", "fixed", "utilidades"),
  sys("Limpeza", "expense", "variable", "operacionais"),
  sys("Manutenção", "expense", "variable", "operacionais"),
  sys("Sistemas e assinaturas", "expense", "fixed", "operacionais"),
  sys("Contabilidade", "expense", "fixed", "operacionais"),
  sys("Marketing", "expense", "variable", "marketing"),
  sys("Juros", "expense", "variable", "financeiras"),
  sys("Tarifas bancárias", "expense", "variable", "financeiras"),
  sys("Equipamentos", "investment", null, "investimentos"),
  sys("Reformas", "investment", null, "investimentos"),
  sys("Outras despesas", "expense", "variable", "operacionais"),
];

function categorySeed() {
  const roots = CATEGORY_SEED.map((c, i) => ({
    id: fixedId(1001 + i),
    name: c.name,
    parentId: null,
    kind: c.kind,
    nature: c.nature,
    dreGroup: c.dreGroup,
    isSensitive: c.sensitive,
    requiresQuantity: c.quantity,
    supportWords: [],
    origin: "system",
    status: "active",
  }));
  const carnes = roots.find((c) => c.name === "Carnes");
  roots.push({
    id: fixedId(1040),
    name: "Frutos do mar",
    parentId: carnes.id,
    kind: carnes.kind,
    nature: "variable",
    dreGroup: carnes.dreGroup,
    isSensitive: carnes.isSensitive,
    requiresQuantity: carnes.requiresQuantity,
    supportWords: ["camarão", "lula"],
    origin: "company",
    status: "active",
  });
  return roots;
}

// Fornecedores (F6c, RF07): o CPF sai mascarado para quem não é dono nem contador.
const SUPPLIER_SEED = [
  ["Atacadão", ["atacado"], "11222333000181", "cnpj", 123456, "2026-11-20", "message"],
  ["Ceasa", [], null, null, 45000, "2026-11-18", "message"],
  ["Ambev", ["ambev sp"], "11444777000161", "cnpj", 9900, "2026-11-10", "message"],
  ["Pessoa Física", [], "52998224725", "cpf", 0, null, "panel"],
  ["Ceasa Norte", [], null, null, 2000, "2026-11-05", "message"],
];

function supplierSeed() {
  return SUPPLIER_SEED.map(
    ([name, aliases, document, documentKind, totalSpentCents, lastPurchaseOn, origin], i) => ({
      id: fixedId(1051 + i),
      name,
      aliases,
      document,
      documentKind,
      status: "active",
      origin,
      totalSpentCents,
      lastPurchaseOn,
      mergedIntoId: null,
    }),
  );
}

function stateOf(company) {
  if (!stateByTenant.has(company.tenantId)) {
    const units = unitSeed(company);
    stateByTenant.set(company.tenantId, {
      paymentMethods: paymentSeed(),
      salesChannels: channelSeed(),
      units,
      members: memberSeed(units),
      categories: categorySeed(),
      suppliers: supplierSeed(),
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

// Colaborador: o estado guarda `previousStatus` (interno, para reativar); a resposta não o leva.
const maskPhone = (phone) => `•••• ${phone.replace(/\D/g, "").slice(-4)}`;
const inviteTextFor = (name) =>
  `Oi, ${name}! Salve este número e mande um Oi para começar a lançar.`;
const emailRequired = {
  status: 422,
  body: { code: "validation", field: "email", reason: "required" },
};
const alreadyMember = { status: 409, body: { code: "already_member" } };
const lastActiveOwner = { status: 422, body: { code: "last_active_owner" } };

// Telefone e e-mail só para o dono (o gerente vê só o mascarado); o dono também os recebe na lista.
function publicMember(m, full) {
  const base = {
    id: m.id,
    displayName: m.displayName,
    phoneMasked: maskPhone(m.phone),
    role: m.role,
    allUnits: m.allUnits,
    unitIds: m.unitIds,
    defaultUnitId: m.defaultUnitId,
    panelAccess: m.panelAccess,
    permissions: m.permissions,
    status: m.status,
    invitedAt: m.invitedAt,
    deactivatedAt: m.deactivatedAt,
  };
  return full ? { ...base, phone: m.phone, email: m.email } : base;
}

function isActiveOwner(m) {
  return m.role === "owner" && m.status === "active";
}

// Único dono ativo: não pode ser rebaixado nem desativado (a API real também recusa).
function isLastActiveOwner(s, m) {
  return isActiveOwner(m) && s.members.filter(isActiveOwner).length <= 1;
}

function listMembers(s, searchParams, company) {
  const full = company.role === "owner";
  const search = searchParams.get("search");
  const role = searchParams.get("role");
  const status = searchParams.get("status");
  const items = s.members
    .filter((m) => full || m.allUnits || m.unitIds.some((u) => company.unitIds.includes(u)))
    .filter((m) => !role || m.role === role)
    .filter((m) => !status || m.status === status)
    .filter((m) => !search || nameKey(m.displayName).includes(nameKey(search)))
    .map((m) => publicMember(m, full));
  return ok({ items });
}

function createMember(s, input) {
  if (!bodyIsValid(input, MEMBER_INPUT_KEYS, MEMBER_INPUT_KEYS)) return invalidRequest;
  const phone = input.phone.trim();
  if (s.members.some((m) => m.phone === phone)) return alreadyMember;
  if (input.panelAccess && input.email === null) return emailRequired;
  const item = {
    id: nextId(s),
    displayName: input.displayName.trim(),
    phone,
    email: input.email === null ? null : input.email.trim().toLowerCase(),
    role: input.role,
    allUnits: input.allUnits,
    unitIds: input.unitIds,
    defaultUnitId: input.defaultUnitId,
    panelAccess: input.panelAccess,
    permissions: input.permissions,
    status: "invited",
    invitedAt: FIXED_TIME,
    deactivatedAt: null,
    previousStatus: "invited",
  };
  s.members.push(item);
  return created({ member: publicMember(item, true), inviteText: inviteTextFor(item.displayName) });
}

// Patch parcial: só as chaves enviadas mudam. Telefone exige confirmPhoneChange: true.
function patchMember(s, id, input) {
  const item = s.members.find((m) => m.id === id);
  if (!item) return notFound;
  if (!bodyIsValid(input, MEMBER_PATCH_KEYS, [])) return invalidRequest;
  if ("phone" in input && input.confirmPhoneChange !== true) return invalidRequest;
  const changes = {};
  for (const key of MEMBER_INPUT_KEYS) if (key in input) changes[key] = input[key];
  if (typeof changes.displayName === "string") changes.displayName = changes.displayName.trim();
  if (typeof changes.phone === "string") changes.phone = changes.phone.trim();
  if (typeof changes.email === "string") changes.email = changes.email.trim().toLowerCase();
  if (typeof changes.phone === "string") {
    const phone = changes.phone;
    if (s.members.some((m) => m.id !== id && m.phone === phone)) return alreadyMember;
  }
  const merged = { ...item, ...changes };
  if (isLastActiveOwner(s, item) && !isActiveOwner(merged)) return lastActiveOwner;
  if (merged.panelAccess && merged.email === null) return emailRequired;
  Object.assign(item, changes);
  return ok(publicMember(item, true));
}

// Desativar guarda o estado anterior; reativar volta a `active` só se era ativo, senão `invited`.
function setMemberStatus(s, id, action) {
  const item = s.members.find((m) => m.id === id);
  if (!item) return notFound;
  if (action === "deactivate") {
    if (isLastActiveOwner(s, item)) return lastActiveOwner;
    if (item.status !== "deactivated") item.previousStatus = item.status;
    item.status = "deactivated";
    item.deactivatedAt = FIXED_TIME;
  } else if (item.status === "deactivated") {
    item.status = item.previousStatus === "active" ? "active" : "invited";
    item.deactivatedAt = null;
  }
  return ok(publicMember(item, true));
}

// Leitura: dono e gerente (o gerente só vê quem tem unidade em comum). Escrita: só o dono.
function answerMembers(method, id, action, searchParams, input, company) {
  if (method === "GET" && id) return notFound;
  if (method === "POST" && id && !action) return notFound;
  if (method === "PATCH" && (!id || action)) return notFound;
  if (!["GET", "POST", "PATCH"].includes(method)) return notFound;

  const denied = gateFor(company, method !== "GET");
  if (denied) return denied;

  const s = stateOf(company);
  if (method === "GET") return listMembers(s, searchParams, company);
  if (method === "POST" && action) return setMemberStatus(s, id, action);
  if (method === "POST") return createMember(s, input);
  return patchMember(s, id, input);
}

function answerRestricted(method, pathname) {
  if (method === "GET" && pathname === "/api/restricted/units") return ok({ units: [] });
  return notFound;
}

// Forma do corpo para categorias e fornecedores: chave fora da lista ou tipo errado vira 400 (contrato estrito).
function shapeIsValid(body, checks, required) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  for (const key of Object.keys(body)) {
    if (!Object.hasOwn(checks, key) || !checks[key](body[key])) return false;
  }
  return required.every((key) => key in body);
}

const isText = (v) => typeof v === "string";
const isStringArray = (v) => Array.isArray(v) && v.every(isText);
const isWordList = (v) =>
  Array.isArray(v) &&
  v.length <= 30 &&
  v.every((w) => isText(w) && w.length >= 1 && w.length <= 40);
const isNatureOrNull = (v) => v === null || CATEGORY_NATURES.includes(v);
const isCategoryStatus = (v) => CATEGORY_STATUS_LIST.includes(v);
const isSupplierStatus = (v) => SUPPLIER_STATUS_LIST.includes(v);
const CATEGORY_CREATE_CHECKS = {
  parentId: isText,
  name: isText,
  nature: isNatureOrNull,
  supportWords: isWordList,
};
const CATEGORY_PATCH_CHECKS = {
  name: isText,
  nature: isNatureOrNull,
  supportWords: isWordList,
  status: isCategoryStatus,
};
const SUPPLIER_PATCH_CHECKS = {
  name: isText,
  document: (v) => v === null || (isText(v) && v.length <= 30),
  aliases: isStringArray,
  status: isSupplierStatus,
};
const MERGE_CHECKS = { targetId: isText };

const byName = (a, b) => a.name.localeCompare(b.name, "pt-BR");
const categoryNameInvalid = {
  status: 422,
  body: { code: "validation", field: "name", reason: "invalid" },
};
const supplierDocumentInvalid = {
  status: 422,
  body: { code: "validation", field: "document", reason: "invalid" },
};
const digitsOf = (text) => text.replace(/\D/g, "");

function publicCategory(c) {
  return {
    id: c.id,
    name: c.name,
    parentId: c.parentId,
    kind: c.kind,
    nature: c.nature,
    dreGroup: c.dreGroup,
    isSensitive: c.isSensitive,
    requiresQuantity: c.requiresQuantity,
    supportWords: [...c.supportWords],
    origin: c.origin,
    status: c.status,
  };
}

// Sensível só para dono e contador; o filho de uma categoria sensível também some para os demais.
function categoryVisible(c, all, includeSensitive) {
  if (includeSensitive) return true;
  if (c.isSensitive) return false;
  const parent = c.parentId ? all.find((x) => x.id === c.parentId) : null;
  return !parent?.isSensitive;
}

// Nome ou palavra de apoio contém a busca (já sem caixa e sem acento). Busca vazia casa tudo.
function categoryMatches(c, key) {
  return nameKey(c.name).includes(key) || c.supportWords.some((w) => nameKey(w).includes(key));
}

// Mesma regra da API real: se o pai casa, os filhos que passam nos filtros entram todos; senão só os que casam.
function listCategories(s, searchParams, company) {
  const includeSensitive = company.role === "owner" || company.role === "accountant";
  const search = searchParams.get("search") ?? "";
  const kind = searchParams.get("kind");
  const status = searchParams.get("status");
  const key = nameKey(search);
  const passes = (c) => (!kind || c.kind === kind) && (!status || c.status === status);
  const visible = s.categories.filter((c) => categoryVisible(c, s.categories, includeSensitive));

  const tree = [];
  for (const root of visible.filter((c) => c.parentId === null).sort(byName)) {
    const rootMatches = categoryMatches(root, key);
    const children = visible
      .filter(
        (c) => c.parentId === root.id && passes(c) && (rootMatches || categoryMatches(c, key)),
      )
      .sort(byName)
      .map(publicCategory);
    if ((passes(root) && rootMatches) || children.length > 0) {
      tree.push({ ...publicCategory(root), children });
    }
  }
  return ok({ items: tree });
}

// Subcategoria da empresa: herda kind, dreGroup, isSensitive e requiresQuantity do pai.
function createCategory(s, input) {
  if (!shapeIsValid(input, CATEGORY_CREATE_CHECKS, ["parentId", "name", "supportWords"])) {
    return invalidRequest;
  }
  const parent = s.categories.find(
    (c) => c.id === input.parentId && c.origin === "system" && c.parentId === null,
  );
  if (!parent) {
    return { status: 422, body: { code: "validation", field: "parent_id", reason: "unknown" } };
  }
  const name = input.name.trim();
  if (name.length < 2 || name.length > 60) return categoryNameInvalid;
  if (input.nature != null && parent.kind !== "expense") {
    return { status: 422, body: { code: "validation", field: "nature", reason: "invalid" } };
  }
  const siblings = s.categories.filter((c) => c.parentId === parent.id);
  if (isNameTaken(siblings, name)) return nameTaken;
  const item = {
    id: nextId(s),
    name,
    parentId: parent.id,
    kind: parent.kind,
    nature: input.nature ?? parent.nature,
    dreGroup: parent.dreGroup,
    isSensitive: parent.isSensitive,
    requiresQuantity: parent.requiresQuantity,
    supportWords: [...input.supportWords],
    origin: "company",
    status: "active",
  };
  s.categories.push(item);
  return created(publicCategory(item));
}

// Categoria do sistema não muda (422), como na API real; a ordem segue a rota: forma, depois id.
function patchCategory(s, id, input) {
  if (!shapeIsValid(input, CATEGORY_PATCH_CHECKS, [])) return invalidRequest;
  const item = s.categories.find((c) => c.id === id);
  if (!item) return notFound;
  if (item.origin === "system") {
    return { status: 422, body: { code: "validation", field: "name", reason: "system_read_only" } };
  }
  if (typeof input.name === "string") {
    const name = input.name.trim();
    if (name.length < 2 || name.length > 60) return categoryNameInvalid;
    const siblings = s.categories.filter((c) => c.parentId === item.parentId);
    if (isNameTaken(siblings, name, id)) return nameTaken;
    item.name = name;
  }
  if ("nature" in input) item.nature = input.nature;
  if ("supportWords" in input) item.supportWords = [...input.supportWords];
  if ("status" in input) item.status = input.status;
  return ok(publicCategory(item));
}

function answerCategories(method, id, searchParams, input, company) {
  if (method === "GET") {
    if (id) return notFound;
    return gateFor(company, false) ?? listCategories(stateOf(company), searchParams, company);
  }
  if (method === "POST") {
    if (id) return notFound;
    return gateFor(company, true) ?? createCategory(stateOf(company), input);
  }
  if (method === "PATCH") {
    if (!id) return notFound;
    return gateFor(company, true) ?? patchCategory(stateOf(company), id, input);
  }
  return notFound;
}

// Fornecedor: CPF mascarado para quem não é dono nem contador; CNPJ sai inteiro.
const maskCpf = (d) => `•••.•••.${d.slice(-5, -2)}-${d.slice(-2)}`;
function publicSupplier(x, full) {
  const document =
    x.document && x.documentKind === "cpf" && !full ? maskCpf(x.document) : x.document;
  return {
    id: x.id,
    name: x.name,
    aliases: [...x.aliases],
    document,
    documentKind: x.documentKind,
    status: x.status,
    origin: x.origin,
    totalSpentCents: x.totalSpentCents,
    lastPurchaseOn: x.lastPurchaseOn,
  };
}

const visibleSuppliers = (s) => s.suppliers.filter((x) => !x.mergedIntoId);
const fullSupplierView = (company) => company.role === "owner" || company.role === "accountant";

// Leitura: owner, manager e accountant (staff já sai pelo gateFor). Padrão de status: todos os não mesclados.
function listSuppliers(s, searchParams, company) {
  const from = searchParams.get("from") ?? SUPPLIER_FROM_DEFAULT;
  const to = searchParams.get("to") ?? SUPPLIER_TO_DEFAULT;
  if (from > to) {
    return { status: 422, body: { code: "validation", field: "to", reason: "before_from" } };
  }
  const status = searchParams.get("status");
  if (status && !SUPPLIER_LIST_STATUSES.includes(status)) return invalidRequest;
  const search = searchParams.get("search") ?? "";
  const key = nameKey(search);
  const digits = digitsOf(search);
  const full = fullSupplierView(company);
  const items = visibleSuppliers(s)
    .filter((x) => !status || status === "all" || x.status === status)
    .filter(
      (x) =>
        !search ||
        nameKey(x.name).includes(key) ||
        x.aliases.some((a) => nameKey(a).includes(key)) ||
        (digits.length > 0 && (x.document ?? "").includes(digits)),
    )
    .sort(byName)
    .map((x) => publicSupplier(x, full));
  return ok({ items, from, to });
}

// Escrita de fornecedor: dono e gerente, com a conta ativa (contador e staff saem com 403).
function supplierWriteGate(company) {
  if (company.role !== "owner" && company.role !== "manager") return forbidden;
  if (company.accountStatus !== "active") return accountReadOnly;
  return null;
}

function patchSupplier(s, id, input, full) {
  if (!shapeIsValid(input, SUPPLIER_PATCH_CHECKS, [])) return invalidRequest;
  const item = visibleSuppliers(s).find((x) => x.id === id);
  if (!item) return notFound;
  const others = visibleSuppliers(s).filter((x) => x.id !== id);
  const name = typeof input.name === "string" ? input.name.trim() : null;
  if (name !== null && isNameTaken(others, name)) return nameTaken;
  const document =
    input.document === undefined || input.document === null
      ? input.document
      : digitsOf(input.document);
  if (typeof document === "string" && others.some((x) => x.document === document)) {
    return { status: 409, body: { code: "document_taken" } };
  }
  if (typeof document === "string" && document.length !== 11 && document.length !== 14) {
    return supplierDocumentInvalid;
  }
  if (input.aliases && input.aliases.length > SUPPLIER_ALIASES_MAX) {
    return { status: 422, body: { code: "validation", field: "aliases", reason: "too_many" } };
  }
  if (name !== null) item.name = name;
  if (document !== undefined) {
    item.document = document;
    item.documentKind = document === null ? null : document.length === 11 ? "cpf" : "cnpj";
  }
  if (input.aliases) item.aliases = input.aliases.map((a) => a.trim());
  if (input.status) item.status = input.status;
  return ok(publicSupplier(item, full));
}

// Origem e destino precisam existir e ser diferentes; a ordem segue a prévia da API real.
function mergePair(s, id, targetId) {
  const origin = visibleSuppliers(s).find((x) => x.id === id);
  if (!origin) return { error: notFound };
  if (targetId === id) {
    return {
      error: {
        status: 422,
        body: { code: "validation", field: "target_id", reason: "same_supplier" },
      },
    };
  }
  const target = visibleSuppliers(s).find((x) => x.id === targetId);
  if (!target) return { error: notFound };
  return { origin, target };
}

function previewMerge(s, id, input, company) {
  if (!shapeIsValid(input, MERGE_CHECKS, ["targetId"])) return invalidRequest;
  const pair = mergePair(s, id, input.targetId);
  if (pair.error) return pair.error;
  // A prévia do gerente não conta o que ele não vê.
  return ok({ visibleEntries: company.role === "owner" ? 5 : 3 });
}

function mergeSuppliers(s, id, input, full) {
  if (!shapeIsValid(input, MERGE_CHECKS, ["targetId"])) return invalidRequest;
  const pair = mergePair(s, id, input.targetId);
  if (pair.error) return pair.error;
  const { origin, target } = pair;
  if (origin.document && target.document && origin.document !== target.document) {
    return { status: 422, body: { code: "document_conflict" } };
  }
  const aliases = [...new Set([...target.aliases, origin.name, ...origin.aliases])];
  if (aliases.length > SUPPLIER_ALIASES_MAX) {
    return { status: 422, body: { code: "aliases_overflow" } };
  }
  target.aliases = aliases;
  if (!target.document && origin.document) {
    target.document = origin.document;
    target.documentKind = origin.documentKind;
  }
  target.totalSpentCents += origin.totalSpentCents;
  origin.status = "inactive";
  origin.mergedIntoId = target.id;
  return ok({ ok: true, target: publicSupplier(target, full) });
}

function answerSuppliers(method, id, action, searchParams, input, company) {
  if (method === "GET") {
    if (id) return notFound;
    return gateFor(company, false) ?? listSuppliers(stateOf(company), searchParams, company);
  }
  const full = fullSupplierView(company);
  if (method === "PATCH" && id && !action) {
    const denied = supplierWriteGate(company);
    return denied ?? patchSupplier(stateOf(company), id, input, full);
  }
  if (method === "POST" && id && action) {
    const denied = supplierWriteGate(company);
    if (denied) return denied;
    const s = stateOf(company);
    return action === "merge/preview"
      ? previewMerge(s, id, input, company)
      : mergeSuppliers(s, id, input, full);
  }
  return notFound;
}

// Roteia /api/settings* e /api/restricted* (GET, POST, PATCH). Sessão e contexto ficam em fake-api.mjs.
export function answerSettings(method, url, body, company) {
  const { pathname, searchParams } = new URL(url, "http://localhost");
  const input = body && typeof body === "object" ? body : {};

  if (pathname.startsWith("/api/restricted")) return answerRestricted(method, pathname);

  const memberMatch = /^\/api\/settings\/members(?:\/([^/]+)(?:\/(deactivate|reactivate))?)?$/.exec(
    pathname,
  );
  if (memberMatch) {
    const [, memberId, memberAction] = memberMatch;
    return answerMembers(method, memberId, memberAction, searchParams, input, company);
  }

  const categoryMatch = /^\/api\/settings\/categories(?:\/([^/]+))?$/.exec(pathname);
  if (categoryMatch)
    return answerCategories(method, categoryMatch[1], searchParams, input, company);

  const supplierMatch =
    /^\/api\/settings\/suppliers(?:\/([^/]+)(?:\/(merge\/preview|merge))?)?$/.exec(pathname);
  if (supplierMatch) {
    const [, supplierId, supplierAction] = supplierMatch;
    return answerSuppliers(method, supplierId, supplierAction, searchParams, input, company);
  }

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
