"use client";

import { accountAllows } from "@app/core";
import { Suspense, useMemo } from "react";
import { exportAccess } from "@/features/exports/export-access";
import { useExportsScope } from "@/features/exports/use-exports";
import { browserApi } from "@/lib/api/browser-client";
import { contextHeaderOf, type FullMe } from "@/lib/api/me-contract";
import { entriesApi } from "./entries-api";
import { EntriesView } from "./entries-view";
import { EntriesProvider } from "./use-entries";

/**
 * Liga a tela de lançamentos à API do navegador e ao contexto ativo (empresa e unidade, que
 * entram em toda chave de query). `today` vem do servidor, já como data de negócio.
 */
export function EntriesScreen({ me, today }: { me: FullMe; today: string }) {
  const api = useMemo(() => entriesApi(browserApi(() => contextHeaderOf(me))), [me]);
  const exportScope = useExportsScope(me);
  const access = exportAccess(me.context.allowedActions);
  return (
    <EntriesProvider ctx={{ tenantId: me.context.tenantId, unitId: me.context.unitId }} api={api}>
      {/* `useSearchParams` exige um limite de Suspense na página. */}
      <Suspense fallback={null}>
        <EntriesView
          today={today}
          role={me.context.role}
          canSeeTrash={me.context.allowedActions.includes("entry:restore")}
          canCreate={
            me.context.allowedActions.includes("entry:create") &&
            accountAllows(me.context.accountStatus, me.context.role).write
          }
          // Exportar é leitura (DD-42): a conta somente leitura também exporta.
          exportScope={access.canExport ? exportScope : undefined}
          canExportFull={access.canFull}
        />
      </Suspense>
    </EntriesProvider>
  );
}
