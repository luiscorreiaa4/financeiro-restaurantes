import type { EntryDetail, EntryOptions } from "@app/core/contracts";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import type { EntriesApi } from "./entries-api";
import {
  CATEGORY,
  detailFixture,
  fakeEntriesApi,
  OPTIONS,
  renderWithEntries,
  UNIT,
} from "./entries-test-helpers";
import { EntryCreateForm } from "./entry-create-form";

const REVENUE_CATEGORY = "0193a1b2-0000-7000-8000-0000000000c1";
const QUANTITY_CATEGORY = "0193a1b2-0000-7000-8000-0000000000c5";
const CHANNEL = "0193a1b2-0000-7000-8000-0000000000c2";
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const FORM_OPTIONS: EntryOptions = {
  ...OPTIONS,
  categories: [
    { id: CATEGORY, name: "Insumos", kind: "expense", parentId: null, requiresQuantity: false },
    {
      id: QUANTITY_CATEGORY,
      name: "Hortifruti",
      kind: "expense",
      parentId: null,
      requiresQuantity: true,
    },
    {
      id: REVENUE_CATEGORY,
      name: "Vendas",
      kind: "revenue",
      parentId: null,
      requiresQuantity: false,
    },
  ],
  salesChannels: [{ id: CHANNEL, name: "Salão", active: true }],
  units: [
    {
      id: UNIT,
      name: "Matriz",
      active: true,
      defaultSalesChannelId: CHANNEL,
      timezone: "America/Sao_Paulo",
    },
  ],
};

function show(api: Partial<EntriesApi> = {}, onSaved: (e: EntryDetail) => void = vi.fn()) {
  renderWithEntries(
    <EntryCreateForm options={FORM_OPTIONS} today="2026-11-16" unitId={UNIT} onSaved={onSaved} />,
    fakeEntriesApi(api),
  );
  return { user: userEvent.setup(), onSaved };
}

async function fill(user: ReturnType<typeof userEvent.setup>, amount = "450,00") {
  await user.type(screen.getByLabelText("Valor"), amount);
  await user.type(screen.getByLabelText("Descrição"), "Gás de cozinha");
  await user.selectOptions(screen.getByLabelText("Categoria"), "Insumos");
}

const save = () => screen.getByRole("button", { name: "Salvar" });
const saveAndNext = () => screen.getByRole("button", { name: "Salvar e lançar outro" });

