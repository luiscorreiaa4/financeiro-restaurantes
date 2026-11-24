import { Badge } from "@/components/ui/badge";

/** Situação do cadastro, e o selo "do sistema" dos cadastros protegidos. */
export function StatusBadge({
  status,
  system,
}: {
  status: "active" | "inactive";
  system?: boolean;
}) {
  return (
    <span className="flex flex-wrap items-center gap-1">
      <Badge variant={status === "active" ? "secondary" : "outline"}>
        {status === "active" ? "Ativa" : "Inativa"}
      </Badge>
      {system && <Badge variant="outline">do sistema</Badge>}
    </span>
  );
}
