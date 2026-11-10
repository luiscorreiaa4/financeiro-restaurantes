"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { z } from "zod";
import { Input } from "@/components/ui/input";
import { browserApi } from "@/lib/api/browser-client";
import type { ApiClient } from "@/lib/api/client";
import { contextHeaderOf, type Me } from "@/lib/api/me-contract";
import { tenantKey } from "@/lib/query/keys";

/** Acima disso o seletor de empresa ganha um campo de busca por nome. */
const SEARCH_THRESHOLD = 8;

const unitsSchema = z.object({
  units: z.array(z.object({ id: z.string(), name: z.string() })),
});
const noBody = z.undefined();

const selectClass =
  "h-9 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";

function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * Seletor de empresa e de unidade (RF02.R6). Cada um só aparece havendo mais de uma opção.
 * "Todas as unidades" só para quem tem todas (`allUnits`). Trocar grava o cookie de contexto
 * (POST /api/context) e recarrega a página inteira, o que limpa o cache do router e o do
 * TanStack de uma vez (RF02.CA05).
 */
export function ContextSwitcher({
  me,
  api,
  assign,
}: {
  me: Me;
  api?: ApiClient;
  assign?: (url: string) => void;
}) {
  const ctx = { tenantId: me.context.tenantId, unitId: me.context.unitId };
  const client = useMemo(() => api ?? browserApi(() => contextHeaderOf(me)), [api, me]);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const units = useQuery({
    queryKey: tenantKey(ctx, "units"),
    queryFn: () => client.get("/api/units", unitsSchema),
  });

  // Ao abrir um seletor a lista é refeita: uma aba esquecida descobre aqui (409) que a empresa mudou.
  function refreshUnits() {
    void units.refetch();
  }

  async function choose(tenantId: string, unitId: string) {
    setBusy(true);
    setFailed(false);
    try {
      await client.post("/api/context", { tenantId, unitId }, noBody);
      (assign ?? ((url: string) => window.location.assign(url)))("/");
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  const unitOptions = [
    ...(me.context.allUnits ? [{ id: "all", name: "Todas as unidades" }] : []),
    ...(units.data?.units ?? []),
  ];
  const showCompanies = me.companies.length > 1;
  const showUnits = unitOptions.length > 1;
  if (!showCompanies && !showUnits) return null;

  const query = normalize(search.trim());
  const companies = me.companies.filter(
    (company) =>
      company.tenantId === me.context.tenantId || normalize(company.name).includes(query),
  );

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {showCompanies && (
        <div className="flex min-w-0 flex-col gap-1">
          {me.companies.length > SEARCH_THRESHOLD && (
            <Input
              type="search"
              aria-label="Buscar empresa"
              placeholder="Buscar empresa"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          )}
          <select
            aria-label="Empresa"
            className={selectClass}
            value={me.context.tenantId}
            disabled={busy}
            onFocus={refreshUnits}
            onChange={(event) => {
              const company = me.companies.find((c) => c.tenantId === event.target.value);
              if (company) void choose(company.tenantId, company.startUnitId);
            }}
          >
            {companies.map((company) => (
              <option key={company.tenantId} value={company.tenantId}>
                {company.accountStatus === "canceled"
                  ? `${company.name} (cancelada)`
                  : company.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {showUnits && (
        <select
          aria-label="Unidade"
          className={selectClass}
          value={me.context.unitId}
          disabled={busy}
          onFocus={refreshUnits}
          onChange={(event) => void choose(me.context.tenantId, event.target.value)}
        >
          {unitOptions.map((unit) => (
            <option key={unit.id} value={unit.id}>
              {unit.name}
            </option>
          ))}
        </select>
      )}
      {failed && (
        <p role="alert" className="text-xs text-destructive">
          Não foi possível trocar. Tente de novo.
        </p>
      )}
    </div>
  );
}
