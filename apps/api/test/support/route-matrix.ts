/**
 * Matriz papel × rota das rotas de lançamentos do painel (RF06.CA06, regra 5 de
 * `.claude/rules/rota-de-tenant.md`). Cada linha diz o status HTTP que cada persona recebe.
 * Rota nova de lançamentos (detalhe, origem, escritas, lixeira) acrescenta linhas aqui;
 * `entries-panel.int.test.ts` percorre a tabela inteira.
 */
export const PERSONAS = [
  /** Dono, todas as unidades. */
  "owner",
  /** Gerente com VER_FOLHA, unidades 1 e 2. */
  "manager",
  /** Gerente sem VER_FOLHA, unidades 1 e 2. */
  "managerNoPayroll",
  /** Lançador com painel liberado, unidade 1. */
  "staff",
  /** Contador, todas as unidades, só leitura. */
  "accountant",
  /** Sessão restrita (DD-33): sem vínculo ativo, não entra em rota de tenant. */
  "restricted",
  /** Dono de uma empresa com a conta em somente leitura (RF37). */
  "readOnly",
  /** Lançador sem o painel liberado: só lança pelo WhatsApp, não entra em rota do painel. */
  "staffNoPanel",
] as const;

export type Persona = (typeof PERSONAS)[number];

/** O que as linhas precisam do cenário para montar a URL e o corpo. */
export interface MatrixFixture {
  /** `from=...&to=...` do mês dos lançamentos do cenário. */
  readonly period: string;
  /** Um lançamento que cada persona enxerga (na sua empresa, unidade e autoria). */
  readonly entryIds: Readonly<Record<Persona, string>>;
}

export interface RouteCase {
  readonly name: string;
  readonly method: "GET" | "POST" | "PATCH" | "DELETE";
  readonly url: (fixture: MatrixFixture, persona: Persona) => string;
  readonly body?: (fixture: MatrixFixture) => unknown;
  readonly expected: Readonly<Record<Persona, number>>;
}

/** Leitura que todo papel com painel faz; a conta somente leitura continua lendo. */
const READ_BY_ALL: RouteCase["expected"] = {
  owner: 200,
  manager: 200,
  managerNoPayroll: 200,
  staff: 200,
  accountant: 200,
  restricted: 401,
  readOnly: 200,
  staffNoPanel: 401,
};

/**
 * Escrita no próprio lançamento com versão esperada que não existe: quem pode editar chega ao
 * 409 (versão velha) sem gravar nada, para a tabela inteira rodar sem alterar o cenário; quem
 * não pode editar é barrado antes, com o status da sua recusa.
 */
const STALE_EDIT_BODY = { expectedVersion: 999, patch: { description: "Matriz" } };

/**
 * Criação: categoria que não existe leva quem pode lançar ao 422 (UnknownReference) sem gravar
 * nada no cenário; chave nova a cada chamada (RF26.R3).
 */
const missingCategoryCreateBody = () => ({
  clientRequestId: crypto.randomUUID(),
  type: "expense",
  occurredOn: "2026-11-05",
  description: "Matriz",
  amountCents: 100,
  categoryId: crypto.randomUUID(),
  unitId: crypto.randomUUID(),
});

/**
 * Relatório do dashboard (RF27): permissão `report:view`, que o lançador não tem (403 mesmo com
 * painel). A conta somente leitura continua lendo.
 */
const REPORT_READ: RouteCase["expected"] = { ...READ_BY_ALL, staff: 403 };

