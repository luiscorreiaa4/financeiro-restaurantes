"use client";

import { useEffect, useRef } from "react";
import { z } from "zod";
import { browserApi } from "@/lib/api/browser-client";
import type { ApiClient } from "@/lib/api/client";
import { type Me, meSchema } from "@/lib/api/me-contract";

type Nav = { reload(): void; assign(url: string): void; pathname: string };

const noBody = z.undefined();

function windowNav(): Nav {
  return {
    reload: () => window.location.reload(),
    assign: (url) => window.location.assign(url),
    pathname: window.location.pathname,
  };
}

/**
 * Cuida da sessão e do cookie de contexto no navegador (F2):
 * - uma vez por carregamento chama GET /api/me, o que renova o cookie de sessão pelo rewrite;
 * - se o contexto não veio do cookie, grava o cookie com POST /api/context e recarrega;
 * - ao voltar pelo bfcache (`pageshow` persisted), recarrega para não mostrar a empresa anterior.
 * Não renderiza nada.
 */
export function SessionKeeper({ me, api, nav }: { me: Me; api?: ApiClient; nav?: Nav }) {
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const client = api ?? browserApi(() => null);
    const navigation = nav ?? windowNav();

    void (async () => {
      try {
        await client.get("/api/me", meSchema);
      } catch {
        // 401 é tratado pelo cliente global; aqui só não deixamos a promessa solta.
      }
      if (me.contextSource === "cookie") return;
      try {
        await client.post(
          "/api/context",
          { tenantId: me.context.tenantId, unitId: me.context.unitId },
          noBody,
        );
      } catch {
        return;
      }
      if (me.contextSource === "invalid_cookie") {
        navigation.assign(`${navigation.pathname}?aviso=acesso-removido`);
      } else {
        navigation.reload();
      }
    })();
  }, [me, api, nav]);

  useEffect(() => {
    function onPageShow(event: PageTransitionEvent) {
      if (event.persisted) (nav ?? windowNav()).reload();
    }
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [nav]);

  return null;
}
