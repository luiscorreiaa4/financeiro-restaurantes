import { PageGuard } from "@/components/page-guard";
import { MembersPage } from "@/features/settings/members/members-page";
import { parsePublicEnv } from "@/lib/env";

// A API repete a checagem; aqui só evitamos mostrar a página a quem não tem a ação.
export default function Page() {
  // Referência literal: o Next embute a variável pública no build.
  const { NEXT_PUBLIC_WHATSAPP_NUMBER } = parsePublicEnv({
    NEXT_PUBLIC_WHATSAPP_NUMBER: process.env.NEXT_PUBLIC_WHATSAPP_NUMBER,
  });
  return (
    <PageGuard action="user:view">
      {(me) => <MembersPage me={me} whatsappNumber={NEXT_PUBLIC_WHATSAPP_NUMBER} />}
    </PageGuard>
  );
}
