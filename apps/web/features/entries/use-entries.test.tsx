import type { EntryListQuery } from "@app/core/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { EntriesApi } from "./entries-api";
import { EntriesProvider, useEntries, useEntryDetail, useEntryTotals } from "./use-entries";

const TENANT = "0193a1b2-0000-7000-8000-0000000000aa";
const UNIT = "0193a1b2-0000-7000-8000-0000000000bb";
const QUERY: EntryListQuery = {
  from: "2026-10-01",
  to: "2026-10-31",
  sort: "created_at",
  dir: "desc",
  limit: 50,
};
const TOTALS = {
  revenueCents: 0,
  expenseCents: 0,
  resultCents: 0,
  count: 0,
  hasRestricted: false,
};

function fakeApi(overrides: Partial<EntriesApi> = {}): EntriesApi {
  const unused = () => Promise.reject(new Error("não usado neste teste"));
  return {
    list: unused,
    totals: unused,
    options: unused,
    detail: unused,
    source: unused,
    ...overrides,
  };
}

function setup(api: EntriesApi) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <EntriesProvider ctx={{ tenantId: TENANT, unitId: UNIT }} api={api}>
        {children}
      </EntriesProvider>
    </QueryClientProvider>
  );
  return { client, wrapper };
}

describe("hooks de lançamentos", () => {
  it("a lista pagina pelo cursor que o servidor devolveu", async () => {
    const list = vi
      .fn<EntriesApi["list"]>()
      .mockResolvedValueOnce({ items: [], nextCursor: "c1" })
      .mockResolvedValueOnce({ items: [], nextCursor: null });
    const { wrapper } = setup(fakeApi({ list }));
    const { result } = renderHook(() => useEntries(QUERY), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(list.mock.calls[0]?.[0].cursor).toBeUndefined();
    expect(result.current.hasNextPage).toBe(true);

    await act(() => result.current.fetchNextPage());
    await waitFor(() => expect(result.current.hasNextPage).toBe(false));
    expect(list.mock.calls[1]?.[0]).toMatchObject({ from: "2026-10-01", cursor: "c1" });
  });

  it("toda chave de query leva empresa e unidade (RNF02.R6)", async () => {
    const { client, wrapper } = setup(
      fakeApi({
        list: () => Promise.resolve({ items: [], nextCursor: null }),
        totals: () => Promise.resolve(TOTALS),
      }),
    );
    const { result } = renderHook(() => ({ a: useEntries(QUERY), b: useEntryTotals(QUERY) }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.b.isSuccess).toBe(true));

    const keys = client
      .getQueryCache()
      .getAll()
      .map((query) => query.queryKey);
    expect(keys).toHaveLength(2);
    for (const key of keys) expect(key.slice(0, 4)).toEqual(["t", TENANT, UNIT, "entries"]);
  });

  it("sem lançamento escolhido, o detalhe não é buscado", () => {
    const detail = vi.fn<EntriesApi["detail"]>();
    const { wrapper } = setup(fakeApi({ detail }));
    renderHook(() => useEntryDetail(null), { wrapper });
    expect(detail).not.toHaveBeenCalled();
  });
});
