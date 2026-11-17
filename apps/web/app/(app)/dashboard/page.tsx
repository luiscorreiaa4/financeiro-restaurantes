import { PageGuard } from "@/components/page-guard";
import { DashboardScreen } from "@/features/dashboard/dashboard-screen";
import { parsePublicEnv } from "@/lib/env";
import { todayBusinessDate } from "@/lib/format";

export const metadata = { title: "Dashboard | Finanças para restaurantes" };

// A API repete a checagem; aqui só evitamos mostrar a página a quem não tem a ação.
export default function Page() {
  // Referência literal: o Next embute a variável pública no build.
  const { NEXT_PUBLIC_WHATSAPP_NUMBER } = parsePublicEnv({
    NEXT_PUBLIC_WHATSAPP_NUMBER: process.env.NEXT_PUBLIC_WHATSAPP_NUMBER,
  });
  return (
    <PageGuard action="report:view">
      {(me) => (
        <DashboardScreen
          me={me}
          today={todayBusinessDate()}
          whatsappNumber={NEXT_PUBLIC_WHATSAPP_NUMBER}
        />
      )}
    </PageGuard>
  );
}
