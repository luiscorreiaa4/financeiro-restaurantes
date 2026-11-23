import { PageGuard } from "@/components/page-guard";
import { ExportsScreen } from "@/features/exports/exports-screen";

// A API repete a checagem; aqui só evitamos mostrar a página a quem não tem a ação.
export default function Page() {
  return <PageGuard action="export:data">{(me) => <ExportsScreen me={me} />}</PageGuard>;
}