describe("formulário de lançamento manual (RF26)", () => {
  it("sem valor, a gravação é bloqueada com a mensagem no campo e nada é enviado (CA01)", async () => {
    const create = vi.fn();
    const { user } = show({ create });
    await user.type(screen.getByLabelText("Descrição"), "Gás");
    await user.click(save());
    expect(await screen.findByText("Informe o valor.")).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it("envia centavos inteiros, a unidade do seletor e uma chave de tentativa, e avisa quem chamou", async () => {
    const created = detailFixture({ id: "0193a1b2-0000-7000-8000-000000000099" });
    const create = vi.fn().mockResolvedValue(created);
    const { user, onSaved } = show({ create });
    await fill(user);
    await user.click(save());
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      type: "expense",
      occurredOn: "2026-11-16",
      paidOn: "2026-11-16",
      description: "Gás de cozinha",
      amountCents: 45000,
      categoryId: CATEGORY,
      unitId: UNIT,
      supplier: null,
      salesChannelId: null,
      orders: null,
    });
    expect(create.mock.calls[0]?.[0].clientRequestId).toMatch(UUID_V4);
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(created));
  });

  it("'Salvar e lançar outro' mantém tipo, data e unidade, limpa o resto e mostra o líquido do servidor (CA07, CA08)", async () => {
    const create = vi
      .fn()
      .mockResolvedValue(detailFixture({ type: "revenue", amountCents: 45000, netCents: 44000 }));
    const { user } = show({ create });
    await user.selectOptions(screen.getByLabelText("Tipo"), "Receita");
    expect(screen.getByLabelText("Canal de venda")).toHaveValue(CHANNEL);
    fireEvent.change(screen.getByLabelText("Data de competência"), {
      target: { value: "2026-11-10" },
    });
    await user.type(screen.getByLabelText("Valor"), "450,00");
    await user.type(screen.getByLabelText("Descrição"), "Almoço");
    await user.selectOptions(screen.getByLabelText("Categoria"), "Vendas");
    await user.type(screen.getByLabelText("Pedidos"), "12");
    await user.click(saveAndNext());

    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Receita de R$ 450,00 salva (líquido R$ 440,00)");
    expect(within(status).getByRole("link", { name: "Abrir" })).toBeInTheDocument();
    expect(screen.getByLabelText("Tipo")).toHaveValue("revenue");
    expect(screen.getByLabelText("Data de competência")).toHaveValue("2026-11-10");
    expect(screen.getByLabelText("Data de pagamento")).toHaveValue("2026-11-10");
    expect(screen.getByLabelText("Unidade")).toHaveValue(UNIT);
    expect(screen.getByLabelText("Valor")).toHaveValue("");
    expect(screen.getByLabelText("Descrição")).toHaveValue("");
    expect(screen.getByLabelText("Categoria")).toHaveValue("");
    expect(screen.getByLabelText("Pedidos")).toHaveValue("");
    expect(screen.getByLabelText("Valor")).toHaveFocus();
  });

  it("duplo clique envia uma vez só", async () => {
    let release: (value: EntryDetail) => void = () => {};
    const create = vi.fn().mockReturnValue(
      new Promise<EntryDetail>((resolve) => {
        release = resolve;
      }),
    );
    const { user } = show({ create });
    await fill(user);
    await user.dblClick(save());
    expect(create).toHaveBeenCalledTimes(1);
    release(detailFixture());
  });

  it("o reenvio depois de uma falha usa a mesma chave; a seguinte, depois de sucesso, usa outra (RF26.R3)", async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(new ApiError("fora do ar", 0))
      .mockResolvedValue(detailFixture());
    const { user } = show({ create });
    await fill(user);
    await user.click(saveAndNext());
    await screen.findByRole("alert");
    await user.click(saveAndNext());
    await screen.findByRole("status");
    expect(create).toHaveBeenCalledTimes(2);
    const first = create.mock.calls[0]?.[0].clientRequestId;
    expect(create.mock.calls[1]?.[0].clientRequestId).toBe(first);

    await fill(user, "10,00");
    await user.click(saveAndNext());
    await waitFor(() => expect(create).toHaveBeenCalledTimes(3));
    expect(create.mock.calls[2]?.[0].clientRequestId).not.toBe(first);
  });

  it("virar despesa limpa o canal de venda e os pedidos antes de enviar", async () => {
    const create = vi.fn().mockResolvedValue(detailFixture());
    const { user } = show({ create });
    await user.selectOptions(screen.getByLabelText("Tipo"), "Receita");
    await user.type(screen.getByLabelText("Pedidos"), "5");
    await user.selectOptions(screen.getByLabelText("Tipo"), "Despesa");
    expect(screen.queryByLabelText("Canal de venda")).not.toBeInTheDocument();
    await fill(user);
    await user.click(save());
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      type: "expense",
      salesChannelId: null,
      orders: null,
    });
  });

  it("só oferece categorias do tipo escolhido", async () => {
    const { user } = show();
    const categoria = screen.getByLabelText("Categoria");
    expect(within(categoria).queryByRole("option", { name: "Vendas" })).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Tipo"), "Receita");
    expect(
      within(screen.getByLabelText("Categoria")).getByRole("option", { name: "Vendas" }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByLabelText("Categoria")).queryByRole("option", { name: "Insumos" }),
    ).not.toBeInTheDocument();
  });

  it("categoria que exige quantidade mostra os campos e cobra os dois", async () => {
    const create = vi.fn();
    const { user } = show({ create });
    expect(screen.queryByLabelText("Quantidade")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("Valor"), "10,00");
    await user.type(screen.getByLabelText("Descrição"), "Tomate");
    await user.selectOptions(screen.getByLabelText("Categoria"), "Hortifruti");
    expect(screen.getByLabelText("Quantidade")).toBeInTheDocument();
    await user.click(save());
    expect(
      await screen.findByText("Informe a quantidade e a unidade de medida."),
    ).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it("o 422 com campo marca o campo e mantém o digitado", async () => {
    const create = vi.fn().mockRejectedValue(
      new ApiError("x", 422, {
        code: "invalid_entry",
        reason: "DescriptionEmpty",
        field: "description",
      }),
    );
    const { user } = show({ create });
    await fill(user);
    await user.click(save());
    expect(
      await screen.findByText("A descrição ficou vazia depois de omitir números sensíveis."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Descrição")).toHaveValue("Gás de cozinha");
    expect(screen.getByLabelText("Valor")).toHaveValue("450,00");
  });

  it("409 already_submitted explica e mantém o digitado e a chave", async () => {
    const create = vi.fn().mockRejectedValue(new ApiError("x", 409, { code: "already_submitted" }));
    const { user } = show({ create });
    await fill(user);
    await user.click(save());
    expect(
      await screen.findByText("Este lançamento já foi enviado, mas você não pode mais vê-lo."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Descrição")).toHaveValue("Gás de cozinha");
    await user.click(save());
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[1]?.[0].clientRequestId).toBe(
      create.mock.calls[0]?.[0].clientRequestId,
    );
  });

  it("troca de empresa ou unidade em outra aba (context_changed) não perde o digitado", async () => {
    const create = vi.fn().mockRejectedValue(
      new ApiError("A empresa ou a unidade mudou em outra aba. Recarregue a página.", 409, {
        code: "context_changed",
      }),
    );
    const { user } = show({ create });
    await fill(user);
    await user.click(save());
    expect(await screen.findByRole("alert")).toHaveTextContent("mudou em outra aba");
    expect(screen.getByLabelText("Descrição")).toHaveValue("Gás de cozinha");
    expect(screen.getByLabelText("Valor")).toHaveValue("450,00");
  });

  it("conta somente leitura e falta de permissão têm mensagem própria", async () => {
    const create = vi
      .fn()
      .mockRejectedValueOnce(new ApiError("x", 403, { code: "account_read_only" }))
      .mockRejectedValueOnce(new ApiError("x", 403, { code: "forbidden" }));
    const { user } = show({ create });
    await fill(user);
    await user.click(save());
    expect(await screen.findByRole("alert")).toHaveTextContent("Conta somente leitura");
    await user.click(save());
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Você não tem permissão para lançar nesta unidade.",
      ),
    );
  });

  it("avisa possível repetição e data antiga, e mostra a descrição que o servidor gravou", async () => {
    const create = vi.fn().mockResolvedValue(
      detailFixture({
        description: "Gás",
        flags: ["possible_duplicate", "old_date"],
      }),
    );
    const { user } = show({ create });
    await user.type(screen.getByLabelText("Valor"), "450,00");
    await user.type(screen.getByLabelText("Descrição"), "Gás 123.456.789-09");
    await user.selectOptions(screen.getByLabelText("Categoria"), "Insumos");
    await user.click(saveAndNext());
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(
      "Parece repetido: já existe um lançamento igual nas últimas 24 h",
    );
    expect(status).toHaveTextContent("Data com mais de 60 dias");
    expect(status).toHaveTextContent("Descrição registrada: Gás");
    expect(status).not.toHaveTextContent("123.456.789-09");
  });
  it("trocar para uma categoria que não exige quantidade descarta a quantidade escondida", async () => {
    const create = vi.fn().mockResolvedValue(detailFixture());
    const { user } = show({ create });
    await user.type(screen.getByLabelText("Valor"), "10,00");
    await user.type(screen.getByLabelText("Descrição"), "Tomate");
    await user.selectOptions(screen.getByLabelText("Categoria"), "Hortifruti");
    await user.type(screen.getByLabelText("Quantidade"), "2");
    await user.selectOptions(screen.getByLabelText("Unidade de medida"), "KG");
    await user.selectOptions(screen.getByLabelText("Categoria"), "Insumos");
    expect(screen.queryByLabelText("Quantidade")).not.toBeInTheDocument();
    await user.click(save());
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(create.mock.calls[0]?.[0]).toMatchObject({ quantity: null, quantityUnit: null });
  });
});
