import { PageGuard } from "@/components/page-guard";
import { UnitsPage } from "@/features/settings/units/units-page";

// A API repete a checagem; aqui só evitamos mostrar a página a quem não tem a ação.
export default function Page() {
  return <PageGuard action="catalog:view">{(me) => <UnitsPage me={me} />}</PageGuard>;
}
