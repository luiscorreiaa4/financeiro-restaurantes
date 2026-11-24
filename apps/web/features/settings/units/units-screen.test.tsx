import type { QueryClient } from "@tanstack/react-query";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import {
  channelFixture,
  fakeSettingsApi,
  renderWithQuery,
  scopeOf,
  unitFixture,
  uuid,
} from "../shared/settings-test-helpers";
import { UnitsScreen } from "./units-screen";

const cities = () => Promise.resolve(["São Paulo", "Campinas"]);
const base = (extra = {}) =>
  fakeSettingsApi({
    listUnits: () => Promise.resolve([unitFixture({ onlyUnitMemberCount: 2 })]),
    listSalesChannels: () => Promise.resolve([channelFixture()]),
    ...extra,
  });

describe("UnitsScreen", () => {
  it("CA02: inativar a última ativa mostra a explicação", async () => {
    const deactivateUnit = vi
      .fn()
      .mockRejectedValue(new ApiError("x", 409, { code: "last_active_unit" }));
    renderWithQuery(<UnitsScreen scope={scopeOf(base({ deactivateUnit }))} loadCities={cities} />);
    await userEvent.click(await screen.findByRole("button", { name: "Inativar Centro" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/2 colaboradores têm só esta unidade/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Inativar unidade" }));
    expect(await within(dialog).findByText(/última unidade ativa/)).toBeInTheDocument();
  });

  it("criar unidade recarrega a lista e o seletor de contexto", async () => {
    const createUnit = vi.fn().mockResolvedValue(unitFixture({ id: uuid(7), name: "Filial" }));
    const { client } = renderWithQuery(
      <UnitsScreen scope={scopeOf(base({ createUnit }))} loadCities={cities} />,
    );
    const invalidate = vi.spyOn(client as QueryClient, "invalidateQueries");
    await userEvent.click(await screen.findByRole("button", { name: "Nova unidade" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Nome"), "Filial");
    await waitFor(() =>
      expect(within(dialog).getByLabelText("Município")).toBeInstanceOf(HTMLSelectElement),
    );
    await userEvent.selectOptions(within(dialog).getByLabelText("Município"), "Campinas");
    await userEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(createUnit).toHaveBeenCalled());
    expect(createUnit.mock.calls[0]?.[0]).toMatchObject({
      name: "Filial",
      city: "Campinas",
      uf: "SP",
      timezone: "America/Sao_Paulo",
    });
    const keys = invalidate.mock.calls.map((call) => JSON.stringify(call[0]?.queryKey));
    expect(keys).toContain(JSON.stringify(["t", scopeOf(base()).ctx.tenantId, "all", "units"]));
  });

  it("gerente não vê criar, editar nem inativar", async () => {
    renderWithQuery(<UnitsScreen scope={scopeOf(base(), false)} loadCities={cities} />);
    expect(await screen.findByText("Centro")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Nova unidade" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Inativar/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Ver Centro" }));
    expect(
      within(await screen.findByRole("dialog")).queryByRole("button", { name: "Salvar" }),
    ).not.toBeInTheDocument();
  });

  it("busca por apelido filtra a lista", async () => {
    const api = base({
      listUnits: () =>
        Promise.resolve([
          unitFixture({ aliases: ["matriz"] }),
          unitFixture({ id: uuid(8), name: "Praia" }),
        ]),
    });
    renderWithQuery(<UnitsScreen scope={scopeOf(api)} loadCities={cities} />);
    await screen.findByText("Praia");
    await userEvent.type(screen.getByLabelText("Buscar unidade"), "matriz");
    expect(screen.queryByText("Praia")).not.toBeInTheDocument();
    expect(screen.getByText("Centro")).toBeInTheDocument();
  });
});
