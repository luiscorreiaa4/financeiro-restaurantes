// Relatórios da API falsa (F4, RF27): espelha /api/reports/* à mão, sem a regra de verdade. Dados
// fixos (sem Math.random nem Date.now); o período vem da URL. Função pura, sem servidor: o teste
// de contrato (apps/web/features/dashboard/fake-reports.test.ts) importa daqui sem subir a API.
// Os totais incluem a folha para todos que veem o dashboard; só o indicador de folha e o detalhe por
// categoria mudam para quem não vê categorias sensíveis (DD-41, RF27.R5 e Obs6).

const DEFAULT_FROM = "2026-11-01";
const DEFAULT_TO = "2026-11-17";
// Só há dados de jun a nov de 2026; períodos fora disso são vazios.
const DATA_FROM = "2026-06-01";
const DATA_TO = "2026-11-30";
const DAY = 86_400_000;

// Papéis com report:view (mesma tabela de ACTIONS_BY_ROLE em fake-api.mjs). Dono e contador
// veem categorias sensíveis; gerente, não.
const REPORT_ROLES = ["owner", "manager", "accountant"];
const SENSITIVE_ROLES = ["owner", "accountant"];

// Valores em centavos; ratios em permil (265 = 26,5%).
const CURRENT = {
  grossRevenue: 1000000,
  deductions: 35000,
  netRevenue: 965000,
  operatingExpenses: 700000,
  result: 265000,
  investments: 320000,
  margin: 265,
  cmvRatio: 250,
  payrollRatio: 300,
  averageTicket: 3000,
  breakEven: 2857143,
};
const PREVIOUS = {
  grossRevenue: 900000,
  deductions: 30000,
  netRevenue: 870000,
  operatingExpenses: 660000,
  result: 210000,
  investments: 320000,
  margin: 233,
  cmvRatio: 240,
  payrollRatio: 290,
  averageTicket: 2800,
  breakEven: 2600000,
};
const EMPTY_CURRENT = {
  grossRevenue: 0,
  deductions: 0,
  netRevenue: 0,
  operatingExpenses: 0,
  result: 0,
  investments: 0,
  margin: null,
  cmvRatio: null,
  payrollRatio: null,
  averageTicket: null,
  breakEven: null,
};
const EMPTY_PREVIOUS = { ...EMPTY_CURRENT };

// Variação em permil, como o servidor: (valor − anterior) ÷ anterior. Sem base, não há variação.
function indicator(value, previous) {
  if (value === null || previous === null || previous === 0) {
    return { value, previous, changePermille: null, direction: null };
  }
  const changePermille = Math.round(((value - previous) * 1000) / previous);
  const direction = changePermille > 0 ? "up" : changePermille < 0 ? "down" : "flat";
  return { value, previous, changePermille, direction };
}

