import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  channelFixture,
  fakeSettingsApi,
  paymentFixture,
  renderWithQuery,
  scopeOf,
  unitFixture,
} from "../shared/settings-test-helpers";
import { OnboardingScreen } from "./onboarding-screen";

const api = (extra = {}) =>
  fakeSettingsApi({
    listUnits: () => Promise.resolve([unitFixture()]),
    listSalesChannels: () => Promise.resolve([channelFixture({ name: "Salão", type: "dine_in" })]),
    listPaymentMethods: () => Promise.resolve([paymentFixture()]),
    feePreview: () => Promise.resolve({ grossCents: 10000, feeCents: 320, netCents: 9680 }),
    ...extra,
  });

describe("OnboardingScreen", () => {
  it("passo 1 grava o canal padrão da unidade", async () => {
    const updateUnit = vi.fn().mockResolvedValue(unitFixture());
    renderWithQuery(<OnboardingScreen scope={scopeOf(api({ updateUnit }))} />);
    const select = await screen.findByLabelText("Canal padrão de Centro");
    await userEvent.selectOptions(select, "Salão");
    await userEvent.click(screen.getByRole("button", { name: "Salvar canal de Centro" }));
    expect(updateUnit).toHaveBeenCalledWith(unitFixture().id, {
      defaultSalesChannelId: channelFixture().id,
    });
  });

  it("pode pular cada passo e o passo 3 leva ao cadastro de colaborador", async () => {
    renderWithQuery(<OnboardingScreen scope={scopeOf(api())} />);
    await screen.findByLabelText("Canal padrão de Centro");
    await userEvent.click(screen.getByRole("button", { name: "Pular" }));
    expect(
      await screen.findByRole("heading", { name: /Taxas das formas de pagamento/ }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Pular" }));
    const step3 = await screen.findByRole("heading", { name: /Colaboradores/ });
    expect(step3).toBeInTheDocument();
    expect(screen.queryByText(/em breve/i)).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Cadastrar colaborador" })).toHaveAttribute(
      "href",
      "/configuracoes/colaboradores?novo=1",
    );
    expect(screen.getByRole("link", { name: "Ir para o painel" })).toHaveAttribute("href", "/");
  });

  it("passo 2 abre o formulário de taxa da forma com a prévia", async () => {
    renderWithQuery(<OnboardingScreen scope={scopeOf(api())} />);
    await screen.findByLabelText("Canal padrão de Centro");
    await userEvent.click(screen.getByRole("button", { name: "Pular" }));
    await userEvent.click(await screen.findByRole("button", { name: "Editar taxa de Crédito" }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText(/líquidos/)).toBeInTheDocument();
  });
});
