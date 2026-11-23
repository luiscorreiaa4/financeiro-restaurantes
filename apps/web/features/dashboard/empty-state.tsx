import { buttonVariants } from "@/components/ui/button";
import { buildWhatsappLink } from "@/features/signup/welcome";

/** Dashboard sem lançamentos no período (RF27.Obs4): diz o que fazer e leva ao WhatsApp. */
export function EmptyState({ whatsappNumber }: { whatsappNumber: string | undefined }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-6">
      <p className="text-base font-medium">Ainda não há lançamentos neste período</p>
      <p className="text-sm text-muted-foreground">
        Mande a primeira venda ou despesa pelo WhatsApp e os números aparecem aqui.
      </p>
      {whatsappNumber !== undefined && whatsappNumber !== "" && (
        <a
          href={buildWhatsappLink(whatsappNumber)}
          target="_blank"
          rel="noreferrer"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          Abrir o WhatsApp
        </a>
      )}
    </div>
  );
}
