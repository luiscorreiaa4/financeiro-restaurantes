import type { QueryClient } from "@tanstack/react-query";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { tenantKey } from "@/lib/query/keys";
import { ExportNotice } from "./export-notifier";
import {
  exportFixture,
  exportId,
  fakeExportsApi,
  renderWithQuery,
  scopeOf,
} from "./exports-test-helpers";

const READY = exportFixture({
  status: "ready",
  rowCount: 3,
  fileSize: 100,
  finishedAt: "2026-11-23T12:01:00.000Z",
  available: true,
});

/** Lista que devolve o que o teste mandar, para simular o worker terminando o pedido. */
function controllable(initial: ReturnType<typeof exportFixture>[]) {
  let items = initial;
  const list = vi.fn(() => Promise.resolve({ items }));
  return {
    list,
    set(next: ReturnType<typeof exportFixture>[]) {
      items = next;
    },
  };
}

/** Espera o primeiro dado entrar no cache e o efeito do aviso lê-lo (o aviso é da transição). */
async function firstReading(client: QueryClient, scope: ReturnType<typeof scopeOf>) {
  await waitFor(() => expect(client.getQueryData(tenantKey(scope.ctx, "exports"))).toBeDefined());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

describe("aviso de exportação pronta (RF29.R4)", () => {
  it("o pedido que estava pendente e ficou pronto mostra a faixa com Baixar", async () => {
    const source = controllable([exportFixture({ status: "generating" })]);
    const scope = scopeOf(fakeExportsApi({ list: source.list }));
    const { client } = renderWithQuery(<ExportNotice scope={scope} navigate={vi.fn()} />);
    await firstReading(client, scope);
    expect(screen.queryByRole("status")).toBeNull();

    source.set([READY]);
    await client.invalidateQueries({ queryKey: tenantKey(scope.ctx, "exports") });

    const banner = await screen.findByRole("status");
    expect(banner).toHaveTextContent("Sua exportação está pronta.");
    expect(within(banner).getByRole("button", { name: "Baixar" })).toBeInTheDocument();
  });

  it("carregar a página com algo já pronto não mostra a faixa", async () => {
    const source = controllable([READY]);
    const scope = scopeOf(fakeExportsApi({ list: source.list }));
    renderWithQuery(<ExportNotice scope={scope} navigate={vi.fn()} />);
    await waitFor(() => expect(source.list).toHaveBeenCalledTimes(1));
    // Dá tempo de o efeito do dado carregado rodar.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("o pedido que falhou mostra a faixa com o link para Exportações", async () => {
    const source = controllable([exportFixture({ status: "queued" })]);
    const scope = scopeOf(fakeExportsApi({ list: source.list }));
    const { client } = renderWithQuery(<ExportNotice scope={scope} navigate={vi.fn()} />);
    await firstReading(client, scope);

    source.set([exportFixture({ status: "failed", errorCode: "generation_failed" })]);
    await client.invalidateQueries({ queryKey: tenantKey(scope.ctx, "exports") });

    const banner = await screen.findByRole("status");
    expect(banner).toHaveTextContent("A exportação falhou.");
    expect(within(banner).getByRole("link", { name: "Ver exportações" })).toHaveAttribute(
      "href",
      "/exportacoes",
    );
  });

  it("Fechar tira a faixa; a mesma exportação não volta a ser anunciada", async () => {
    const source = controllable([exportFixture({ status: "generating" })]);
    const scope = scopeOf(fakeExportsApi({ list: source.list }));
    const user = userEvent.setup();
    const { client } = renderWithQuery(<ExportNotice scope={scope} navigate={vi.fn()} />);
    await firstReading(client, scope);
    source.set([READY]);
    await client.invalidateQueries({ queryKey: tenantKey(scope.ctx, "exports") });
    const banner = await screen.findByRole("status");
    await user.click(within(banner).getByRole("button", { name: "Fechar" }));
    expect(screen.queryByRole("status")).toBeNull();

    await client.invalidateQueries({ queryKey: tenantKey(scope.ctx, "exports") });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("Baixar na faixa pede o link e navega; depois a faixa some", async () => {
    const source = controllable([exportFixture({ id: exportId(7), status: "queued" })]);
    const link = vi.fn(() =>
      Promise.resolve({
        url: `/api/exports/${exportId(7)}/download?t=zzz`,
        expiresAt: "2026-11-23T13:00:00.000Z",
      }),
    );
    const navigate = vi.fn();
    const scope = scopeOf(fakeExportsApi({ list: source.list, link }));
    const user = userEvent.setup();
    const { client } = renderWithQuery(<ExportNotice scope={scope} navigate={navigate} />);
    await firstReading(client, scope);
    source.set([{ ...READY, id: exportId(7) }]);
    await client.invalidateQueries({ queryKey: tenantKey(scope.ctx, "exports") });
    const banner = await screen.findByRole("status");
    await user.click(within(banner).getByRole("button", { name: "Baixar" }));
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(`/api/exports/${exportId(7)}/download?t=zzz`),
    );
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });
});
