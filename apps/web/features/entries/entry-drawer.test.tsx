import type { EntrySource, EntryVersion } from "@app/core/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import type { EntriesApi } from "./entries-api";
import {
  AUTHOR,
  detailFixture,
  entryId,
  fakeEntriesApi,
  renderWithEntries,
} from "./entries-test-helpers";
import { EntryDrawer } from "./entry-drawer";

const ID = entryId(1);
const SCRIPT = "<script>alert(1)</script> paguei 450 de gás";

function sourceFixture(overrides: Partial<EntrySource> = {}): EntrySource {
  return {
    channel: "whatsapp",
    kind: "text",
    text: "paguei 450 de gás",
    transcription: null,
    accessKey: null,
    sentBy: { id: AUTHOR, name: "Ana" },
    sentAt: "2026-11-03T12:00:00.000Z",
    restricted: false,
    mediaAvailable: false,
    ...overrides,
  };
}

function versionFixture(overrides: Partial<EntryVersion> = {}): EntryVersion {
  return {
    version: 1,
    action: "create",
    channel: "whatsapp",
    changedBy: { id: AUTHOR, name: "Ana" },
    changedAt: "2026-11-03T12:00:00.000Z",
    restricted: false,
    changes: [],
    ...overrides,
  };
}

function show(overrides: Partial<EntriesApi> = {}, onClose = vi.fn()) {
  const api = fakeEntriesApi({
    detail: () => Promise.resolve(detailFixture()),
    source: () => Promise.resolve(sourceFixture()),
    ...overrides,
  });
  renderWithEntries(<EntryDrawer entryId={ID} onClose={onClose} />, api);
  return { user: userEvent.setup(), onClose };
}

async function openTab(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole("tab", { name }));
  return screen.findByRole("tabpanel", { name });
}