export const ROUTE_MATRIX: readonly RouteCase[] = [
  {
    name: "GET /api/reports/summary",
    method: "GET",
    url: (f) => `/api/reports/summary?${f.period}`,
    expected: REPORT_READ,
  },
  {
    name: "GET /api/reports/monthly",
    method: "GET",
    url: () => "/api/reports/monthly?to=2026-11-30",
    expected: REPORT_READ,
  },
  {
    name: "GET /api/reports/breakdown",
    method: "GET",
    url: (f) => `/api/reports/breakdown?${f.period}&by=category`,
    expected: REPORT_READ,
  },
  {
    name: "GET /api/entries",
    method: "GET",
    url: (f) => `/api/entries?${f.period}`,
    expected: READ_BY_ALL,
  },
  {
    name: "GET /api/entries/totals",
    method: "GET",
    url: (f) => `/api/entries/totals?${f.period}`,
    expected: READ_BY_ALL,
  },
  {
    name: "GET /api/entries/options",
    method: "GET",
    url: () => "/api/entries/options",
    expected: READ_BY_ALL,
  },
  {
    name: "GET /api/entries/:id",
    method: "GET",
    url: (f, persona) => `/api/entries/${f.entryIds[persona]}`,
    expected: READ_BY_ALL,
  },
  {
    name: "GET /api/entries/:id/source",
    method: "GET",
    url: (f, persona) => `/api/entries/${f.entryIds[persona]}/source`,
    expected: READ_BY_ALL,
  },
  {
    name: "POST /api/entries",
    method: "POST",
    url: () => "/api/entries",
    body: missingCategoryCreateBody,
    expected: {
      owner: 422,
      manager: 422,
      managerNoPayroll: 422,
      staff: 422,
      // Contador não lança; conta somente leitura não grava (RF37).
      accountant: 403,
      restricted: 401,
      readOnly: 403,
      staffNoPanel: 401,
    },
  },
  {
    name: "PATCH /api/entries/:id",
    method: "PATCH",
    url: (f, persona) => `/api/entries/${f.entryIds[persona]}`,
    body: () => STALE_EDIT_BODY,
    expected: {
      owner: 409,
      manager: 409,
      managerNoPayroll: 409,
      staff: 409,
      // Contador não edita (RF23.CA04); conta somente leitura não grava (RF37).
      accountant: 403,
      restricted: 401,
      readOnly: 403,
      staffNoPanel: 401,
    },
  },
  {
    name: "DELETE /api/entries/:id",
    method: "DELETE",
    url: (f, persona) => `/api/entries/${f.entryIds[persona]}`,
    // Motivo de 201 caracteres: quem pode excluir chega ao 400 sem apagar nada do cenário.
    body: () => ({ reason: "a".repeat(201) }),
    expected: {
      owner: 400,
      manager: 400,
      managerNoPayroll: 400,
      staff: 400,
      accountant: 403,
      restricted: 401,
      readOnly: 403,
      staffNoPanel: 401,
    },
  },
  {
    name: "POST /api/entries/:id/restore",
    method: "POST",
    url: (f, persona) => `/api/entries/${f.entryIds[persona]}/restore`,
    // Lançamento ativo: quem pode restaurar chega ao 422 (EntryNotDeleted) sem gravar nada.
    expected: {
      owner: 422,
      manager: 422,
      managerNoPayroll: 422,
      staff: 422,
      accountant: 403,
      restricted: 401,
      readOnly: 403,
      staffNoPanel: 401,
    },
  },
  {
    name: "GET /api/trash",
    method: "GET",
    url: () => "/api/trash?deletedFrom=2026-01-01&deletedTo=2026-12-31",
    // Quem não restaura não tem lixeira: o contador recebe 403 (RF24.R2). A conta somente
    // leitura continua lendo, sem ação oferecida.
    expected: { ...READ_BY_ALL, accountant: 403 },
  },
  {
    name: "POST /api/entries/batch/preview",
    method: "POST",
    url: () => "/api/entries/batch/preview",
    body: (f) => ({ ids: [f.entryIds.owner] }),
    // Só dono e gerente (RF24.Obs3); a prévia não grava e responde 200.
    expected: {
      owner: 200,
      manager: 200,
      managerNoPayroll: 200,
      staff: 403,
      accountant: 403,
      restricted: 401,
      readOnly: 403,
      staffNoPanel: 401,
    },
  },
  {
    name: "POST /api/entries/batch/delete",
    method: "POST",
    url: () => "/api/entries/batch/delete",
    // Ids repetidos: quem pode excluir em lote chega ao 400 sem apagar nada do cenário.
    body: (f) => ({ ids: [f.entryIds.owner, f.entryIds.owner] }),
    expected: {
      owner: 400,
      manager: 400,
      managerNoPayroll: 400,
      staff: 403,
      accountant: 403,
      restricted: 401,
      readOnly: 403,
      staffNoPanel: 401,
    },
  },
];

