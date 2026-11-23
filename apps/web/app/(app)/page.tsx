import { redirect } from "next/navigation";
import { Suspense } from "react";
import { requireCurrentSession } from "@/lib/auth/session";

async function Home() {
  const me = await requireCurrentSession();
  // Quem vê relatórios começa no dashboard; os demais (lançador) na própria lista (RF27.Obs5).
  return redirect(
    me.context.allowedActions.includes("report:view") ? "/dashboard" : "/lancamentos",
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Home />
    </Suspense>
  );
}
