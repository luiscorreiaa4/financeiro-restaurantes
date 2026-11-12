import Link from "next/link";
import type { RestrictedMe } from "@/lib/api/me-contract";
import { SUPPORT_EMAIL } from "@/lib/support";

const REASON_TEXT: Record<RestrictedMe["reason"], string> = {
  owner_no_unit: "Sua empresa não tem unidade ativa.",
  no_membership: "Você não tem acesso ativo a nenhuma empresa.",
};

/** Aviso do modo restrito (A6): motivo, contato de suporte e a saída "Criar outra empresa". */
export function RestrictedNotice({ reason }: { reason: RestrictedMe["reason"] }) {
  return (
    <section className="flex max-w-md flex-col gap-4">
      <h1 className="text-2xl font-semibold">{REASON_TEXT[reason]}</h1>
      <p className="text-sm text-muted-foreground">
        Para voltar a usar o painel, fale com o suporte:{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="underline underline-offset-4">
          {SUPPORT_EMAIL}
        </a>
      </p>
      <Link
        href="/acesso-restrito/nova-empresa"
        className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/80 sm:w-auto"
      >
        Criar outra empresa
      </Link>
    </section>
  );
}
