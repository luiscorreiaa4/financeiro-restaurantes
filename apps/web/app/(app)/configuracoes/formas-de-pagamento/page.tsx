import { PageGuard } from "@/components/page-guard";
import { PaymentMethodsPage } from "@/features/settings/settings-pages";

// A API repete a checagem; aqui só evitamos mostrar a página a quem não tem a ação.
export default function Page() {
  return <PageGuard action="catalog:view">{(me) => <PaymentMethodsPage me={me} />}</PageGuard>;
}
