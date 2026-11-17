"use client";

import { Suspense, useMemo } from "react";
import { browserApi } from "@/lib/api/browser-client";
import { contextHeaderOf, type FullMe } from "@/lib/api/me-contract";
import { entriesApi } from "./entries-api";
import { TrashView } from "./trash-view";
import { EntriesProvider } from "./use-entries";

/** Liga a lixeira à API do navegador e ao contexto ativo (mesmo arranjo da lista). */
export function TrashScreen({ me, today }: { me: FullMe; today: string }) {
  const api = useMemo(() => entriesApi(browserApi(() => contextHeaderOf(me))), [me]);
  return (
    <EntriesProvider ctx={{ tenantId: me.context.tenantId, unitId: me.context.unitId }} api={api}>
      {/* `useSearchParams` exige um limite de Suspense na página. */}
      <Suspense fallback={null}>
        <TrashView today={today} />
      </Suspense>
    </EntriesProvider>
  );
}
