import type { DashboardSummary, Indicator } from "@app/core/contracts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCents, formatPermille } from "@/lib/format";

type Unit = "money" | "permille";
/** Se subir é bom, ruim ou nem uma coisa nem outra. Mapa fixo por indicador (DD-41): não é conta. */
type Tone = "good_up" | "bad_up" | "neutral";

type CardKey = keyof DashboardSummary["indicators"];
const CARDS: readonly { key: CardKey; label: string; unit: Unit; tone: Tone }[] = [
  { key: "grossRevenue", label: "Receita bruta", unit: "money", tone: "good_up" },
  { key: "deductions", label: "Deduções", unit: "money", tone: "bad_up" },
  { key: "netRevenue", label: "Receita líquida", unit: "money", tone: "good_up" },
  { key: "operatingExpenses", label: "Despesas operacionais", unit: "money", tone: "bad_up" },
  { key: "result", label: "Resultado", unit: "money", tone: "good_up" },
  { key: "margin", label: "Margem", unit: "permille", tone: "good_up" },
  { key: "cmvRatio", label: "CMV sobre a receita", unit: "permille", tone: "bad_up" },
  { key: "payrollRatio", label: "Folha sobre a receita", unit: "permille", tone: "bad_up" },
  { key: "investments", label: "Investimentos", unit: "money", tone: "neutral" },
  { key: "averageTicket", label: "Ticket médio", unit: "money", tone: "neutral" },
  { key: "breakEven", label: "Ponto de equilíbrio", unit: "money", tone: "bad_up" },
];

const COMPARED_WITH = {
  previous_period: "em relação ao período anterior",
  previous_year: "em relação ao mesmo período do ano anterior",
} as const;

const DIRECTION_WORD = { up: "aumento", down: "queda", flat: "sem variação" } as const;
const ARROW = { up: "▲", down: "▼", flat: "–" } as const;

/** Só formata: casas decimais de um valor em décimos (`10` → "1,0"), sem conta de negócio. */
function tenths(abs: number): string {
  return `${Math.trunc(abs / 10)},${abs % 10}`;
}

function formatValue(value: number | null, unit: Unit): string {
  if (value === null) return "—";
  return unit === "money" ? formatCents(value) : formatPermille(value);
}

/** "base: 60% da receita": sem casa decimal quando ela é zero. */
function coverageText(permille: number): string {
  const text = permille % 10 === 0 ? `${permille / 10}` : tenths(permille).replace(".", ",");
  return `base: ${text}% da receita`;
}

function changeText(
  indicator: Indicator,
  unit: Unit,
  comparison: NonNullable<DashboardSummary["comparison"]>,
): string | null {
  const { direction, changePermille } = indicator;
  if (direction === null) return null;
  const to = COMPARED_WITH[comparison.kind];
  if (changePermille === null)
    return `${DIRECTION_WORD[direction]}, sem base para calcular o percentual`;
  if (direction === "flat") return `${DIRECTION_WORD.flat} ${to}`;
  const abs = Math.abs(changePermille);
  const amount =
    unit === "money"
      ? formatPermille(abs)
      : `${tenths(abs)} ${abs < 20 ? "ponto percentual" : "pontos percentuais"}`;
  return `${DIRECTION_WORD[direction]} de ${amount} ${to}`;
}

function toneClass(tone: Tone, direction: Indicator["direction"]): string {
  if (direction === null || direction === "flat" || tone === "neutral") {
    return "text-muted-foreground";
  }
  const good = (tone === "good_up") === (direction === "up");
  return good ? "text-foreground" : "text-destructive";
}

/**
 * Cartões do RF27. Mostra o que o servidor calculou: valor, variação e direção. O cartão de
 * folha só existe se `payrollRatio` veio na resposta (RF27.R5, CA02).
 */
export function IndicatorCards({ summary }: { summary: DashboardSummary }) {
  const { indicators, comparison } = summary;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {CARDS.map(({ key, label, unit, tone }) => {
        const indicator = indicators[key];
        if (indicator === undefined) return null;
        const change = comparison === null ? null : changeText(indicator, unit, comparison);
        return (
          <Card key={key} role="group" aria-label={label} size="sm">
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
            </CardHeader>
            <CardContent className="flex min-w-0 flex-col gap-1">
              <p className="text-2xl font-semibold break-words">
                {formatValue(indicator.value, unit)}
              </p>
              {change !== null && indicator.direction !== null && (
                <p className={`text-xs ${toneClass(tone, indicator.direction)}`}>
                  <span aria-hidden="true">{ARROW[indicator.direction]} </span>
                  {change}
                </p>
              )}
              {key === "averageTicket" &&
                indicator.value !== null &&
                summary.ticketCoveragePermille !== null && (
                  <p className="text-xs text-muted-foreground">
                    {coverageText(summary.ticketCoveragePermille)}
                  </p>
                )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
