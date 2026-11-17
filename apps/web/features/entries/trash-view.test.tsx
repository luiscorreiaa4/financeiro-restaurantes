import type { TrashItem } from "@app/core/contracts";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import type { EntriesApi } from "./entries-api";
import {
  AUTHOR,
  entryId,
  fakeEntriesApi,
  itemFixture,
  renderWithEntries,
} from "./entries-test-helpers";
import { TrashView } from "./trash-view";

const nav = vi.hoisted(() => ({ search: "", push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push }),
  usePathname: () => "/lancamentos/lixeira",
  useSearchParams: () => new URLSearchParams(nav.search),
}));

const TODAY = "2026-11-16";

function trashed(overrides: Partial<TrashItem> = {}): TrashItem {
  return {
    ...itemFixture({ id: entryId(7), description: "Gás duplicado", canRestore: true }),
    deleted: {
      at: "2026-11-10T15:30:00.000Z",
      by: { id: AUTHOR, name: "Carla" },
      reason: "lançado duas vezes",
      restorableUntil: "2026-12-10",
    },
    ...overrides,
  };
}

function show(items: TrashItem[], api: Partial<EntriesApi> = {}) {
  renderWithEntries(
    <TrashView today={TODAY} />,
    fakeEntriesApi({ trash: () => Promise.resolve({ items, nextCursor: null }), ...api }),
  );
  return userEvent.setup();
}

beforeEach(() => {
  nav.search = "";
  nav.push.mockReset();
});

describe("lixeira de lançamentos (RF24)", () => {
  it("mostra quem excluiu, o motivo e até quando dá para restaurar", async () => {
    show([trashed()]);
    const table = await screen.findByRole("table");
    const row = within(table).getByRole("row", { name: /Gás duplicado/ });
    expect(row).toHaveTextContent("Carla");
    expect(row).toHaveTextContent("lançado duas vezes");
    expect(row).toHaveTextContent("10/12/2026");
  });

  it("o período padrão vai do início do mês anterior até hoje", async () => {
    const trash = vi.fn().mockResolvedValue({ items: [], nextCursor: null });
    show([], { trash });
    await waitFor(() => expect(trash).toHaveBeenCalled());
    expect(trash.mock.calls[0]?.[0]).toMatchObject({
      deletedFrom: "2026-10-01",
      deletedTo: "2026-11-16",
    });
  });

  it("Restaurar chama a API e a lista é buscada de novo", async () => {
    const restore = vi.fn().mockResolvedValue(itemFixture());
    const trash = vi.fn().mockResolvedValue({ items: [trashed()], nextCursor: null });
    const user = show([], { restore, trash });
    const table = await screen.findByRole("table");
    await user.click(within(table).getByRole("button", { name: "Restaurar" }));
    await waitFor(() => expect(restore).toHaveBeenCalledWith(entryId(7)));
    await waitFor(() => expect(trash.mock.calls.length).toBeGreaterThan(1));
  });

  it("sem permissão de restaurar o item (canRestore falso) não há botão", async () => {
    show([trashed({ canRestore: false })]);
    const table = await screen.findByRole("table");
    expect(within(table).queryByRole("button", { name: "Restaurar" })).toBeNull();
  });

  it("falha ao restaurar mostra aviso", async () => {
    const restore = vi.fn().mockRejectedValue(new ApiError("404", 404, { code: "not_found" }));
    const user = show([trashed()], { restore });
    const table = await screen.findByRole("table");
    await user.click(within(table).getByRole("button", { name: "Restaurar" }));
    expect(
      await screen.findByText("Não foi possível restaurar. O prazo pode ter vencido."),
    ).toBeInTheDocument();
  });

  it("lixeira vazia diz que não há nada no período", async () => {
    show([]);
    expect(
      await screen.findByText("Nenhum lançamento excluído neste período."),
    ).toBeInTheDocument();
  });

  it("mudar o período leva as datas para a URL", async () => {
    show([]);
    const from = await screen.findByLabelText("Excluídos de");
    fireEvent.change(from, { target: { value: "2026-11-01" } });
    expect(nav.push).toHaveBeenLastCalledWith(
      "/lancamentos/lixeira?deletedFrom=2026-11-01&deletedTo=2026-11-16",
    );
  });

  it('exclusão da gestão, vista pelo lançador, sai sem nome: "Excluído pela gestão" (DD-39)', async () => {
    show([
      trashed({
        deleted: {
          at: "2026-11-10T15:30:00.000Z",
          by: null,
          reason: "lançado duas vezes",
          restorableUntil: "2026-12-10",
        },
      }),
    ]);
    const table = await screen.findByRole("table");
    const row = within(table).getByRole("row", { name: /Gás duplicado/ });
    expect(row).toHaveTextContent("Gestão");
    expect(row).toHaveTextContent("lançado duas vezes");
  });

  it("o período da URL vale; inválido volta ao padrão", async () => {
    nav.search = "deletedFrom=2026-11-10&deletedTo=2026-11-12";
    const trash = vi.fn().mockResolvedValue({ items: [], nextCursor: null });
    show([], { trash });
    await waitFor(() => expect(trash).toHaveBeenCalled());
    expect(trash.mock.calls[0]?.[0]).toMatchObject({
      deletedFrom: "2026-11-10",
      deletedTo: "2026-11-12",
    });
  });

  it("motivo com HTML aparece como texto (RF25.R1)", async () => {
    show([
      trashed({
        deleted: {
          at: "2026-11-10T15:30:00.000Z",
          by: { id: AUTHOR, name: "Carla" },
          reason: "<script>alert(1)</script>",
          restorableUntil: "2026-12-10",
        },
      }),
    ]);
    expect(await screen.findAllByText("<script>alert(1)</script>")).not.toHaveLength(0);
    expect(document.querySelector("script")).toBeNull();
  });

  it('erro de carga mostra "Tentar de novo"', async () => {
    const trash = vi
      .fn()
      .mockRejectedValueOnce(new ApiError("500", 500))
      .mockResolvedValue({ items: [trashed()], nextCursor: null });
    const user = show([], { trash });
    await user.click(await screen.findByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });
});
