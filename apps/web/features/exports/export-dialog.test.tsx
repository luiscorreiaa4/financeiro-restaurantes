import { type ExportCreateBody, entryListQuerySchema } from "@app/core/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import { ExportButton } from "./export-dialog";
import { exportFixture, fakeExportsApi, renderWithQuery, scopeOf } from "./exports-test-helpers";

const UNIT = "0193a1b2-0000-7000-8000-00000000000a";

const QUERY = entryListQuerySchema.parse({
  from: "2026-10-01",
  to: "2026-10-31",
  type: "expense",
  unitIds: UNIT,
  sort: "amount",
  dir: "asc",
});

function setup(
  create: (body: ExportCreateBody) => Promise<ReturnType<typeof exportFixture>>,
  props: { canFull?: boolean } = {},
) {
  const createMock = vi.fn(create);
  const api = fakeExportsApi({ create: createMock });
  const view = renderWithQuery(
    <ExportButton scope={scopeOf(api)} query={QUERY} canFull={props.canFull ?? false} />,
  );
  const user = userEvent.setup();
  return { user, createMock, ...view };
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Exportar" }));
  return screen.findByRole("dialog");
}

describe("diálogo de exportação (RF29)", () => {
  it("abre com XLSX marcado e resume o período e os filtros", async () => {
    const { user } = setup(() => Promise.resolve(exportFixture()));
    const dialog = await openDialog(user);
    expect(within(dialog).getByRole("radio", { name: /Excel/ })).toBeChecked();
    expect(within(dialog).getByRole("radio", { name: "CSV" })).not.toBeChecked();
    expect(within(dialog).getByText("Período: 01/10/2026 a 31/10/2026")).toBeInTheDocument();
    // tipo + unidade; a ordenação não conta como filtro.
    expect(within(dialog).getByText("2 filtros aplicados")).toBeInTheDocument();
  });

  it("o conteúdo COMPLETO só aparece com a permissão, com a nota da lixeira e do histórico", async () => {
    const first = setup(() => Promise.resolve(exportFixture()), { canFull: false });
    const dialog = await openDialog(first.user);
    expect(within(dialog).queryByRole("radio", { name: /Completo/ })).not.toBeInTheDocument();
    first.unmount();

    const second = setup(() => Promise.resolve(exportFixture()), { canFull: true });
    const full = await openDialog(second.user);
    expect(within(full).getByRole("radio", { name: /Lançamentos/ })).toBeChecked();
    expect(within(full).getByRole("radio", { name: /Completo/ })).toBeInTheDocument();
    expect(within(full).getByText(/inclui lixeira e histórico/i)).toBeInTheDocument();
  });

  it("envia os filtros da URL, sem ordenação, com a chave da tentativa, e confirma na tela", async () => {
    const { user, createMock } = setup(() => Promise.resolve(exportFixture()));
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole("radio", { name: "CSV" }));
    await user.click(within(dialog).getByRole("button", { name: "Exportar" }));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    const body = createMock.mock.calls[0]?.[0] as ExportCreateBody;
    expect(body.format).toBe("csv");
    expect(body.content).toBe("entries");
    expect(body.filters).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
      type: "expense",
      unitIds: [UNIT],
    });
    expect(body.filters).not.toHaveProperty("sort");
    expect(body.filters).not.toHaveProperty("dir");
    expect(body.clientRequestId).toMatch(/^[0-9a-f-]{36}$/);

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const notice = screen.getByRole("status");
    expect(notice).toHaveTextContent("Exportação na fila. Acompanhe em Exportações");
    expect(within(notice).getByRole("link", { name: "Exportações" })).toHaveAttribute(
      "href",
      "/exportacoes",
    );
  });

  it("um erro de rede reenvia o mesmo clientRequestId; depois do sucesso a chave muda", async () => {
    let calls = 0;
    const { user, createMock } = setup(() => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new ApiError("API indisponível", 0))
        : Promise.resolve(exportFixture());
    });
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "Exportar" }));
    await within(dialog).findByRole("alert");
    await user.click(within(dialog).getByRole("button", { name: "Exportar" }));
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(2));
    const [first, second] = createMock.mock.calls.map((call) => call[0].clientRequestId);
    expect(second).toBe(first);

    // Novo pedido depois do sucesso: outra chave.
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const again = await openDialog(user);
    await user.click(within(again).getByRole("button", { name: "Exportar" }));
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(3));
    expect(createMock.mock.calls[2]?.[0].clientRequestId).not.toBe(first);
  });

  it("mudar o formato depois de um erro é outro pedido: a chave muda", async () => {
    let calls = 0;
    const { user, createMock } = setup(() => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new ApiError("API indisponível", 0))
        : Promise.resolve(exportFixture());
    });
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "Exportar" }));
    await within(dialog).findByRole("alert");
    await user.click(within(dialog).getByRole("radio", { name: "CSV" }));
    await user.click(within(dialog).getByRole("button", { name: "Exportar" }));
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(2));
    expect(createMock.mock.calls[1]?.[0].clientRequestId).not.toBe(
      createMock.mock.calls[0]?.[0].clientRequestId,
    );
  });

  it("o 429 mostra o limite de pedidos em andamento e mantém o diálogo aberto", async () => {
    const { user } = setup(() =>
      Promise.reject(new ApiError("limite", 429, { code: "too_many_pending" })),
    );
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "Exportar" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Você já tem 3 exportações em andamento",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("o 503 (fila fora do ar) queima a chave: o próximo envio usa outra", async () => {
    let calls = 0;
    const { user, createMock } = setup(() => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new ApiError("fila", 503, { code: "queue_unavailable" }))
        : Promise.resolve(exportFixture());
    });
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "Exportar" }));
    await within(dialog).findByRole("alert");
    await user.click(within(dialog).getByRole("button", { name: "Exportar" }));
    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(2));
    expect(createMock.mock.calls[1]?.[0].clientRequestId).not.toBe(
      createMock.mock.calls[0]?.[0].clientRequestId,
    );
  });

  it("o 403 mostra que falta permissão", async () => {
    const { user } = setup(() =>
      Promise.reject(new ApiError("proibido", 403, { code: "forbidden" })),
    );
    const dialog = await openDialog(user);
    await user.click(within(dialog).getByRole("button", { name: "Exportar" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Você não tem permissão para exportar",
    );
  });

  it("dois cliques no mesmo instante enviam um pedido só", async () => {
    let release: (item: ReturnType<typeof exportFixture>) => void = () => undefined;
    const { user, createMock } = setup(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const dialog = await openDialog(user);
    const send = within(dialog).getByRole("button", { name: "Exportar" });
    await user.dblClick(send);
    expect(createMock).toHaveBeenCalledTimes(1);
    release(exportFixture());
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
