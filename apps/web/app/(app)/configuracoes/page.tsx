import { RequireAction } from "@/components/require-action";
import { UnderConstruction } from "@/components/under-construction";
import { requireCurrentSession } from "@/lib/auth/session";

// A API repete a checagem; aqui só evitamos mostrar a página a quem não tem a ação.
export default async function Page() {
  const me = await requireCurrentSession();
  return (
    <RequireAction me={me} action="catalog:view">
      <UnderConstruction title="Configurações" />
    </RequireAction>
  );
}
