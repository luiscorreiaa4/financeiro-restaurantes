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

export const ROUTE_MATRIX: readonly RouteCase[] = [
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