/** O que as linhas de exportação precisam do cenário (um pedido pronto e um link por persona). */
export interface ExportMatrixFixture {
  /** Pedido `ready` de cada persona, com o arquivo no store. */
  readonly exportIds: Readonly<Record<Persona, string>>;
  /** URL de download já com o token de cada persona (emitido no relógio inicial). */
  readonly downloadUrls: Readonly<Record<Persona, string>>;
}

export interface ExportRouteCase {
  readonly name: string;
  readonly method: "GET" | "POST";
  readonly url: (fixture: ExportMatrixFixture, persona: Persona) => string;
  readonly body?: () => unknown;
  /** Navegação do navegador: não manda `X-Context` (o contexto vem só do cookie). */
  readonly navigation?: true;
  readonly expected: Readonly<Record<Persona, number>>;
}

/**
 * Exportar é leitura (DD-06): a conta somente leitura exporta. O gerente do cenário tem
 * EXPORTAR_DADOS (com e sem VER_FOLHA); o lançador, não. Roda em `exports-routes.int.test.ts`,
 * com cenário próprio: a tabela acima é de lançamentos e seu cenário não tem pedido de exportação.
 */
const EXPORT_ALLOWED: ExportRouteCase["expected"] = {
  owner: 200,
  manager: 200,
  managerNoPayroll: 200,
  staff: 403,
  accountant: 200,
  restricted: 401,
  readOnly: 200,
  staffNoPanel: 401,
};

export const EXPORT_ROUTE_MATRIX: readonly ExportRouteCase[] = [
  {
    name: "POST /api/exports",
    method: "POST",
    url: () => "/api/exports",
    body: () => ({
      format: "csv",
      content: "entries",
      filters: { from: "2026-11-01", to: "2026-11-30" },
      clientRequestId: crypto.randomUUID(),
    }),
    // Criar pedido responde 202 (aceito, a geração é assíncrona).
    expected: {
      ...EXPORT_ALLOWED,
      owner: 202,
      manager: 202,
      managerNoPayroll: 202,
      accountant: 202,
      readOnly: 202,
    },
  },
  {
    name: "GET /api/exports",
    method: "GET",
    url: () => "/api/exports",
    expected: EXPORT_ALLOWED,
  },
  {
    name: "POST /api/exports/:id/link",
    method: "POST",
    url: (f, persona) => `/api/exports/${f.exportIds[persona]}/link`,
    expected: EXPORT_ALLOWED,
  },
  {
    name: "GET /api/exports/:id/download",
    method: "GET",
    url: (f, persona) => f.downloadUrls[persona],
    navigation: true,
    expected: EXPORT_ALLOWED,
  },
];

export interface SettingsRouteCase {
  readonly name: string;
  readonly method: "GET" | "POST" | "PATCH";
  readonly url: () => string;
  readonly body?: () => unknown;
  readonly expected: Readonly<Record<Persona, number>>;
}

/** Id que não existe em empresa nenhuma: quem pode escrever chega ao 404 sem gravar nada. */
const MISSING_UNIT_ID = "01900000-0000-7000-8000-000000000001";

/**
 * Leitura do catálogo (`catalog:view`): dono, gerente, contador e a conta somente leitura leem; o
 * lançador não tem a ação (403). Escrita (`catalog:manage`): só o dono (RF04.CA05); a conta somente
 * leitura é barrada depois da permissão (`account_read_only`, RF37). Roda em
 * `settings-units.int.test.ts`, com cenário próprio.
 */
const SETTINGS_READ: SettingsRouteCase["expected"] = {
  owner: 200,
  manager: 200,
  managerNoPayroll: 200,
  staff: 403,
  accountant: 200,
  restricted: 401,
  readOnly: 200,
  staffNoPanel: 401,
};

const settingsWrite = (ownerStatus: number): SettingsRouteCase["expected"] => ({
  owner: ownerStatus,
  manager: 403,
  managerNoPayroll: 403,
  staff: 403,
  accountant: 403,
  restricted: 401,
  readOnly: 403,
  staffNoPanel: 401,
});

