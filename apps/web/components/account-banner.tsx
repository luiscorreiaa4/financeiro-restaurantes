import type { FullMe } from "@/lib/api/me-contract";

type Context = FullMe["context"];

/**
 * Faixa da situação da conta (RF37.R3, R6). Só informa: a API é quem bloqueia a escrita.
 * `canceled` só chega ao dono (os outros papéis não veem a empresa).
 */
export function AccountBanner({
  status,
  userRole,
}: {
  status: Context["accountStatus"];
  userRole: Context["role"];
}) {
  if (status === "read_only") {
    return (
      <p role="status" className="border-b bg-muted px-4 py-2 text-sm">
        Conta em modo somente leitura. Você pode consultar os dados, mas não alterá-los.
      </p>
    );
  }
  if (status === "canceled" && userRole === "owner") {
    return (
      <p role="status" className="border-b bg-muted px-4 py-2 text-sm">
        Conta cancelada. Você ainda pode consultar e exportar os dados por 90 dias.
      </p>
    );
  }
  return null;
}
