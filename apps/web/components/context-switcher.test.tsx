import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "@/lib/api/client";
import type { FullMe } from "@/lib/api/me-contract";
import { meFixture } from "@/lib/api/me-fixture";
import { tenantKey } from "@/lib/query/keys";
import { ContextSwitcher } from "./context-switcher";

const router = { replace: vi.fn(), refresh: vi.fn(), push: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/lancamentos",
}));

beforeEach(() => {
  router.replace.mockReset();
  router.refresh.mockReset();
});

const T1 = "0190a000-0000-7000-8000-000000000001";
const T2 = "0190a000-0000-7000-8000-000000000002";
const U1 = "0190a000-0000-7000-8000-0000000000a1";
const U2 = "0190a000-0000-7000-8000-0000000000a2";

function fakeApi(units: { id: string; name: string }[]) {
  const post = vi.fn(async () => undefined);
  const api = {
    get: vi.fn(async () => ({ units })),
    post,
    patch: vi.fn(),
  } as unknown as ApiClient;
  return { api, post };
}

function renderSwitcher(me: FullMe, units: { id: string; name: string }[]) {
  const { api, post } = fakeApi(units);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const ui = (current: FullMe) => (
    <QueryClientProvider client={queryClient}>
      <ContextSwitcher me={current} api={api} />
    </QueryClientProvider>
  );
  const { rerender } = render(ui(me));
  return { post, queryClient, rerenderWith: (next: FullMe) => rerender(ui(next)) };
}

const company = (tenantId: string, name: string, extra = {}) => ({
  tenantId,
  name,
  role: "owner" as const,
  accountStatus: "active" as const,
  startUnitId: "all",
  ...extra,
});

