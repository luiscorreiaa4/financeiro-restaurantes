import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EntriesApi } from "./entries-api";
import {
  CATEGORY,
  detailFixture,
  EMPTY_TOTALS,
  entryId,
  fakeEntriesApi,
  itemFixture,
  renderWithEntries,
} from "./entries-test-helpers";
import { EntriesView } from "./entries-view";

const nav = vi.hoisted(() => ({ search: "", push: vi.fn(), replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  usePathname: () => "/lancamentos",
  useSearchParams: () => new URLSearchParams(nav.search),
}));

const TODAY = "2026-11-13";
const MONTH = "from=2026-11-01&to=2026-11-30";

function show(api?: EntriesApi, role: "owner" | "staff" = "owner") {
  return renderWithEntries(<EntriesView today={TODAY} role={role} />, api);
}

function listOf(...items: ReturnType<typeof itemFixture>[]): Partial<EntriesApi> {
  return { list: () => Promise.resolve({ items, nextCursor: null }) };
}

beforeEach(() => {
  nav.search = "";
  nav.push.mockReset();
  nav.replace.mockReset();
});

describe("lista de lançamentos (RF22)", () => {
  it("mudar um filtro leva a consulta para a URL", async () => {
    const user = userEvent.setup();
    show();
    await user.selectOptions(screen.getByLabelText("Tipo"), "expense");
    expect(nav.push).toHaveBeenCalledWith(`/lancamentos?${MONTH}&type=expense`);
  });

  it("o atalho de período troca as duas datas", async () => {
    const user = userEvent.setup();
    show();
    await user.selectOptions(screen.getByLabelText("Período"), "previous_month");
    expect(nav.push).toHaveBeenCalledWith("/lancamentos?from=2026-10-01&to=2026-10-31");
  });

  it("a busca só vai para a URL ao enviar", async () => {
    const user = userEvent.setup();
    show();
    await user.type(screen.getByLabelText("Buscar"), "450,00");
    expect(nav.push).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Buscar" }));
    expect(nav.push).toHaveBeenCalledWith(`/lancamentos?${MONTH}&q=450%2C00`);
  });

  it('"só a revisar" filtra pelos quatro sinais (RF22.R4)', async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByLabelText("Só a revisar"));
    expect(nav.push).toHaveBeenCalledWith(
      `/lancamentos?${MONTH}&flags=category_to_review&flags=channel_to_review` +
        "&flags=possible_duplicate&flags=old_date",
    );
  });

  it('clicar em "Valor" ordena por valor, depois inverte, depois volta à ordem padrão', async () => {
    const user = userEvent.setup();
    const api = fakeEntriesApi(listOf(itemFixture()));

    const first = show(api);
    const header = await screen.findByRole("columnheader", { name: /Valor/ });
    expect(header).toHaveAttribute("aria-sort", "none");
    await user.click(within(header).getByRole("button"));
    expect(nav.push).toHaveBeenLastCalledWith(`/lancamentos?${MONTH}&sort=amount`);
    first.unmount();

    nav.search = `${MONTH}&sort=amount`;
    const second = show(api);
    const descending = await screen.findByRole("columnheader", { name: /Valor/ });
    expect(descending).toHaveAttribute("aria-sort", "descending");
    await user.click(within(descending).getByRole("button"));
    expect(nav.push).toHaveBeenLastCalledWith(`/lancamentos?${MONTH}&sort=amount&dir=asc`);
    second.unmount();

    nav.search = `${MONTH}&sort=amount&dir=asc`;
    show(api);
    const ascending = await screen.findByRole("columnheader", { name: /Valor/ });
    expect(ascending).toHaveAttribute("aria-sort", "ascending");
    await user.click(within(ascending).getByRole("button"));
    expect(nav.push).toHaveBeenLastCalledWith(`/lancamentos?${MONTH}`);
  });

  it("os totais são os do servidor: a tela não soma as linhas (RF22.Obs2)", async () => {
    show(
      fakeEntriesApi({
        ...listOf(
          itemFixture({ id: entryId(1), amountCents: 10000, netCents: 10000 }),
          itemFixture({ id: entryId(2), amountCents: 20000, netCents: 20000 }),
        ),
        // De propósito diferente da soma das linhas (R$ 300,00).
        totals: () =>
          Promise.resolve({
            revenueCents: 123456,
            expenseCents: 99999,
            resultCents: 23457,
            count: 7,
            hasRestricted: false,
          }),
      }),
    );
    const totals = await screen.findByRole("region", { name: "Totais do filtro" });
    await waitFor(() => expect(totals).toHaveTextContent("R$ 999,99"));
    expect(totals).toHaveTextContent("R$ 1.234,56");
    expect(totals).toHaveTextContent("R$ 234,57");
    expect(totals).toHaveTextContent("7 lançamentos");
    expect(totals).not.toHaveTextContent("R$ 300,00");
  });

  it("avisa quando há valores restritos fora dos totais (RF22.Obs7)", async () => {
    show(
      fakeEntriesApi({ totals: () => Promise.resolve({ ...EMPTY_TOTALS, hasRestricted: true }) }),
    );
    expect(
      await screen.findByText("Há valores restritos que não entram nestes totais."),
    ).toBeInTheDocument();
  });

  it("sem valores restritos, não mostra o aviso", async () => {
    show();
    await screen.findByRole("region", { name: "Totais do filtro" });
    expect(screen.queryByText(/valores restritos/)).not.toBeInTheDocument();
  });

  it("lista vazia orienta a mandar o primeiro pelo WhatsApp (RF22.Obs6)", async () => {
    show();
    expect(
      await screen.findByText(
        "Nenhum lançamento neste período. Que tal mandar o primeiro pelo WhatsApp?",
      ),
    ).toBeInTheDocument();
  });

  it('erro mostra "Tentar de novo", que refaz a busca', async () => {
    const user = userEvent.setup();
    const list = vi
      .fn<EntriesApi["list"]>()
      .mockRejectedValueOnce(new Error("fora do ar"))
      .mockResolvedValueOnce({ items: [itemFixture()], nextCursor: null });
    show(fakeEntriesApi({ list }));
    await user.click(await screen.findByRole("button", { name: "Tentar de novo" }));
    expect((await screen.findAllByText("Gás de cozinha")).length).toBeGreaterThan(0);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('"Carregar mais" busca a página seguinte pelo cursor', async () => {
    const user = userEvent.setup();
    const list = vi
      .fn<EntriesApi["list"]>()
      .mockResolvedValueOnce({ items: [itemFixture({ id: entryId(1) })], nextCursor: "c1" })
      .mockResolvedValueOnce({
        items: [itemFixture({ id: entryId(2), description: "Aluguel" })],
        nextCursor: null,
      });
    show(fakeEntriesApi({ list }));
    await user.click(await screen.findByRole("button", { name: "Carregar mais" }));
    expect((await screen.findAllByText("Aluguel")).length).toBeGreaterThan(0);
    expect(list.mock.calls[1]?.[0].cursor).toBe("c1");
    expect(screen.queryByRole("button", { name: "Carregar mais" })).not.toBeInTheDocument();
  });

  it("descrição com HTML aparece como texto (RF25.R1)", async () => {
    const { container } = show(
      fakeEntriesApi(listOf(itemFixture({ description: "<b>pão</b><script>alert(1)</script>" }))),
    );
    expect(
      (await screen.findAllByText("<b>pão</b><script>alert(1)</script>")).length,
    ).toBeGreaterThan(0);
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("td b")).toBeNull();
  });

  it("pagamento só aparece quando difere da data; líquido e canal só em receita", async () => {
    show(
      fakeEntriesApi(
        listOf(
          itemFixture({ id: entryId(1), description: "Gás", paidOn: "2026-11-10" }),
          itemFixture({
            id: entryId(2),
            type: "revenue",
            description: "Vendas do dia",
            amountCents: 100000,
            feeCents: 2500,
            netCents: 97500,
            salesChannel: { id: entryId(90), name: "Delivery" },
          }),
        ),
      ),
    );
    const table = await screen.findByRole("table");
    const expense = within(table).getByRole("row", { name: /Gás/ });
    expect(expense).toHaveTextContent("03/11/2026");
    expect(expense).toHaveTextContent("10/11/2026");
    expect(expense).not.toHaveTextContent("Líquido");
    const revenue = within(table).getByRole("row", { name: /Vendas do dia/ });
    expect(revenue).toHaveTextContent("R$ 1.000,00");
    expect(revenue).toHaveTextContent("Líquido R$ 975,00");
    expect(revenue).toHaveTextContent("Delivery");
    // Data igual à de pagamento: uma data só na linha.
    expect(revenue.textContent?.match(/03\/11\/2026/g)).toHaveLength(1);
  });

  it("mostra os sinais de revisão do lançamento", async () => {
    show(fakeEntriesApi(listOf(itemFixture({ flags: ["possible_duplicate", "old_date"] }))));
    const table = await screen.findByRole("table");
    expect(within(table).getByText("Possível duplicidade")).toBeInTheDocument();
    expect(within(table).getByText("Data antiga")).toBeInTheDocument();
  });

  it('o lançador não tem o filtro "Lançado por" (RF22.R3)', async () => {
    const owner = show(undefined, "owner");
    expect(await screen.findByLabelText("Lançado por")).toBeInTheDocument();
    owner.unmount();
    show(undefined, "staff");
    await screen.findByLabelText("Tipo");
    expect(screen.queryByLabelText("Lançado por")).not.toBeInTheDocument();
  });

  it("abrir um lançamento põe o id na URL, mantendo os filtros", async () => {
    const user = userEvent.setup();
    nav.search = `${MONTH}&type=expense`;
    show(fakeEntriesApi(listOf(itemFixture())));
    const table = await screen.findByRole("table");
    await user.click(within(table).getByRole("button", { name: "Gás de cozinha" }));
    expect(nav.push).toHaveBeenCalledWith(`/lancamentos?${MONTH}&type=expense&entry=${entryId(1)}`);
  });

  it("com ?entry= na URL o lançamento abre; fechar tira só esse parâmetro", async () => {
    const user = userEvent.setup();
    nav.search = `${MONTH}&type=expense&entry=${entryId(1)}`;
    show(
      fakeEntriesApi({
        ...listOf(itemFixture()),
        detail: () => Promise.resolve(detailFixture({ description: "Gás de cozinha" })),
      }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByRole("tab", { name: "Dados" })).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Fechar" }));
    expect(nav.replace).toHaveBeenCalledWith(`/lancamentos?${MONTH}&type=expense`);
  });

  it("a caixa marcada continua marcada enquanto a navegação não termina", async () => {
    const user = userEvent.setup();
    // O roteador falso não muda a URL: é o intervalo entre o clique e a navegação.
    show();
    const box = await screen.findByLabelText("Insumos");
    await user.click(box);
    expect(nav.push).toHaveBeenCalledWith(`/lancamentos?${MONTH}&categoryIds=${CATEGORY}`);
    expect(box).toBeChecked();
    const review = screen.getByLabelText("Só a revisar");
    await user.click(review);
    expect(review).toBeChecked();
  });
});
