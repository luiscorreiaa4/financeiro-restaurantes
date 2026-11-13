import { Suspense } from "react";
import { RestrictedNotice } from "@/components/restricted-notice";
import { requireRestrictedSession } from "@/lib/auth/session";

export const metadata = { title: "Acesso restrito | Finanças para restaurantes" };

async function Notice() {
  const me = await requireRestrictedSession();
  return <RestrictedNotice reason={me.reason} />;
}

export default function RestrictedPage() {
  return (
    <Suspense fallback={null}>
      <Notice />
    </Suspense>
  );
}
