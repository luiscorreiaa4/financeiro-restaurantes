import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  categoryFixture,
  fakeSettingsApi,
  renderWithQuery,
  scopeOf,
  uuid,
} from "../shared/settings-test-helpers";
import { CategoriesScreen } from "./categories-screen";

const child = categoryFixture({
  id: uuid(11),
  name: "Frutos do mar",
  parentId: uuid(10),
  origin: "company",
  supportWords: ["camarão"],
});
const meat = categoryFixture({ children: [child] });
const payroll = categoryFixture({
  id: uuid(12),
  name: "Salários",
  kind: "expense",
  dreGroup: "pessoal",
  isSensitive: true,
  requiresQuantity: false,
});

describe("CategoriesScreen", () => {
  it("mostra a árvore: do sistema com selo, da empresa com palavras de apoio", async () => {
    const api = fakeSettingsApi({ listCategories: () => Promise.resolve([meat]) });
    renderWithQuery(<CategoriesScreen scope={scopeOf(api)} />);
    expect(await screen.findByText("Carnes")).toBeInTheDocument();
    expect(screen.getByText("Frutos do mar")).toBeInTheDocument();
    expect(screen.getAllByText("do sistema").length).toBeGreaterThan(0);
    expect(screen.getByText(/camarão/)).toBeInTheDocument();
  });

  it("a nova subcategoria mostra o que herda do pai (CA02)", async () => {
    const api = fakeSettingsApi({ listCategories: () => Promise.resolve([meat]) });
    renderWithQuery(<CategoriesScreen scope={scopeOf(api)} />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Nova subcategoria em Carnes" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/Despesa/)).toBeInTheDocument();
    expect(within(dialog).getByText(/CMV/)).toBeInTheDocument();
    expect(within(dialog).getByText(/exige quantidade e unidade/i)).toBeInTheDocument();
  });

  it("sensível aparece travada e não pode ser desmarcada (CA03)", async () => {
    const api = fakeSettingsApi({ listCategories: () => Promise.resolve([payroll]) });
    renderWithQuery(<CategoriesScreen scope={scopeOf(api)} />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Nova subcategoria em Salários" }),
    );
    const dialog = await screen.findByRole("dialog");
    const box = within(dialog).getByRole("checkbox", { name: /sensível/i });
    expect(box).toBeChecked();
    expect(box).toBeDisabled();
  });

  it("natureza só aparece em despesa e a edição não tem campo de pai", async () => {
    const revenue = categoryFixture({
      id: uuid(13),
      name: "Vendas",
      kind: "revenue",
      nature: null,
      dreGroup: "receita_bruta",
      requiresQuantity: false,
    });
    const api = fakeSettingsApi({ listCategories: () => Promise.resolve([revenue, meat]) });
    renderWithQuery(<CategoriesScreen scope={scopeOf(api)} />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Nova subcategoria em Vendas" }),
    );
    expect(screen.queryByLabelText(/natureza/i)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await userEvent.click(await screen.findByRole("button", { name: "Editar Frutos do mar" }));
    expect(screen.queryByLabelText(/categoria pai/i)).not.toBeInTheDocument();
  });

  it("sem permissão de gravar, não há botões de criar nem de salvar; do sistema é só leitura", async () => {
    const api = fakeSettingsApi({ listCategories: () => Promise.resolve([meat]) });
    renderWithQuery(<CategoriesScreen scope={scopeOf(api, false)} />);
    await screen.findByText("Carnes");
    expect(screen.queryByRole("button", { name: /nova subcategoria/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Ver Frutos do mar" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("button", { name: "Salvar" })).not.toBeInTheDocument();
  });

  it("grava a subcategoria nova com o pai escolhido", async () => {
    const createSubcategory = vi.fn().mockResolvedValue(child);
    const api = fakeSettingsApi({
      listCategories: () => Promise.resolve([meat]),
      createSubcategory,
    });
    renderWithQuery(<CategoriesScreen scope={scopeOf(api)} />);
    await userEvent.click(
      await screen.findByRole("button", { name: "Nova subcategoria em Carnes" }),
    );
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Nome"), "Frutos do mar");
    await userEvent.type(within(dialog).getByLabelText("Palavras de apoio"), "camarão, lula");
    await userEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    expect(createSubcategory).toHaveBeenCalledWith({
      parentId: meat.id,
      name: "Frutos do mar",
      nature: "variable",
      supportWords: ["camarão", "lula"],
    });
  });
});
