import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import {
  channelFixture,
  fakeSettingsApi,
  renderWithQuery,
  scopeOf,
} from "../shared/settings-test-helpers";
import { SalesChannelsScreen } from "./sales-channels-screen";

const api = fakeSettingsApi({ listSalesChannels: () => Promise.resolve([channelFixture()]) });

describe("SalesChannelsScreen", () => {
  it("lista os canais com a comissão", async () => {
    renderWithQuery(<SalesChannelsScreen scope={scopeOf(api)} />);
    expect(await screen.findByText("iFood")).toBeInTheDocument();
    expect(screen.getByText(/comissão 23,00 %/)).toBeInTheDocument();
  });

  it("gerente abre o canal somente leitura, sem botão de gravar nem de reaplicar", async () => {
    renderWithQuery(<SalesChannelsScreen scope={scopeOf(api, false)} />);
    expect(screen.queryByRole("button", { name: /novo canal/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reaplicar/i })).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "Ver iFood" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("button", { name: "Salvar" })).not.toBeInTheDocument();
  });

  it("explica a regra P06 no tipo aplicativo", async () => {
    renderWithQuery(<SalesChannelsScreen scope={scopeOf(api)} />);
    await userEvent.click(await screen.findByRole("button", { name: "Editar iFood" }));
    expect(
      await screen.findByText(/a comissão substitui a taxa da forma de pagamento/),
    ).toBeInTheDocument();
  });
});
