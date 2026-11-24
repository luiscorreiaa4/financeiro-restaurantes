import type { MemberSettings } from "@app/core/contracts";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import { renderWithQuery, TENANT, unitFixture, uuid } from "../shared/settings-test-helpers";
import type { MembersApi } from "./members-api";
import { MembersScreen } from "./members-screen";
import type { MembersScope } from "./use-members";

function memberFixture(overrides: Partial<MemberSettings> = {}): MemberSettings {
  return {
    id: uuid(10),
    displayName: "Ana",
    phoneMasked: "•••• 5647",
    phone: "+5511987655647",
    email: null,
    role: "staff",
    allUnits: false,
    unitIds: [uuid(3)],
    defaultUnitId: uuid(3),
    panelAccess: false,
    permissions: [],
    status: "active",
    invitedAt: null,
    deactivatedAt: null,
    ...overrides,
  };
}

const reject = () => Promise.reject(new Error("rota não preparada neste teste"));

function scopeOf(api: Partial<MembersApi> = {}, canManage = true): MembersScope {
  return {
    ctx: { tenantId: TENANT, unitId: "all" },
    api: {
      list: () => Promise.resolve([memberFixture()]),
      create: reject,
      update: reject,
      deactivate: reject,
      reactivate: reject,
      ...api,
    },
    listUnits: () => Promise.resolve([unitFixture(), unitFixture({ id: uuid(4), name: "Norte" })]),
    canManage,
  };
}

describe("MembersScreen", () => {
  it("painel Sim sem e-mail mostra o erro antes de enviar", async () => {
    const create = vi.fn();
    renderWithQuery(<MembersScreen scope={scopeOf({ create })} />);
    await userEvent.click(await screen.findByRole("button", { name: "Novo colaborador" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Nome"), "Bia");
    await userEvent.type(within(dialog).getByLabelText("Celular (com DDD)"), "11987654321");
    await userEvent.click(within(dialog).getByLabelText("Acesso ao painel"));
    await userEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(/e-mail/i);
    expect(create).not.toHaveBeenCalled();
  });

  it("gerente consulta sem botões de gravar", async () => {
    renderWithQuery(<MembersScreen scope={scopeOf({}, false)} />);
    expect(await screen.findByText("Ana")).toBeInTheDocument();
    expect(screen.getByText(/•••• 5647/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Novo colaborador" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Desativar/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Ver Ana" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("button", { name: "Salvar" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("note")).toBeInTheDocument();
  });

  it("as permissões trocam com o papel", async () => {
    renderWithQuery(<MembersScreen scope={scopeOf()} />);
    await userEvent.click(await screen.findByRole("button", { name: "Novo colaborador" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Consultar relatórios pelo WhatsApp")).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("Ver folha de pagamento")).not.toBeInTheDocument();
    await userEvent.selectOptions(within(dialog).getByLabelText("Papel"), "manager");
    expect(within(dialog).getByLabelText("Ver folha de pagamento")).toBeInTheDocument();
    expect(
      within(dialog).queryByLabelText("Consultar relatórios pelo WhatsApp"),
    ).not.toBeInTheDocument();
    await userEvent.selectOptions(within(dialog).getByLabelText("Papel"), "owner");
    expect(within(dialog).queryByLabelText("Ver folha de pagamento")).not.toBeInTheDocument();
  });

  it("depois do cadastro mostra o texto e o link do WhatsApp com o texto", async () => {
    const created = {
      member: memberFixture({ displayName: "Bia" }),
      inviteText: "Oi, Bia! Mande um Oi para começar.",
    };
    const create = vi.fn().mockResolvedValue(created);
    renderWithQuery(<MembersScreen scope={scopeOf({ create })} whatsappNumber="5511999999999" />);
    await userEvent.click(await screen.findByRole("button", { name: "Novo colaborador" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Nome"), "Bia");
    await userEvent.type(within(dialog).getByLabelText("Celular (com DDD)"), "11987654321");
    await userEvent.click(within(dialog).getByLabelText("Centro"));
    await userEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: "Bia", defaultUnitId: uuid(3), unitIds: [uuid(3)] }),
    );
    const invite = await screen.findByText(created.inviteText);
    expect(invite).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Abrir no WhatsApp" });
    expect(link).toHaveAttribute(
      "href",
      `https://wa.me/5511999999999?text=${encodeURIComponent(created.inviteText)}`,
    );
    expect(screen.getByRole("button", { name: "Copiar" })).toBeInTheDocument();
  });

  it("trocar o celular pede confirmação e vai com confirmPhoneChange", async () => {
    const update = vi.fn().mockResolvedValue(memberFixture());
    renderWithQuery(<MembersScreen scope={scopeOf({ update })} />);
    await userEvent.click(await screen.findByRole("button", { name: "Editar Ana" }));
    const dialog = await screen.findByRole("dialog");
    const phone = within(dialog).getByLabelText("Celular (com DDD)");
    await userEvent.clear(phone);
    await userEvent.type(phone, "11911112222");
    await userEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    expect(update).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByLabelText(/número antigo deixa de ser reconhecido/));
    await userEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    expect(update).toHaveBeenCalledWith(uuid(10), {
      phone: "11911112222",
      confirmPhoneChange: true,
    });
  });

  it("liberar o painel manda o e-mail digitado junto do patch", async () => {
    const update = vi.fn().mockResolvedValue(memberFixture());
    renderWithQuery(<MembersScreen scope={scopeOf({ update })} />);
    await userEvent.click(await screen.findByRole("button", { name: "Editar Ana" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText(/E-mail/), "ana@exemplo.com.br");
    await userEvent.click(within(dialog).getByLabelText("Acesso ao painel"));
    await userEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    expect(update).toHaveBeenCalledWith(uuid(10), {
      email: "ana@exemplo.com.br",
      panelAccess: true,
    });
  });

  it("desativar o último dono mostra a explicação", async () => {
    const deactivate = vi
      .fn()
      .mockRejectedValue(new ApiError("x", 422, { code: "last_active_owner" }));
    renderWithQuery(<MembersScreen scope={scopeOf({ deactivate })} />);
    await userEvent.click(await screen.findByRole("button", { name: "Desativar Ana" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Desativar colaborador" }));
    expect(await within(dialog).findByText(/pelo menos um dono ativo/)).toBeInTheDocument();
  });
});
