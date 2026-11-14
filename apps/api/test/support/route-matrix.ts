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
];