export const SETTINGS_ROUTE_MATRIX: readonly SettingsRouteCase[] = [
  {
    name: "GET /api/settings/units",
    method: "GET",
    url: () => "/api/settings/units",
    expected: SETTINGS_READ,
  },
  {
    name: "POST /api/settings/units",
    method: "POST",
    url: () => "/api/settings/units",
    // Município inexistente: quem pode criar chega ao 422 sem gravar nada.
    body: () => ({
      name: "Matriz da matriz",
      aliases: [],
      cnpj: null,
      uf: "AL",
      city: "Cidade Inexistente",
      timezone: "America/Sao_Paulo",
      status: "active",
      defaultSalesChannelId: null,
    }),
    expected: settingsWrite(422),
  },
  {
    name: "PATCH /api/settings/units/:id",
    method: "PATCH",
    url: () => `/api/settings/units/${MISSING_UNIT_ID}`,
    body: () => ({ name: "Qualquer" }),
    expected: settingsWrite(404),
  },
  {
    name: "POST /api/settings/units/:id/deactivate",
    method: "POST",
    url: () => `/api/settings/units/${MISSING_UNIT_ID}/deactivate`,
    expected: settingsWrite(404),
  },
  {
    name: "POST /api/settings/units/:id/reactivate",
    method: "POST",
    url: () => `/api/settings/units/${MISSING_UNIT_ID}/reactivate`,
    expected: settingsWrite(404),
  },
];

const MISSING_CATALOG_ID = "01900000-0000-7000-8000-000000000002";

/**
 * Formas de pagamento, canais de venda e prévia de taxa (F6a, RF08, RF09): leitura com
 * `catalog:view` (a prévia também), escrita só do dono e com a conta gravável. Roda em
 * `settings-catalog.int.test.ts`.
 */
export const CATALOG_ROUTE_MATRIX: readonly SettingsRouteCase[] = [
  {
    name: "GET /api/settings/payment-methods",
    method: "GET",
    url: () => "/api/settings/payment-methods",
    expected: SETTINGS_READ,
  },
  {
    name: "POST /api/settings/payment-methods",
    method: "POST",
    url: () => "/api/settings/payment-methods",
    // Nome do cadastro do sistema: quem pode criar chega ao 422 sem gravar nada.
    body: () => ({
      name: "Não informada",
      type: "other",
      feePercentBp: 0,
      feeFixedCents: 0,
      aliases: [],
      status: "active",
      isDefaultCard: false,
    }),
    expected: settingsWrite(422),
  },
  {
    name: "PATCH /api/settings/payment-methods/:id",
    method: "PATCH",
    url: () => `/api/settings/payment-methods/${MISSING_CATALOG_ID}`,
    body: () => ({ name: "Qualquer" }),
    expected: settingsWrite(404),
  },
  {
    name: "GET /api/settings/sales-channels",
    method: "GET",
    url: () => "/api/settings/sales-channels",
    expected: SETTINGS_READ,
  },
  {
    name: "POST /api/settings/sales-channels",
    method: "POST",
    url: () => "/api/settings/sales-channels",
    body: () => ({
      name: "Não informado",
      type: "other",
      feePercentBp: 0,
      aliases: [],
      status: "active",
    }),
    expected: settingsWrite(422),
  },
  {
    name: "PATCH /api/settings/sales-channels/:id",
    method: "PATCH",
    url: () => `/api/settings/sales-channels/${MISSING_CATALOG_ID}`,
    body: () => ({ name: "Qualquer" }),
    expected: settingsWrite(404),
  },
  {
    name: "GET /api/settings/fee-preview",
    method: "GET",
    url: () => "/api/settings/fee-preview?feePercentBp=320&feeFixedCents=0",
    expected: SETTINGS_READ,
  },
];

const MISSING_TARGET_ID = "01900000-0000-7000-8000-000000000003";