function parseDay(day) {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function isoDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

// Período de comparação: o mesmo número de dias imediatamente antes, ou o mesmo intervalo do ano
// anterior. `none` não compara.
function comparisonOf(kind, from, to) {
  if (kind === "none") return null;
  if (kind === "previous_year") {
    const shift = (day) => {
      const date = new Date(parseDay(day));
      date.setUTCFullYear(date.getUTCFullYear() - 1);
      return isoDay(date.getTime());
    };
    return { kind, period: { from: shift(from), to: shift(to) } };
  }
  const days = (parseDay(to) - parseDay(from)) / DAY;
  const previousTo = parseDay(from) - DAY;
  const previousFrom = previousTo - days * DAY;
  return { kind, period: { from: isoDay(previousFrom), to: isoDay(previousTo) } };
}

function summaryBody(from, to, compare, sensitive) {
  const isEmpty = to < DATA_FROM || from > DATA_TO;
  const current = isEmpty ? EMPTY_CURRENT : CURRENT;
  const previous = isEmpty ? EMPTY_PREVIOUS : PREVIOUS;
  const comparison = comparisonOf(compare, from, to);
  // Sem comparação, previous/changePermille/direction ficam nulos (indicator com previous null).
  const compared = (key) =>
    comparison === null ? indicator(current[key], null) : indicator(current[key], previous[key]);

  const indicators = {
    grossRevenue: compared("grossRevenue"),
    deductions: compared("deductions"),
    netRevenue: compared("netRevenue"),
    operatingExpenses: compared("operatingExpenses"),
    result: compared("result"),
    investments: compared("investments"),
    margin: compared("margin"),
    cmvRatio: compared("cmvRatio"),
    averageTicket: compared("averageTicket"),
    breakEven: compared("breakEven"),
  };
  // Só quem vê folha recebe o indicador (RF27.R5): a chave some, não vem nula.
  if (sensitive) indicators.payrollRatio = compared("payrollRatio");

  return {
    period: { from, to },
    comparison,
    isEmpty,
    ticketCoveragePermille: isEmpty ? null : 600,
    indicators,
  };
}

// Seis meses, do mais antigo ao mais recente, terminando no mês de `to`. Receita e despesa por mês;
// o resultado é a diferença.
const MONTHLY = {
  "2026-06": [780000, 690000],
  "2026-07": [820000, 705000],
  "2026-08": [800000, 698000],
  "2026-09": [860000, 720000],
  "2026-10": [900000, 735000],
  "2026-11": [1000000, 735000],
};

function monthlyBody(to) {
  const [y, m] = to.split("-").map(Number);
  const months = [];
  for (let i = 5; i >= 0; i -= 1) {
    const index = y * 12 + (m - 1) - i;
    const month = `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;
    const [revenueCents, expenseCents] = MONTHLY[month] ?? [0, 0];
    months.push({ month, revenueCents, expenseCents, resultCents: revenueCents - expenseCents });
  }
  return { months };
}

// Itens com valor; a parte de cada item é calculada a partir do total (permil, arredondado).
function breakdownBody(by, from, to, sensitive) {
  if (from > DATA_TO || to < DATA_FROM) return { by, totalCents: 0, items: [] };
  const rows = BREAKDOWNS[by](sensitive);
  const totalCents = rows.reduce((sum, row) => sum + row.amountCents, 0);
  const items = rows.map((row) => ({
    ...row,
    sharePermille: Math.round((row.amountCents * 1000) / totalCents),
  }));
  return { by, totalCents, items };
}

const BREAKDOWNS = {
  category: (sensitive) => [
    sensitive
      ? { key: "pessoal", label: "Pessoal", amountCents: 300000 }
      : { key: "restricted", label: "Pessoal (restrito)", amountCents: 300000 },
    { key: "cmv", label: "CMV", amountCents: 250000 },
    { key: "ocupacao", label: "Ocupação", amountCents: 100000 },
    { key: "fees", label: "Taxas e comissões", amountCents: 35000 },
    { key: "utilidades", label: "Utilidades", amountCents: 15000 },
  ],
  sales_channel: () => [
    { key: "salao", label: "Salão", amountCents: 450000 },
    { key: "ifood", label: "iFood", amountCents: 300000 },
    { key: "delivery", label: "Delivery próprio", amountCents: 150000 },
    { key: "none", label: "Não informado", amountCents: 100000 },
  ],
  payment_method: () => [
    { key: "credito", label: "Cartão de crédito", amountCents: 400000 },
    { key: "pix", label: "Pix", amountCents: 350000 },
    { key: "dinheiro", label: "Dinheiro", amountCents: 150000 },
    { key: "none", label: "Não informada", amountCents: 100000 },
  ],
};

const JSON_FORBIDDEN = { status: 403, body: { code: "forbidden" } };

// Roteia /api/reports/* (só GET). Os guards de sessão e de contexto ficam em fake-api.mjs.
export function answerReports(method, url, company) {
  if (!REPORT_ROLES.includes(company.role)) return JSON_FORBIDDEN;
  if (method !== "GET") return { status: 404, body: { error: "not_found" } };
  const { pathname, searchParams } = new URL(url, "http://localhost");
  const from = searchParams.get("from") ?? DEFAULT_FROM;
  const to = searchParams.get("to") ?? DEFAULT_TO;
  const sensitive = SENSITIVE_ROLES.includes(company.role);

  if (pathname === "/api/reports/summary") {
    const compare = searchParams.get("compare") ?? "previous_period";
    return { status: 200, body: summaryBody(from, to, compare, sensitive) };
  }
  if (pathname === "/api/reports/monthly") return { status: 200, body: monthlyBody(to) };
  if (pathname === "/api/reports/breakdown") {
    const by = searchParams.get("by") ?? "category";
    if (!Object.hasOwn(BREAKDOWNS, by)) return { status: 400, body: { code: "invalid_query" } };
    return { status: 200, body: breakdownBody(by, from, to, sensitive) };
  }
  return { status: 404, body: { error: "not_found" } };
}