describe("seletor de empresa e unidade", () => {
  it("uma empresa e uma unidade: sem seletor", async () => {
    const me = meFixture({ context: { ...meFixture().context, allUnits: false, unitId: U1 } });
    renderSwitcher(me, [{ id: U1, name: "Matriz" }]);

    await waitFor(() => expect(screen.queryByLabelText("Unidade")).not.toBeInTheDocument());
    expect(screen.queryByLabelText("Empresa")).not.toBeInTheDocument();
  });

  it("duas empresas: seletor de empresa", () => {
    const me = meFixture({
      companies: [company(T1, "Bistrô"), company(T2, "Pizzaria")],
      context: { ...meFixture().context, tenantId: T1 },
    });
    renderSwitcher(me, [{ id: U1, name: "Matriz" }]);

    expect(screen.getByLabelText("Empresa")).toBeInTheDocument();
  });

  it("empresa cancelada aparece com a etiqueta cancelada", () => {
    const me = meFixture({
      companies: [company(T1, "Bistrô"), company(T2, "Pizzaria", { accountStatus: "canceled" })],
      context: { ...meFixture().context, tenantId: T1 },
    });
    renderSwitcher(me, []);

    expect(screen.getByRole("option", { name: "Pizzaria (cancelada)" })).toBeInTheDocument();
  });

  it("mais de 8 empresas: campo de busca filtra por nome", async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 9 }, (_, i) =>
      company(`0190a000-0000-7000-8000-00000000010${i}`, i === 4 ? "Pizzaria Sul" : `Loja ${i}`),
    );
    const me = meFixture({
      companies: many,
      context: { ...meFixture().context, tenantId: many[0]?.tenantId ?? T1 },
    });
    renderSwitcher(me, []);

    await user.type(screen.getByLabelText("Buscar empresa"), "pizz");

    expect(screen.getByRole("option", { name: "Pizzaria Sul" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Loja 3" })).not.toBeInTheDocument();
  });

  it("até 8 empresas: sem campo de busca", () => {
    const me = meFixture({
      companies: [company(T1, "Bistrô"), company(T2, "Pizzaria")],
      context: { ...meFixture().context, tenantId: T1 },
    });
    renderSwitcher(me, []);

    expect(screen.queryByLabelText("Buscar empresa")).not.toBeInTheDocument();
  });

  it("trocar de empresa grava o contexto e atualiza a mesma rota sem recarregar a página", async () => {
    const user = userEvent.setup();
    const me = meFixture({
      companies: [company(T1, "Bistrô"), company(T2, "Pizzaria", { startUnitId: U2 })],
      context: { ...meFixture().context, tenantId: T1 },
    });
    const { post } = renderSwitcher(me, []);

    await user.selectOptions(screen.getByLabelText("Empresa"), T2);

    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    // Sem `?entry=`, filtros e outros parâmetros que só valem na empresa anterior.
    expect(router.replace).toHaveBeenCalledWith("/lancamentos");
    expect(post).toHaveBeenCalledWith(
      "/api/context",
      { tenantId: T2, unitId: U2 },
      expect.anything(),
    );
  });

  it("o dado das outras empresas só sai do cache quando o contexto novo chega, sem refazer busca com o antigo", async () => {
    const user = userEvent.setup();
    const me = meFixture({
      companies: [company(T1, "Bistrô"), company(T2, "Pizzaria", { startUnitId: U2 })],
      context: { ...meFixture().context, tenantId: T1 },
    });
    const { queryClient, rerenderWith } = renderSwitcher(me, []);
    const oldKey = tenantKey({ tenantId: T1, unitId: me.context.unitId }, "entries");
    const newKey = tenantKey({ tenantId: T2, unitId: U2 }, "entries");
    queryClient.setQueryData(oldKey, { total: 1 });
    queryClient.setQueryData(newKey, { total: 2 });
    queryClient.setQueryData(["perfil"], { nome: "Ana" });

    await user.selectOptions(screen.getByLabelText("Empresa"), T2);
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    // Antes de o servidor entregar o contexto novo nada é removido: consulta ativa com a chave
    // antiga refaria a busca com o `X-Context` velho e tomaria 409.
    expect(queryClient.getQueryData(oldKey)).toEqual({ total: 1 });

    rerenderWith({ ...me, context: { ...me.context, tenantId: T2, unitId: U2 } });

    await waitFor(() => expect(queryClient.getQueryData(oldKey)).toBeUndefined());
    expect(queryClient.getQueryData(newKey)).toEqual({ total: 2 });
    expect(queryClient.getQueryData(["perfil"])).toEqual({ nome: "Ana" });
  });

  it("não atualiza a rota quando o POST falha, e mostra o erro", async () => {
    const user = userEvent.setup();
    const me = meFixture({
      companies: [company(T1, "Bistrô"), company(T2, "Pizzaria")],
      context: { ...meFixture().context, tenantId: T1 },
    });
    const { post } = renderSwitcher(me, []);
    post.mockRejectedValueOnce(new Error("403"));

    await user.selectOptions(screen.getByLabelText("Empresa"), T2);

    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(router.replace).not.toHaveBeenCalled();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("gerente sem allUnits: sem a opção Todas as unidades", async () => {
    const me = meFixture({
      context: { ...meFixture().context, role: "manager", allUnits: false, unitId: U1 },
    });
    renderSwitcher(me, [
      { id: U1, name: "Matriz" },
      { id: U2, name: "Filial" },
    ]);

    await screen.findByRole("option", { name: "Filial" });
    expect(screen.queryByRole("option", { name: "Todas as unidades" })).not.toBeInTheDocument();
  });

  it("owner: com Todas as unidades e troca de unidade grava o contexto", async () => {
    const user = userEvent.setup();
    const me = meFixture();
    const { post } = renderSwitcher(me, [
      { id: U1, name: "Matriz" },
      { id: U2, name: "Filial" },
    ]);

    await screen.findByRole("option", { name: "Todas as unidades" });
    await user.selectOptions(screen.getByLabelText("Unidade"), U2);

    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(router.replace).toHaveBeenCalledWith("/lancamentos");
    expect(post).toHaveBeenCalledWith(
      "/api/context",
      { tenantId: me.context.tenantId, unitId: U2 },
      expect.anything(),
    );
  });
  it("os seletores não deixam o navegador restaurar o valor antigo ao voltar no histórico (RF02.CA05)", async () => {
    const me = meFixture({
      companies: [company(T1, "Bistrô"), company(T2, "Pizzaria")],
      context: { ...meFixture().context, tenantId: T1 },
    });
    renderSwitcher(me, [
      { id: U1, name: "Matriz" },
      { id: U2, name: "Filial" },
    ]);

    expect(screen.getByLabelText("Empresa")).toHaveAttribute("autocomplete", "off");
    expect(await screen.findByLabelText("Unidade")).toHaveAttribute("autocomplete", "off");
  });
});
