import { PageGuard } from "@/components/page-guard";
import { UnderConstruction } from "@/components/under-construction";

// A API repete a checagem; aqui só evitamos mostrar a página a quem não tem a ação.
export default function Page() {
  return (
    <PageGuard action="export:data">{() => <UnderConstruction title="Exportações" />}</PageGuard>
  );
}
