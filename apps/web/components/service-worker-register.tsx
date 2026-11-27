"use client";

import { useEffect } from "react";

/** Registra o service worker que guarda só a tela de aviso offline (DD-44). */
export function ServiceWorkerRegister(): null {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
      // Sem service worker o painel funciona igual; só não há tela de aviso offline.
    });
  }, []);
  return null;
}