describe("drawer do lançamento (RF25)", () => {
  it("sem lançamento escolhido, não abre nem busca nada", () => {
    const detail = vi.fn<EntriesApi["detail"]>();
    renderWithEntries(<EntryDrawer entryId={null} onClose={vi.fn()} />, fakeEntriesApi({ detail }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(detail).not.toHaveBeenCalled();
  });

  it("a aba Dados mostra o lançamento como a API devolveu", async () => {
    show({
      detail: () =>
        Promise.resolve(
          detailFixture({
            type: "revenue",
            description: "Vendas do dia",
            amountCents: 100000,
            feeCents: 2500,
            netCents: 97500,
            paidOn: "2026-11-10",
            orders: 32,
            flags: ["old_date"],
          }),
        ),
    });
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Vendas do dia")).toBeInTheDocument();
    expect(dialog).toHaveTextContent("R$ 1.000,00");
    expect(dialog).toHaveTextContent("R$ 975,00");
    expect(dialog).toHaveTextContent("03/11/2026");
    expect(dialog).toHaveTextContent("10/11/2026");
    expect(dialog).toHaveTextContent("32");
    expect(dialog).toHaveTextContent("Data antiga");
  });

  it("texto original com <script> aparece como texto e nenhum script é criado (RF25.CA03)", async () => {
    const { user } = show({ source: () => Promise.resolve(sourceFixture({ text: SCRIPT })) });
    const panel = await openTab(user, "Origem");
    expect(await within(panel).findByText(SCRIPT)).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
    expect(panel).toHaveTextContent("WhatsApp");
    expect(panel).toHaveTextContent("Ana");
  });

  it("origem de áudio mostra a transcrição e avisa que a mídia vem depois", async () => {
    const { user } = show({
      source: () =>
        Promise.resolve(
          sourceFixture({ kind: "audio", text: null, transcription: "paguei o gás, 450 reais" }),
        ),
    });
    const panel = await openTab(user, "Origem");
    expect(await within(panel).findByText("paguei o gás, 450 reais")).toBeInTheDocument();
    expect(panel).toHaveTextContent("Áudio e imagem ficam disponíveis em breve");
  });

  it("origem de imagem mostra a chave de acesso da nota", async () => {
    const key = "35261111222233334444555566667777888899990001";
    const { user } = show({
      source: () => Promise.resolve(sourceFixture({ kind: "image", text: null, accessKey: key })),
    });
    const panel = await openTab(user, "Origem");
    expect(await within(panel).findByText(key)).toBeInTheDocument();
  });

  it("origem restrita não mostra conteúdo (RF25.Obs1)", async () => {
    const { user } = show({
      source: () => Promise.resolve(sourceFixture({ text: null, restricted: true })),
    });
    const panel = await openTab(user, "Origem");
    expect(await within(panel).findByText("Contém informação restrita")).toBeInTheDocument();
    expect(panel).not.toHaveTextContent("paguei");
  });

  it("lançamento sem mensagem de origem diz de onde veio", async () => {
    const { user } = show({
      source: () =>
        Promise.resolve(
          sourceFixture({
            channel: "import",
            kind: "none",
            text: null,
            sentBy: null,
            sentAt: null,
          }),
        ),
    });
    const panel = await openTab(user, "Origem");
    expect(await within(panel).findByText(/Importação/)).toBeInTheDocument();
    expect(panel).toHaveTextContent("Este lançamento não veio de uma mensagem.");
  });

  it("lançamento criado no painel diz quem lançou e quando, sem mensagem de origem (RF25.Obs3)", async () => {
    const { user } = show({
      detail: () =>
        Promise.resolve(
          detailFixture({
            originChannel: "web",
            createdBy: { id: "0193a1b2-0000-7000-8000-0000000000dd", name: "Ana" },
            createdAt: "2026-11-03T12:00:00.000Z",
          }),
        ),
      source: () =>
        Promise.resolve(
          sourceFixture({ channel: "web", kind: "none", text: null, sentBy: null, sentAt: null }),
        ),
    });
    const panel = await openTab(user, "Origem");
    expect(
      await within(panel).findByText("Lançado manualmente no painel por Ana em 03/11/2026 09:00"),
    ).toBeInTheDocument();
    expect(panel).not.toHaveTextContent("Este lançamento não veio de uma mensagem.");
  });

  it("o histórico mostra quem, canal, ação e o antes e depois de cada campo (RF25.R4)", async () => {
    const { user } = show({
      detail: () =>
        Promise.resolve(
          detailFixture({
            version: 2,
            versions: [
              versionFixture(),
              versionFixture({
                version: 2,
                action: "update",
                channel: "web",
                changedBy: { id: entryId(77), name: "Bruno" },
                changes: [
                  { field: "amountCents", before: 45000, after: 47000 },
                  { field: "occurredOn", before: "2026-11-03", after: "2026-11-04" },
                  { field: "category", before: "Insumos", after: "Gás" },
                  { field: "supplier", before: null, after: "Ultragaz" },
                ],
              }),
            ],
          }),
        ),
    });
    const panel = await openTab(user, "Histórico");
    const [created, updated] = within(panel).getAllByRole("listitem");
    expect(created).toHaveTextContent("Criação");
    expect(created).toHaveTextContent("WhatsApp");
    expect(created).toHaveTextContent("Ana");
    expect(updated).toHaveTextContent("Alteração");
    expect(updated).toHaveTextContent("Painel");
    expect(updated).toHaveTextContent("Bruno");
    expect(updated).toHaveTextContent("Valor bruto");
    expect(updated).toHaveTextContent("R$ 450,00");
    expect(updated).toHaveTextContent("R$ 470,00");
    expect(updated).toHaveTextContent("03/11/2026");
    expect(updated).toHaveTextContent("04/11/2026");
    expect(updated).toHaveTextContent("Insumos");
    expect(updated).toHaveTextContent("Ultragaz");
  });

  it('versão sem autor (feita pela gestão, vista pelo lançador) mostra "Gestão" (DD-40)', async () => {
    const { user } = show({
      detail: () =>
        Promise.resolve(
          detailFixture({
            version: 2,
            versions: [
              versionFixture(),
              versionFixture({ version: 2, action: "delete", channel: "web", changedBy: null }),
            ],
          }),
        ),
    });
    const panel = await openTab(user, "Histórico");
    const [created, deleted] = within(panel).getAllByRole("listitem");
    expect(created).toHaveTextContent("Ana");
    expect(deleted).toHaveTextContent("Exclusão");
    expect(deleted).toHaveTextContent("Gestão");
  });

  it("versão restrita aparece sem conteúdo", async () => {
    const { user } = show({
      detail: () =>
        Promise.resolve(
          detailFixture({
            versions: [versionFixture({ action: "update", channel: "web", restricted: true })],
          }),
        ),
    });
    const panel = await openTab(user, "Histórico");
    expect(within(panel).getByText("Alteração com informação restrita")).toBeInTheDocument();
  });

  it("motivo de exclusão com HTML aparece como texto", async () => {
    const { user } = show({
      detail: () =>
        Promise.resolve(
          detailFixture({
            versions: [
              versionFixture({
                version: 2,
                action: "delete",
                channel: "web",
                changes: [{ field: "deleteReason", before: null, after: "<img src=x onerror=1>" }],
              }),
            ],
          }),
        ),
    });
    const panel = await openTab(user, "Histórico");
    expect(within(panel).getByText("<img src=x onerror=1>")).toBeInTheDocument();
    expect(document.querySelector("img")).toBeNull();
    expect(panel).toHaveTextContent("Exclusão");
  });

  it('lançamento inexistente ou invisível mostra "Lançamento não encontrado"', async () => {
    show({ detail: () => Promise.reject(new ApiError("404", 404, { code: "not_found" })) });
    expect(await screen.findByText("Lançamento não encontrado")).toBeInTheDocument();
    expect(screen.queryByRole("tab")).not.toBeInTheDocument();
  });

  it("falha de rede oferece tentar de novo", async () => {
    const detail = vi
      .fn<EntriesApi["detail"]>()
      .mockRejectedValueOnce(new ApiError("fora do ar", 0))
      .mockResolvedValueOnce(detailFixture());
    const { user } = show({ detail });
    await user.click(await screen.findByRole("button", { name: "Tentar de novo" }));
    expect(await screen.findByRole("tab", { name: "Dados" })).toBeInTheDocument();
  });

  it("fechar avisa a tela, que tira o lançamento da URL", async () => {
    const { user, onClose } = show();
    await user.click(await screen.findByRole("button", { name: "Fechar" }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("edição no drawer (RF23)", () => {
  it("quem pode editar vê o botão Editar e abre o formulário", async () => {
    const { user } = show({ detail: () => Promise.resolve(detailFixture({ canEdit: true })) });
    await user.click(await screen.findByRole("button", { name: "Editar" }));
    expect(await screen.findByLabelText("Descrição")).toHaveValue("Gás de cozinha");
  });

  it("contador (sem canEdit) não vê o botão Editar", async () => {
    show({ detail: () => Promise.resolve(detailFixture({ canEdit: false })) });
    await screen.findByText("Gás de cozinha");
    expect(screen.queryByRole("button", { name: "Editar" })).toBeNull();
  });

  it("depois de salvar, volta a mostrar os dados do lançamento atualizado", async () => {
    let current = detailFixture({ version: 1, canEdit: true });
    const update = vi.fn().mockImplementation(async () => {
      current = detailFixture({ version: 2, canEdit: true, description: "Gás novo" });
      return current;
    });
    const { user } = show({ detail: () => Promise.resolve(current), update });
    await user.click(await screen.findByRole("button", { name: "Editar" }));
    const field = await screen.findByLabelText("Descrição");
    await user.clear(field);
    await user.type(field, "Gás novo");
    await user.click(screen.getByRole("button", { name: "Salvar" }));
    expect(await screen.findByRole("button", { name: "Editar" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Descrição")).toBeNull();
    expect(await screen.findByText("Gás novo")).toBeInTheDocument();
  });

  it("recarregar depois do conflito mostra a versão atual no formulário", async () => {
    const current = detailFixture({
      version: 2,
      canEdit: true,
      description: "Versão da Bia",
      versions: [
        {
          version: 2,
          action: "update",
          channel: "web",
          changedBy: { id: AUTHOR, name: "Bia" },
          changedAt: "2026-11-03T12:30:00.000Z",
          restricted: false,
          changes: [],
        },
      ],
    });
    const update = vi
      .fn()
      .mockRejectedValue(new ApiError("409", 409, { code: "entry_stale", current }));
    const { user } = show({
      detail: () => Promise.resolve(detailFixture({ version: 1, canEdit: true })),
      update,
    });
    await user.click(await screen.findByRole("button", { name: "Editar" }));
    const field = await screen.findByLabelText("Descrição");
    await user.type(field, " x");
    await user.click(screen.getByRole("button", { name: "Salvar" }));
    await user.click(await screen.findByRole("button", { name: "Recarregar" }));
    await waitFor(() => expect(screen.getByLabelText("Descrição")).toHaveValue("Versão da Bia"));
  });
});

describe("exclusão no drawer (RF24)", () => {
  it("quem pode excluir confirma com motivo, o lançamento é excluído e o drawer fecha", async () => {
    const remove = vi.fn().mockResolvedValue(detailFixture());
    const { user, onClose } = show({
      detail: () => Promise.resolve(detailFixture({ canDelete: true })),
      remove,
    });
    await user.click(await screen.findByRole("button", { name: "Excluir" }));
    await user.type(await screen.findByLabelText("Motivo (opcional)"), "duplicado");
    const dialogs = await screen.findAllByRole("alertdialog");
    await user.click(within(dialogs[0] as HTMLElement).getByRole("button", { name: "Excluir" }));
    await waitFor(() => expect(remove).toHaveBeenCalledWith(ID, "duplicado"));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("sem canDelete não há botão Excluir", async () => {
    show({ detail: () => Promise.resolve(detailFixture({ canDelete: false })) });
    await screen.findByText("Gás de cozinha");
    expect(screen.queryByRole("button", { name: "Excluir" })).toBeNull();
  });

  it("lançamento já na lixeira não oferece Editar nem Excluir", async () => {
    show({
      detail: () =>
        Promise.resolve(
          detailFixture({
            canEdit: true,
            canDelete: true,
            deleted: {
              at: "2026-11-04T12:00:00.000Z",
              by: { id: AUTHOR, name: "Ana" },
              reason: null,
              restorableUntil: "2026-12-04",
            },
          }),
        ),
    });
    await screen.findByText(/Na lixeira desde/);
    expect(screen.queryByRole("button", { name: "Excluir" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Editar" })).toBeNull();
  });
});
