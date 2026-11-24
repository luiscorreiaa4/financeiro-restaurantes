import { PageGuard } from "@/components/page-guard";
import { OnboardingPage } from "@/features/settings/onboarding/onboarding-page";

// A API repete a checagem; aqui só evitamos mostrar a página a quem não tem a ação.
export default function Page() {
  return <PageGuard action="catalog:manage">{(me) => <OnboardingPage me={me} />}</PageGuard>;
}
