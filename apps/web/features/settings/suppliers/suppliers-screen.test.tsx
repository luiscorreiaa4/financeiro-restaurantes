import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import {
  fakeSettingsApi,
  renderWithQuery,
  scopeOf,
  supplierFixture,
  uuid,
} from "../shared/settings-test-helpers";
import { SuppliersScreen } from "./suppliers-screen";

const period = { from: "2026-11-01", to: "2026-11-30" };
const a = supplierFixture({ id: uuid(21), name: "Atacadão", document: "11222333000181" });
const b = supplierFixture({
  id: uuid(22),
  name: "Ceasa",
  document: "•••.•••.247-25",
  documentKind: "cpf",
  totalSpentCents: 0,
  lastPurchaseOn: null,
});
const list = () => Promise.resolve({ ...period, items: [a, b] });

function renderScreen(api = fakeSettingsApi({ listSuppliers: list }), canManage = true) {
  return renderWithQuery(
    <SuppliersScreen
      scope={scopeOf(api, false, canManage)}
      period={period}
      onPeriodChange={() => {}}
    />,
  );
}

describe("SuppliersScreen", () => {
  it("mostra total e última compra como vieram do servidor e o CPF já mascarado", async () => {
    renderScreen();
    expect(await screen.findByText("Atacadão")).toBeInTheDocument();
    expect(screen.getByText(/R\$\s*1\.234,56/)).toBeInTheDocument();
    expect(screen.getByText("•••.•••.247-25")).toBeInTheDocument();
    expect(screen.getByText(/sem compras no período/i)).toBeInTheDocument();
  });

  it("gerente (sem catalog:manage, com supplier:manage) vê Mesclar e Editar", async () => {
    renderScreen();
    await screen.findByText("Atacadão");
    expect(screen.getByRole("button", { name: "Mesclar Atacadão" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Editar Atacadão" })).toBeInTheDocument();
  });

  it("contador só consulta: sem Mesclar nem Editar", async () => {
    renderScreen(undefined, false);
    await screen.findByText("Atacadão");
    expect(screen.queryByRole("button", { name: /mesclar/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /editar/i })).not.toBeInTheDocument();
  });

  it("mesclar: escolhe o destino, vê a prévia com o aviso e confirma", async () => {
    const previewMerge = vi.fn().mockResolvedValue({ visibleEntries: 7 });
    const mergeSuppliers = vi.fn().mockResolvedValue({ ok: true, target: b });
    const api = fakeSettingsApi({ listSuppliers: list, previewMerge, mergeSuppliers });
    renderScreen(api);
    await userEvent.click(await screen.findByRole("button", { name: "Mesclar Atacadão" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.selectOptions(within(dialog).getByLabelText("Mesclar em"), uuid(22));
    expect(await within(dialog).findByText(/7 lançamentos/)).toBeInTheDocument();
    expect(
      within(dialog).getByText(/lançamentos que você não vê também passam para o destino/i),
    ).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "Mesclar" }));
    expect(previewMerge).toHaveBeenCalledWith(uuid(21), uuid(22));
    expect(mergeSuppliers).toHaveBeenCalledWith(uuid(21), uuid(22));
  });

  it("mostra o erro de documentos diferentes ao mesclar", async () => {
    const api = fakeSettingsApi({
      listSuppliers: list,
      previewMerge: () => Promise.resolve({ visibleEntries: 1 }),
      mergeSuppliers: () => Promise.reject(new ApiError("x", 422, { code: "document_conflict" })),
    });
    renderScreen(api);
    await userEvent.click(await screen.findByRole("button", { name: "Mesclar Atacadão" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.selectOptions(within(dialog).getByLabelText("Mesclar em"), uuid(22));
    await within(dialog).findByText(/1 lançamento/);
    await userEvent.click(within(dialog).getByRole("button", { name: "Mesclar" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/documentos diferentes/i);
  });

  it("edita o fornecedor mandando só o patch", async () => {
    const updateSupplier = vi.fn().mockResolvedValue(a);
    const api = fakeSettingsApi({ listSuppliers: list, updateSupplier });
    renderScreen(api);
    await userEvent.click(await screen.findByRole("button", { name: "Editar Atacadão" }));
    const dialog = await screen.findByRole("dialog");
    const name = within(dialog).getByLabelText("Nome");
    await userEvent.clear(name);
    await userEvent.type(name, "Atacadão SP");
    await userEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    expect(updateSupplier).toHaveBeenCalledWith(uuid(21), { name: "Atacadão SP" });
  });
});
