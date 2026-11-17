import type { EntryTotals } from "@app/core/contracts";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCents } from "@/lib/format";

export const RESTRICTED_NOTICE = "Há valores restritos que não entram nestes totais.";

function Total({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="truncate text-base font-semibold tabular-nums">{formatCents(cents)}</dd>
    </div>
  );
}

/**
 * Totais do filtro, exatamente como o servidor calculou (RF22.Obs2): a tela não soma nem
 * subtrai. O resultado também vem pronto.
 */
export function TotalsBar({
  totals,
  failed,
}: {
  totals: EntryTotals | undefined;
  failed: boolean;
}) {
  return (
    <section aria-label="Totais do filtro" className="rounded-lg border p-3">
      {totals ? (
        <>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Total label="Receitas" cents={totals.revenueCents} />
            <Total label="Despesas" cents={totals.expenseCents} />
            <Total label="Resultado" cents={totals.resultCents} />
            <div className="flex flex-col">
              <dt className="text-xs text-muted-foreground">Quantidade</dt>
              <dd className="text-base font-semibold tabular-nums">
                {totals.count} {totals.count === 1 ? "lançamento" : "lançamentos"}
              </dd>
            </div>
          </dl>
          {totals.hasRestricted && (
            <p className="mt-2 text-sm text-muted-foreground">{RESTRICTED_NOTICE}</p>
          )}
        </>
      ) : failed ? (
        <p className="text-sm text-muted-foreground">Não foi possível carregar os totais.</p>
      ) : (
        <Skeleton className="h-10 w-full" />
      )}
    </section>
  );
}
