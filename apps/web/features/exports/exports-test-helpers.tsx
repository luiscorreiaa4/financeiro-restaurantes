import type { ExportItem } from "@app/core/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import type { ExportsApi } from "./exports-api";
import type { ExportsScope } from "./use-exports";

export const TENANT = "0193a1b2-0000-7000-8000-0000000000aa";
export const UNIT = "all";

export function exportId(n: number): string {
  return `0193a1b2-0000-7000-8000-${String(n).padStart(12, "0")}`;
}

export function exportFixture(overrides: Partial<ExportItem> = {}): ExportItem {
  return {
    id: exportId(1),
    format: "csv",
    content: "entries",
    status: "queued",
    rowCount: null,
    fileSize: null,
    errorCode: null,
    filters: { from: "2026-10-01", to: "2026-10-31" },
    createdAt: "2026-11-23T12:00:00.000Z",
    finishedAt: null,
    available: false,
    ...overrides,
  };
}

/** API de exportações para teste: o que não for informado responde vazio ou recusa. */
export function fakeExportsApi(overrides: Partial<ExportsApi> = {}): ExportsApi {
  return {
    list: () => Promise.resolve({ items: [] }),
    create: () => Promise.reject(new Error("rota não preparada neste teste")),
    link: () => Promise.reject(new Error("rota não preparada neste teste")),
    ...overrides,
  };
}

export function scopeOf(api: ExportsApi): ExportsScope {
  return { ctx: { tenantId: TENANT, unitId: UNIT }, api };
}

export function renderWithQuery(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = (node: ReactNode) => (
    <QueryClientProvider client={client}>{node}</QueryClientProvider>
  );
  const result = render(wrap(ui));
  return { ...result, client, rerender: (next: ReactNode) => result.rerender(wrap(next)) };
}
