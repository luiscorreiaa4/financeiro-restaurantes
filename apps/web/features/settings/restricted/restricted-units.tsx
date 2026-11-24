"use client";

import {
  type RestrictedUnits as RestrictedUnitsData,
  restrictedUnitsSchema,
} from "@app/core/contracts";
import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { browserApi } from "@/lib/api/browser-client";

export type RestrictedUnitsApi = {
  list(): Promise<RestrictedUnitsData>;
  reactivate(id: string): Promise<void>;
};

const anyBody = z.object({}).passthrough();

/** `/api/restricted/*` aceita a sessão restrita e não leva `X-Context` (não há empresa ativa). */
export function restrictedUnitsApi(): RestrictedUnitsApi {
  const client = browserApi(() => null);
  return {
    list: () => client.get("/api/restricted/units", restrictedUnitsSchema),
    reactivate: async (id) => {
      await client.post(`/api/restricted/units/${encodeURIComponent(id)}/reactivate`, {}, anyBody);
    },
  };
}

/**
 * Unidades inativas das empresas em que a pessoa é dona e que ficaram sem unidade ativa (F2-2).
 * "Reativar" devolve o dono ao painel. A API decide quem é elegível; a tela só mostra a lista.
 */
export function RestrictedUnits({
  api,
  navigate = (url) => window.location.assign(url),
}: {
  api?: RestrictedUnitsApi;
  navigate?: (url: string) => void;
}) {
  const client = useMemo(() => api ?? restrictedUnitsApi(), [api]);
  const [units, setUnits] = useState<RestrictedUnitsData["units"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sending = useRef(false);

  useEffect(() => {
    let active = true;
    client.list().then(
      (data) => active && setUnits(data.units),
      () => active && setUnits([]),
    );
    return () => {
      active = false;
    };
  }, [client]);

  async function reactivate(id: string) {
    if (sending.current) return;
    sending.current = true;
    setError(null);
    try {
      await client.reactivate(id);
      navigate("/");
    } catch {
      setError("Não foi possível reativar a unidade. Fale com o suporte se continuar.");
    } finally {
      sending.current = false;
    }
  }

  if (units === null || units.length === 0) return null;
  return (
    <section className="flex max-w-md flex-col gap-3">
      <h2 className="text-lg font-semibold">Reativar uma unidade</h2>
      <ul className="flex flex-col gap-2">
        {units.map((unit) => (
          <li
            key={unit.id}
            className="flex items-center justify-between gap-2 rounded-lg border p-3"
          >
            <span className="text-sm">
              {unit.name} <span className="text-muted-foreground">({unit.tenantName})</span>
            </span>
            <Button
              size="sm"
              aria-label={`Reativar ${unit.name}`}
              onClick={() => reactivate(unit.id)}
            >
              Reativar
            </Button>
          </li>
        ))}
      </ul>
      {error !== null && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
