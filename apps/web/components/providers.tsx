"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useEffect } from "react";
import { ServiceWorkerRegister } from "@/components/service-worker-register";
import { listenForInstallPrompt } from "@/lib/install-prompt";
import { getQueryClient } from "@/lib/query/get-query-client";

export function Providers({ children }: { children: ReactNode }) {
  // O evento de instalação pode vir ainda no /login: o ouvinte fica na raiz (DD-44).
  useEffect(() => listenForInstallPrompt(window), []);
  return (
    <QueryClientProvider client={getQueryClient()}>
      <ServiceWorkerRegister />
      {children}
    </QueryClientProvider>
  );
}
