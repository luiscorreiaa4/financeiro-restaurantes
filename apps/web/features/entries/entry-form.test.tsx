import type { EntryDetail, EntryVersion } from "@app/core/contracts";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import type { EntriesApi } from "./entries-api";
import {
  AUTHOR,
  CATEGORY,
  detailFixture,
  fakeEntriesApi,
  OPTIONS,
  renderWithEntries,
  UNIT,
} from "./entries-test-helpers";
import { EntryForm } from "./entry-form";

const SUPPLIER = "0193a1b2-0000-7000-8000-0000000000ee";

function lastVersion(overrides: Partial<EntryVersion> = {}): EntryVersion {
  return {
    version: 2,
    action: "update",
    channel: "web",
    changedBy: { id: AUTHOR, name: "Bia" },
    changedAt: "2026-11-03T12:30:00.000Z",
    restricted: false,
    changes: [],
    ...overrides,
  };
}

function show(
  entry: EntryDetail = detailFixture(),
  api: Partial<EntriesApi> = {},
  props: { onSaved?: (e: EntryDetail) => void; onReload?: (e: EntryDetail) => void } = {},
) {
  const onSaved = props.onSaved ?? vi.fn();
  const onReload = props.onReload ?? vi.fn();
  renderWithEntries(
    <EntryForm
      entry={entry}
      options={{ ...OPTIONS, suppliers: [{ id: SUPPLIER, name: "Gás & Cia" }] }}
      onSaved={onSaved}
      onReload={onReload}
      onCancel={vi.fn()}
    />,
    fakeEntriesApi(api),
  );
  return { user: userEvent.setup(), onSaved, onReload };
}

