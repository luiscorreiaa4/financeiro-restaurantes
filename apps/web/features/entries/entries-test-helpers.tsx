import type { EntryDetail, EntryItem, EntryOptions, EntryTotals } from "@app/core/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import type { EntriesApi } from "./entries-api";
import { EntriesProvider } from "./use-entries";

export const TENANT = "0193a1b2-0000-7000-8000-0000000000aa";
export const UNIT = "0193a1b2-0000-7000-8000-0000000000bb";
export const CATEGORY = "0193a1b2-0000-7000-8000-0000000000cc";
export const AUTHOR = "0193a1b2-0000-7000-8000-0000000000dd";

export function entryId(n: number): string {
  return `0193a1b2-0000-7000-8000-${String(n).padStart(12, "0")}`;
}

export function itemFixture(overrides: Partial<EntryItem> = {}): EntryItem {
  return {
    id: entryId(1),
    version: 1,
    type: "expense",
    occurredOn: "2026-11-03",
    paidOn: "2026-11-03",
    description: "Gás de cozinha",
    quantity: null,
    quantityUnit: null,
    orders: null,
    amountCents: 45000,
    feeCents: 0,
    netCents: 45000,
    category: { id: CATEGORY, name: "Insumos" },
    supplier: null,
    paymentMethod: null,
    salesChannel: null,
    unit: { id: UNIT, name: "Matriz" },
    createdBy: { id: AUTHOR, name: "Ana" },
    originChannel: "whatsapp",
    flags: [],
    createdAt: "2026-11-03T12:00:00.000Z",
    canEdit: true,
    canDelete: true,
    canRestore: false,
    ...overrides,
  };
}

export function detailFixture(overrides: Partial<EntryDetail> = {}): EntryDetail {
  return {
    ...itemFixture(),
    feePercentBp: 0,
    feeFixedCents: 0,
    updatedAt: "2026-11-03T12:00:00.000Z",
    deleted: null,
    versions: [],
    ...overrides,
  };
}

export const EMPTY_TOTALS: EntryTotals = {
  revenueCents: 0,
  expenseCents: 0,
  resultCents: 0,
  count: 0,
  hasRestricted: false,
};

export const OPTIONS: EntryOptions = {
  categories: [
    { id: CATEGORY, name: "Insumos", kind: "expense", parentId: null, requiresQuantity: false },
  ],
  suppliers: [],
  paymentMethods: [],
  salesChannels: [],
  units: [{ id: UNIT, name: "Matriz" }],
  members: [{ id: AUTHOR, name: "Ana" }],
};

/** API de lançamentos para teste: o que não for informado responde vazio. */
export function fakeEntriesApi(overrides: Partial<EntriesApi> = {}): EntriesApi {
  const missing = () => Promise.reject(new Error("rota não preparada neste teste"));
  return {
    list: () => Promise.resolve({ items: [], nextCursor: null }),
    totals: () => Promise.resolve(EMPTY_TOTALS),
    options: () => Promise.resolve(OPTIONS),
    detail: missing,
    source: missing,
    update: missing,
    remove: missing,
    restore: missing,
    batchPreview: missing,
    batchDelete: missing,
    trash: () => Promise.resolve({ items: [], nextCursor: null }),
    ...overrides,
  };
}

export function renderWithEntries(ui: ReactNode, api: EntriesApi = fakeEntriesApi()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = (node: ReactNode) => (
    <QueryClientProvider client={client}>
      <EntriesProvider ctx={{ tenantId: TENANT, unitId: UNIT }} api={api}>
        {node}
      </EntriesProvider>
    </QueryClientProvider>
  );
  const result = render(wrap(ui));
  // `rerender` mantém os provedores, para o teste trocar só a tela (ex.: nova URL).
  return { ...result, rerender: (next: ReactNode) => result.rerender(wrap(next)) };
}