/** Só o dono (catalog:manage); a conta somente leitura chega até a gravação, que ela não faz. */
const ownerOnly = (ownerStatus: number, readOnlyStatus: number): SettingsRouteCase["expected"] => ({
  owner: ownerStatus,
  manager: 403,
  managerNoPayroll: 403,
  staff: 403,
  accountant: 403,
  restricted: 401,
  readOnly: readOnlyStatus,
  staffNoPanel: 401,
});

/**
 * Reaplicação de taxa (F6a, RF08 e RF09): só `catalog:manage`. A prévia e a consulta não gravam e a
 * conta somente leitura as acessa; a confirmação grava e é barrada (`account_read_only`). Alvo
 * inexistente: 404 sem criar linha. Roda em `settings-fee-reapply.int.test.ts`.
 */
export const FEE_REAPPLY_ROUTE_MATRIX: readonly SettingsRouteCase[] = [
  {
    name: "POST /api/settings/fee-reapplications/preview",
    method: "POST",
    url: () => "/api/settings/fee-reapplications/preview",
    body: () => ({
      targetKind: "payment_method",
      targetId: MISSING_TARGET_ID,
      from: "2026-10-01",
      to: "2026-10-31",
    }),
    expected: ownerOnly(404, 404),
  },
  {
    name: "POST /api/settings/fee-reapplications",
    method: "POST",
    url: () => "/api/settings/fee-reapplications",
    body: () => ({
      targetKind: "payment_method",
      targetId: MISSING_TARGET_ID,
      from: "2026-10-01",
      to: "2026-10-31",
      clientRequestId: "6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f",
    }),
    expected: ownerOnly(404, 403),
  },
  {
    name: "GET /api/settings/fee-reapplications",
    method: "GET",
    url: () =>
      `/api/settings/fee-reapplications?targetKind=payment_method&targetId=${MISSING_TARGET_ID}`,
    expected: ownerOnly(200, 200),
  },
];

const MISSING_MEMBER_ID = "01900000-0000-7000-8000-000000000003";

/**
 * Colaboradores (F6b, RF05, RF06.CA06): leitura com `user:view` (dono e gerente; o contador e o
 * lançador não têm a ação, 403); escrita só do dono (`user:manage`) e com a conta gravável. Roda
 * em `settings-members.int.test.ts`.
 */
const MEMBERS_READ: SettingsRouteCase["expected"] = {
  owner: 200,
  manager: 200,
  managerNoPayroll: 200,
  staff: 403,
  accountant: 403,
  restricted: 401,
  readOnly: 200,
  staffNoPanel: 401,
};

export const MEMBERS_ROUTE_MATRIX: readonly SettingsRouteCase[] = [
  {
    name: "GET /api/settings/members",
    method: "GET",
    url: () => "/api/settings/members",
    expected: MEMBERS_READ,
  },
  {
    name: "GET /api/settings/members/:id",
    method: "GET",
    url: () => `/api/settings/members/${MISSING_MEMBER_ID}`,
    expected: { ...MEMBERS_READ, owner: 404, manager: 404, managerNoPayroll: 404, readOnly: 404 },
  },
  {
    name: "POST /api/settings/members",
    method: "POST",
    url: () => "/api/settings/members",
    // Celular inválido: quem pode criar chega ao 422 sem gravar nada.
    body: () => ({
      displayName: "Matriz",
      phone: "123",
      email: null,
      role: "staff",
      allUnits: true,
      unitIds: [],
      defaultUnitId: null,
      panelAccess: false,
      permissions: [],
    }),
    expected: settingsWrite(422),
  },
  {
    name: "PATCH /api/settings/members/:id",
    method: "PATCH",
    url: () => `/api/settings/members/${MISSING_MEMBER_ID}`,
    body: () => ({ displayName: "Qualquer" }),
    expected: settingsWrite(404),
  },
  {
    name: "POST /api/settings/members/:id/deactivate",
    method: "POST",
    url: () => `/api/settings/members/${MISSING_MEMBER_ID}/deactivate`,
    expected: settingsWrite(404),
  },
  {
    name: "POST /api/settings/members/:id/reactivate",
    method: "POST",
    url: () => `/api/settings/members/${MISSING_MEMBER_ID}/reactivate`,
    expected: settingsWrite(404),
  },
];