describe("formulário de edição do lançamento", () => {
  it("envia só o que mudou, com a versão que o usuário abriu", async () => {
    const update = vi.fn().mockResolvedValue(detailFixture({ version: 2 }));
    const { user, onSaved } = show(detailFixture({ version: 3 }), { update });
    const field = screen.getByLabelText("Descrição");
    await user.clear(field);
    await user.type(field, "Gás novo");
    await user.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(update).toHaveBeenCalledOnce());
    expect(update).toHaveBeenCalledWith(detailFixture().id, {
      expectedVersion: 3,
      patch: { description: "Gás novo" },
      markReviewed: false,
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("o valor digitado em reais vira centavos inteiros no envio", async () => {
    const update = vi.fn().mockResolvedValue(detailFixture());
    const { user } = show(detailFixture(), { update });
    const valor = screen.getByLabelText("Valor bruto");
    expect(valor).toHaveValue("450,00");
    await user.clear(valor);
    await user.type(valor, "1234,56");
    await user.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0]?.[1].patch).toEqual({ amountCents: 123456 });
  });

  it("enviar duas vezes seguidas (duplo clique) grava uma vez só (S10)", async () => {
    let resolve: (value: EntryDetail) => void = () => {};
    const update = vi.fn().mockImplementation(
      () =>
        new Promise<EntryDetail>((done) => {
          resolve = done;
        }),
    );
    const { user } = show(detailFixture(), { update });
    await user.type(screen.getByLabelText("Descrição"), " 2");
    const save = screen.getByRole("button", { name: "Salvar" });
    await user.dblClick(save);
    expect(update).toHaveBeenCalledTimes(1);
    expect(save).toBeDisabled();
    resolve(detailFixture());
  });

  it("sem nenhuma alteração, avisa e não chama a API", async () => {
    const update = vi.fn();
    const { user } = show(detailFixture(), { update });
    await user.click(screen.getByRole("button", { name: "Salvar" }));
    expect(await screen.findByText("Nenhuma alteração para salvar.")).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
  });

  it("conflito de versão mostra quem alterou e a hora, mantém o digitado e recarrega a atual", async () => {
    const current = detailFixture({
      version: 2,
      description: "Outro texto",
      versions: [lastVersion()],
    });
    const update = vi
      .fn()
      .mockRejectedValue(new ApiError("409", 409, { code: "entry_stale", current }));
    const { user, onReload } = show(detailFixture(), { update });
    const field = screen.getByLabelText("Descrição");
    await user.clear(field);
    await user.type(field, "Meu texto");
    await user.click(screen.getByRole("button", { name: "Salvar" }));
    expect(
      await screen.findByText("Este lançamento foi alterado por Bia às 09:30. Recarregar?"),
    ).toBeInTheDocument();
    expect(field).toHaveValue("Meu texto");
    await user.click(screen.getByRole("button", { name: "Recarregar" }));
    expect(onReload).toHaveBeenCalledWith(current);
  });

  it("409 de troca de empresa mostra a mensagem e não perde o que foi digitado", async () => {
    const update = vi.fn().mockRejectedValue(
      new ApiError("A empresa foi trocada em outra aba. Recarregue para continuar.", 409, {
        code: "context_changed",
      }),
    );
    const { user } = show(detailFixture(), { update });
    const field = screen.getByLabelText("Descrição");
    await user.clear(field);
    await user.type(field, "Meu texto");
    await user.click(screen.getByRole("button", { name: "Salvar" }));
    expect(
      await screen.findByText("A empresa foi trocada em outra aba. Recarregue para continuar."),
    ).toBeInTheDocument();
    expect(field).toHaveValue("Meu texto");
  });

  it("422 da API aponta o campo pelo motivo", async () => {
    const update = vi
      .fn()
      .mockRejectedValue(
        new ApiError("422", 422, { code: "invalid_entry", reason: "DateTooFarAhead" }),
      );
    const { user } = show(detailFixture(), { update });
    await user.clear(screen.getByLabelText("Data"));
    await user.type(screen.getByLabelText("Data"), "2027-12-31");
    await user.click(screen.getByRole("button", { name: "Salvar" }));
    const date = screen.getByLabelText("Data");
    expect(
      await screen.findByText("A data pode ser no máximo 60 dias à frente de hoje."),
    ).toBeInTheDocument();
    expect(date).toHaveAttribute("aria-invalid", "true");
  });

  it("marcar como revisado envia só a revisão quando nada mais mudou", async () => {
    const update = vi.fn().mockResolvedValue(detailFixture({ flags: [] }));
    const { user } = show(detailFixture({ flags: ["category_to_review"] }), { update });
    await user.click(screen.getByRole("button", { name: "Marcar como revisado" }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update).toHaveBeenCalledWith(detailFixture().id, {
      expectedVersion: 1,
      patch: {},
      markReviewed: true,
    });
  });

  it("sem sinais não oferece Marcar como revisado", () => {
    show(detailFixture({ flags: [] }));
    expect(screen.queryByRole("button", { name: "Marcar como revisado" })).toBeNull();
  });

  it("canal de venda e pedidos só aparecem em receita", () => {
    show(detailFixture({ type: "expense" }));
    expect(screen.queryByLabelText("Canal de venda")).toBeNull();
    expect(screen.queryByLabelText("Pedidos")).toBeNull();
  });

  it("em receita mostra canal de venda e pedidos e envia os pedidos como número", async () => {
    const update = vi.fn().mockResolvedValue(detailFixture());
    const { user } = show(detailFixture({ type: "revenue" }), { update });
    expect(screen.getByLabelText("Canal de venda")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Pedidos"), "12");
    await user.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0]?.[1].patch).toEqual({ orders: 12 });
  });

  it("categoria que exige quantidade pede quantidade e unidade de medida antes de enviar", async () => {
    const update = vi.fn();
    const other = "0193a1b2-0000-7000-8000-0000000000c2";
    renderWithEntries(
      <EntryForm
        entry={detailFixture()}
        options={{
          ...OPTIONS,
          categories: [
            ...OPTIONS.categories,
            { id: other, name: "Carnes", kind: "expense", parentId: null, requiresQuantity: true },
          ],
        }}
        onSaved={vi.fn()}
        onReload={vi.fn()}
        onCancel={vi.fn()}
      />,
      fakeEntriesApi({ update }),
    );
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Categoria"), other);
    await user.click(screen.getByRole("button", { name: "Salvar" }));
    expect(
      await screen.findByText("Informe a quantidade e a unidade de medida."),
    ).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
  });

  it("fornecedor novo: oferece usar o nome digitado e envia supplier com name", async () => {
    const update = vi.fn().mockResolvedValue(detailFixture());
    const { user } = show(detailFixture(), { update });
    await user.type(screen.getByLabelText("Fornecedor"), "Padaria Nova");
    await user.click(
      screen.getByRole("option", { name: "Usar “Padaria Nova” como novo fornecedor" }),
    );
    await user.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0]?.[1].patch).toEqual({ supplier: { name: "Padaria Nova" } });
  });

  it("fornecedor existente é escolhido da lista e enviado pelo id", async () => {
    const update = vi.fn().mockResolvedValue(detailFixture());
    const { user } = show(detailFixture(), { update });
    await user.type(screen.getByLabelText("Fornecedor"), "gás");
    await user.click(screen.getByRole("option", { name: "Gás & Cia" }));
    await user.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0]?.[1].patch).toEqual({ supplier: { id: SUPPLIER } });
  });

  it("texto com tag aparece como texto, nunca como HTML (RF25.R1)", () => {
    show(detailFixture({ description: "<img src=x onerror=alert(1)>" }));
    expect(screen.getByLabelText("Descrição")).toHaveValue("<img src=x onerror=alert(1)>");
    expect(document.querySelector("img")).toBeNull();
  });

  it("unidade de medida antiga, fora da lista fechada, continua escolhida e não vai no envio (R6)", async () => {
    const update = vi.fn().mockResolvedValue(detailFixture());
    const { user } = show(detailFixture({ quantity: 2, quantityUnit: "kg" }), { update });
    expect(screen.getByLabelText("Unidade de medida")).toHaveValue("kg");
    const field = screen.getByLabelText("Descrição");
    await user.clear(field);
    await user.type(field, "Gás novo");
    await user.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0]?.[1].patch).toEqual({ description: "Gás novo" });
  });

  it("a unidade de medida se escolhe numa lista fechada (RF12.R4)", async () => {
    const update = vi.fn().mockResolvedValue(detailFixture());
    const { user } = show(detailFixture({ quantity: 2, quantityUnit: "KG" }), { update });
    await user.selectOptions(screen.getByLabelText("Unidade de medida"), "CX");
    await user.click(screen.getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0]?.[1].patch).toEqual({ quantityUnit: "CX" });
  });

  it("a unidade e a categoria atuais vêm selecionadas", () => {
    show();
    expect(screen.getByLabelText("Categoria")).toHaveValue(CATEGORY);
    expect(screen.getByLabelText("Unidade")).toHaveValue(UNIT);
  });
});
