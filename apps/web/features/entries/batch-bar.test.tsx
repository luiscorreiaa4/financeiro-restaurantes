import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import { BatchBar } from "./batch-bar";
import { entryId, fakeEntriesApi, renderWithEntries } from "./entries-test-helpers";

const IDS = [entryId(1), entryId(2)];

function show(api = {}, onDone = vi.fn()) {
  renderWithEntries(<BatchBar ids={IDS} onDone={onDone} />, fakeEntriesApi(api));
  return { user: userEvent.setup(), onDone };
}

describe("barra de exclusão em lote (RF24.Obs3)", () => {
  it("mostra quantos estão selecionados", () => {
    show();
    expect(screen.getByText("2 selecionados")).toBeInTheDocument();
  });

  it("a confirmação mostra a quantidade e a soma que vieram do servidor", async () => {
    // O servidor devolve 99900 mesmo; a tela não soma nada.
    const batchPreview = vi.fn().mockResolvedValue({ count: 2, totalCents: 99900 });
    const { user } = show({ batchPreview });
    await user.click(screen.getByRole("button", { name: "Excluir selecionados" }));
    expect(batchPreview).toHaveBeenCalledWith(IDS);
    expect(await screen.findByText(/2 lançamentos/)).toHaveTextContent("R$ 999,00");
  });

  it("confirmar exclui com o motivo, avisa que terminou e a seleção some", async () => {
    const batchPreview = vi.fn().mockResolvedValue({ count: 2, totalCents: 99900 });
    const batchDelete = vi.fn().mockResolvedValue({ count: 2, totalCents: 99900 });
    const { user, onDone } = show({ batchPreview, batchDelete });
    await user.click(screen.getByRole("button", { name: "Excluir selecionados" }));
    await user.type(await screen.findByLabelText("Motivo (opcional)"), "duplicados");
    await user.click(screen.getByRole("button", { name: "Excluir" }));
    await waitFor(() => expect(batchDelete).toHaveBeenCalledWith(IDS, "duplicados"));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("404 do servidor (algum id mudou) mostra aviso e não limpa a seleção", async () => {
    const batchPreview = vi.fn().mockResolvedValue({ count: 2, totalCents: 99900 });
    const batchDelete = vi.fn().mockRejectedValue(new ApiError("404", 404, { code: "not_found" }));
    const { user, onDone } = show({ batchPreview, batchDelete });
    await user.click(screen.getByRole("button", { name: "Excluir selecionados" }));
    await user.click(await screen.findByRole("button", { name: "Excluir" }));
    expect(
      await screen.findByText(
        "Algum lançamento selecionado mudou ou não pode ser excluído. Atualize a lista e tente de novo.",
      ),
    ).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('"Limpar seleção" avisa a tela', async () => {
    const onClear = vi.fn();
    renderWithEntries(<BatchBar ids={IDS} onDone={vi.fn()} onClear={onClear} />);
    await userEvent.click(screen.getByRole("button", { name: "Limpar seleção" }));
    expect(onClear).toHaveBeenCalled();
  });
});
