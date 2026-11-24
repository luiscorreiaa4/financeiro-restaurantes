import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  fakeSettingsApi,
  paymentFixture,
  renderWithQuery,
  scopeOf,
} from "../shared/settings-test-helpers";
import { PaymentMethodsScreen } from "./payment-methods-screen";

const listApi = (extra = {}) =>
  fakeSettingsApi({
    listPaymentMethods: () =>
      Promise.resolve([
        paymentFixture(),
        paymentFixture({
          id: "0193a1b2-0000-7000-8000-000000000009",
          name: "Não informada",
          type: "other",
          feePercentBp: 0,
          protected: true,
        }),
      ]),
    ...extra,
  });

describe("PaymentMethodsScreen", () => {
  it("lista as formas e marca as do sistema", async () => {
    renderWithQuery(<PaymentMethodsScreen scope={scopeOf(listApi())} />);
    expect(await screen.findByText("Crédito")).toBeInTheDocument();
    expect(screen.getByText("do sistema")).toBeInTheDocument();
  });

  it("sem catalog:manage o formulário abre somente leitura e sem botão de gravar", async () => {
    renderWithQuery(<PaymentMethodsScreen scope={scopeOf(listApi(), false)} />);
    expect(screen.queryByRole("button", { name: /nova forma/i })).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "Ver Crédito" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("button", { name: "Salvar" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("note")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Nome")).toBeDisabled();
  });

  it("a prévia mostra o líquido do servidor, não uma conta da tela", async () => {
    // O servidor devolve um líquido que NÃO bate com 320 bp sobre R$ 100,00.
    const feePreview = vi
      .fn()
      .mockResolvedValue({ grossCents: 10000, feeCents: 123, netCents: 9877 });
    renderWithQuery(<PaymentMethodsScreen scope={scopeOf(listApi({ feePreview }))} />);
    await userEvent.click(await screen.findByRole("button", { name: "Editar Crédito" }));
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(feePreview).toHaveBeenCalledWith(320, 0));
    expect(await within(dialog).findByText(/R\$\s*98,77 líquidos/)).toBeInTheDocument();
  });

  it("grava a taxa nova em pontos-base", async () => {
    const update = vi.fn().mockResolvedValue(paymentFixture({ feePercentBp: 350 }));
    const feePreview = vi
      .fn()
      .mockResolvedValue({ grossCents: 10000, feeCents: 350, netCents: 9650 });
    renderWithQuery(
      <PaymentMethodsScreen
        scope={scopeOf(listApi({ updatePaymentMethod: update, feePreview }))}
      />,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Editar Crédito" }));
    const dialog = await screen.findByRole("dialog");
    const rate = within(dialog).getByLabelText("Taxa percentual");
    await userEvent.clear(rate);
    await userEvent.type(rate, "3,5");
    await userEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(update).toHaveBeenCalled());
    expect(update.mock.calls[0]?.[1]).toMatchObject({ feePercentBp: 350 });
  });

  it("nome repetido mostra 'Já existe'", async () => {
    const { ApiError } = await import("@/lib/api/client");
    const create = vi.fn().mockRejectedValue(new ApiError("x", 409, { code: "name_taken" }));
    renderWithQuery(
      <PaymentMethodsScreen
        scope={scopeOf(
          listApi({
            createPaymentMethod: create,
            feePreview: vi
              .fn()
              .mockResolvedValue({ grossCents: 10000, feeCents: 0, netCents: 10000 }),
          }),
        )}
      />,
    );
    await userEvent.click(await screen.findByRole("button", { name: /nova forma/i }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Nome"), "Crédito");
    await userEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    expect(await within(dialog).findByText(/Já existe/)).toBeInTheDocument();
  });
});
