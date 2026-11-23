import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import { ExportsView } from "./exports-screen";
import {
  exportFixture,
  exportId,
  fakeExportsApi,
  renderWithQuery,
  scopeOf,
} from "./exports-test-helpers";

const READY = exportFixture({
  id: exportId(1),
  format: "xlsx",
  content: "full",
  status: "ready",
  rowCount: 1234,
  fileSize: 4000,
  finishedAt: "2026-11-23T12:01:00.000Z",
  available: true,
});

function show(items: ReturnType<typeof exportFixture>[], api = fakeExportsApi()) {
  const scope = scopeOf({ ...api, list: () => Promise.resolve({ items }) });
  const navigate = vi.fn();
  const view = renderWithQuery(<ExportsView scope={scope} navigate={navigate} />);
  return { navigate, user: userEvent.setup(), ...view };
}

describe("tela de exportações (RF29)", () => {
  it("lista o pedido com data e hora de São Paulo, formato, conteúdo, período, linhas e situação", async () => {
    show([READY]);
    const table = await screen.findByRole("table");
    const row = within(table).getAllByRole("row")[1] as HTMLElement;
    expect(within(row).getByText("23/11/2026 09:00")).toBeInTheDocument();
    expect(within(row).getByText("XLSX")).toBeInTheDocument();
    expect(within(row).getByText("Completo")).toBeInTheDocument();
    expect(within(row).getByText("01/10/2026 a 31/10/2026")).toBeInTheDocument();
    expect(within(row).getByText("1.234")).toBeInTheDocument();
    expect(within(row).getByText("Pronta")).toBeInTheDocument();
  });

  it("mostra as situações Na fila, Gerando, Falhou e Expirada; só a pronta e disponível tem Baixar", async () => {
    show([
      exportFixture({ id: exportId(1), status: "queued" }),
      exportFixture({ id: exportId(2), status: "generating" }),
      exportFixture({ id: exportId(3), status: "failed", errorCode: "generation_failed" }),
      // Pronta, mas o arquivo expirou (passou de 7 dias): não há como baixar.
      exportFixture({ id: exportId(4), status: "ready", rowCount: 3, available: false }),
      READY,
    ]);
    const table = await screen.findByRole("table");
    for (const label of ["Na fila", "Gerando", "Falhou", "Expirada", "Pronta"]) {
      expect(within(table).getByText(label)).toBeInTheDocument();
    }
    expect(within(table).getAllByRole("button", { name: "Baixar" })).toHaveLength(1);
  });

  it("explica por que falhou, sem mensagem técnica", async () => {
    show([
      exportFixture({ id: exportId(1), status: "failed", errorCode: "too_many_rows" }),
      exportFixture({ id: exportId(2), status: "failed", errorCode: "forbidden" }),
    ]);
    const table = await screen.findByRole("table");
    expect(within(table).getByText(/mais de 100 mil linhas/i)).toBeInTheDocument();
    expect(within(table).getByText(/perdeu a permissão/i)).toBeInTheDocument();
  });

  it("Baixar pede o link e leva o navegador até ele", async () => {
    const link = vi.fn(() =>
      Promise.resolve({
        url: `/api/exports/${exportId(1)}/download?t=abc`,
        expiresAt: "2026-11-23T13:00:00.000Z",
      }),
    );
    const { user, navigate } = show([READY], fakeExportsApi({ link }));
    const table = await screen.findByRole("table");
    await user.click(within(table).getByRole("button", { name: "Baixar" }));
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(`/api/exports/${exportId(1)}/download?t=abc`),
    );
    expect(link).toHaveBeenCalledWith(exportId(1));
  });

  it("se o link expirou (410), avisa e não navega", async () => {
    const link = vi.fn(() =>
      Promise.reject(new ApiError("expirou", 410, { code: "export_expired" })),
    );
    const { user, navigate } = show([READY], fakeExportsApi({ link }));
    const table = await screen.findByRole("table");
    await user.click(within(table).getByRole("button", { name: "Baixar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("O arquivo expirou");
    expect(navigate).not.toHaveBeenCalled();
  });

  it("sem pedidos, explica e leva à lista de lançamentos", async () => {
    show([]);
    expect(
      await screen.findByText(
        "Nenhuma exportação nos últimos 7 dias. Exporte pela lista de Lançamentos.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Lançamentos" })).toHaveAttribute(
      "href",
      "/lancamentos",
    );
  });

  it("erro ao carregar mostra aviso e permite tentar de novo", async () => {
    const list = vi
      .fn()
      .mockRejectedValueOnce(new ApiError("fora do ar", 0))
      .mockResolvedValue({ items: [READY] });
    const user = userEvent.setup();
    renderWithQuery(<ExportsView scope={scopeOf(fakeExportsApi({ list }))} navigate={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível carregar");
    await user.click(screen.getByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByRole("table")).toBeInTheDocument();
  });

  it("no celular os pedidos viram cartões, com a mesma ação", async () => {
    show([READY]);
    await screen.findByRole("table");
    const cards = screen.getByRole("list");
    expect(within(cards).getByText("Pronta")).toBeInTheDocument();
    expect(within(cards).getByRole("button", { name: "Baixar" })).toBeInTheDocument();
  });
});
