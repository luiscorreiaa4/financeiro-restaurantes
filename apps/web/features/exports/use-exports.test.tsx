import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { exportFixture, fakeExportsApi, scopeOf } from "./exports-test-helpers";
import { useExports } from "./use-exports";

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("consulta das exportações (RF29.R4)", () => {
  it("com pedido na fila ou gerando, refaz a consulta no intervalo", async () => {
    const list = vi.fn(() => Promise.resolve({ items: [exportFixture({ status: "generating" })] }));
    const scope = scopeOf(fakeExportsApi({ list }));
    renderHook(() => useExports(scope, { poll: true, intervalMs: 25 }), { wrapper });
    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThanOrEqual(3));
  });

  it("sem pedido pendente, a lista não refaz a consulta", async () => {
    const ready = exportFixture({ status: "ready", rowCount: 3, fileSize: 10, available: true });
    const list = vi.fn(() => Promise.resolve({ items: [ready] }));
    const scope = scopeOf(fakeExportsApi({ list }));
    renderHook(() => useExports(scope, { poll: true, intervalMs: 25 }), { wrapper });
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    await wait(200);
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("para de consultar quando o último pendente termina", async () => {
    let status: "queued" | "ready" = "queued";
    const list = vi.fn(() =>
      Promise.resolve({
        items: [
          exportFixture({
            status,
            rowCount: status === "ready" ? 3 : null,
            available: status === "ready",
          }),
        ],
      }),
    );
    const scope = scopeOf(fakeExportsApi({ list }));
    const { result } = renderHook(() => useExports(scope, { poll: true, intervalMs: 25 }), {
      wrapper,
    });
    await waitFor(() => expect(list.mock.calls.length).toBeGreaterThanOrEqual(2));
    status = "ready";
    await waitFor(() => expect(result.current.data?.items[0]?.status).toBe("ready"));
    const calls = list.mock.calls.length;
    await wait(200);
    expect(list.mock.calls.length).toBe(calls);
  });

  it("sem poll nunca repete a consulta, mesmo com pedido pendente", async () => {
    const list = vi.fn(() => Promise.resolve({ items: [exportFixture({ status: "queued" })] }));
    const scope = scopeOf(fakeExportsApi({ list }));
    renderHook(() => useExports(scope, { poll: false, intervalMs: 25 }), { wrapper });
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    await wait(200);
    expect(list).toHaveBeenCalledTimes(1);
  });
});
