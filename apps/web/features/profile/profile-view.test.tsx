import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import type { Profile, ProfileClient } from "./profile-client";
import { ProfileView } from "./profile-view";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

beforeEach(() => refresh.mockClear());

const TWO_SESSIONS: Profile = {
  name: "Maria",
  email: "maria@demo.dev",
  hasPassword: true,
  sessions: [
    { device: "Chrome no Android", lastUsedAt: "2026-11-09T15:30:00.000Z", current: true },
    { device: "Safari no iPhone", lastUsedAt: "2026-11-08T10:00:00.000Z", current: false },
  ],
};

function fakeClient(
  profile: Profile = TWO_SESSIONS,
  overrides: Partial<ProfileClient> = {},
): ProfileClient {
  return {
    get: vi.fn(async () => profile),
    updateName: vi.fn(async () => {}),
    changePassword: vi.fn(async () => {}),
    requestPasswordLink: vi.fn(async () => {}),
    revokeOtherSessions: vi.fn(async () => {}),
    ...overrides,
  };
}

function apiError(status: number, code: string, message: string): ApiError {
  return new ApiError(`A API respondeu ${status}`, status, { code, message });
}

function renderView(client: ProfileClient) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ProfileView client={client} />
    </QueryClientProvider>,
  );
}

async function fillNewPassword(
  user: ReturnType<typeof userEvent.setup>,
  input: { password?: string; confirm?: string } = {},
) {
  const password = input.password ?? "nova12345";
  const confirm = input.confirm ?? password;
  await user.type(screen.getByLabelText("Nova senha"), password);
  await user.type(screen.getByLabelText("Confirmar nova senha"), confirm);
}

describe("Meu perfil: nome", () => {
  it("mostra o nome e o e-mail do usuário", async () => {
    renderView(fakeClient());

    expect(await screen.findByLabelText("Nome")).toHaveValue("Maria");
    expect(screen.getByText("maria@demo.dev")).toBeInTheDocument();
  });

  it("salva o nome novo e recarrega o perfil", async () => {
    const user = userEvent.setup();
    const client = fakeClient();
    renderView(client);

    const field = await screen.findByLabelText("Nome");
    await user.clear(field);
    await user.type(field, "Maria Souza");
    await user.click(screen.getByRole("button", { name: "Salvar" }));

    expect(client.updateName).toHaveBeenCalledWith("Maria Souza");
    expect(await screen.findByText("Nome salvo.")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(client.get).toHaveBeenCalledTimes(2);
  });

  it("mostra o erro da API em role=alert", async () => {
    const user = userEvent.setup();
    const client = fakeClient(TWO_SESSIONS, {
      updateName: vi.fn(async () => {
        throw apiError(400, "INVALID_NAME", "Informe um nome de 1 a 120 caracteres.");
      }),
    });
    renderView(client);

    await screen.findByLabelText("Nome");
    await user.click(screen.getByRole("button", { name: "Salvar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Informe um nome de 1 a 120 caracteres.",
    );
  });
});

describe("Meu perfil: senha", () => {
  it("com senha definida pede a senha atual e troca com confirmação", async () => {
    const user = userEvent.setup();
    const client = fakeClient();
    renderView(client);

    await user.type(await screen.findByLabelText("Senha atual"), "antiga123");
    await fillNewPassword(user);
    await user.click(screen.getByRole("button", { name: "Trocar senha" }));

    expect(client.changePassword).toHaveBeenCalledWith({
      currentPassword: "antiga123",
      newPassword: "nova12345",
    });
    expect(await screen.findByText("Senha alterada.")).toBeInTheDocument();
    expect(client.get).toHaveBeenCalledTimes(2);
  });

  it("confirmação diferente não chama a API", async () => {
    const user = userEvent.setup();
    const client = fakeClient();
    renderView(client);

    await user.type(await screen.findByLabelText("Senha atual"), "antiga123");
    await fillNewPassword(user, { password: "nova12345", confirm: "outra12345" });
    await user.click(screen.getByRole("button", { name: "Trocar senha" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("As senhas não conferem.");
    expect(client.changePassword).not.toHaveBeenCalled();
  });

  it("senha atual errada mostra a mensagem da API", async () => {
    const user = userEvent.setup();
    const client = fakeClient(TWO_SESSIONS, {
      changePassword: vi.fn(async () => {
        throw apiError(400, "INVALID_PASSWORD", "Senha atual incorreta.");
      }),
    });
    renderView(client);

    await user.type(await screen.findByLabelText("Senha atual"), "errada123");
    await fillNewPassword(user);
    await user.click(screen.getByRole("button", { name: "Trocar senha" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Senha atual incorreta.");
    expect(screen.queryByText("Senha alterada.")).not.toBeInTheDocument();
  });

  it("'Não lembro a senha atual' pede o link por e-mail e explica o que acontece depois", async () => {
    const user = userEvent.setup();
    const client = fakeClient();
    renderView(client);

    await user.click(
      await screen.findByRole("button", { name: "Não lembro a senha atual: receber link" }),
    );
    expect(screen.queryByLabelText("Senha atual")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Nova senha")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Receber link por e-mail" }));

    expect(client.requestPasswordLink).toHaveBeenCalledTimes(1);
    expect(client.changePassword).not.toHaveBeenCalled();
    expect(await screen.findByText(/Enviamos um link para o seu e-mail/)).toHaveTextContent(
      "30 minutos",
    );
    expect(screen.getByRole("button", { name: /Reenviar link em \d+ s/ })).toBeDisabled();
  });

  it("sem senha definida esconde a senha atual e oferece só o link por e-mail", async () => {
    const user = userEvent.setup();
    const client = fakeClient({ ...TWO_SESSIONS, hasPassword: false });
    renderView(client);

    await screen.findByLabelText("Nome");
    expect(screen.queryByLabelText("Senha atual")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Não lembro a senha atual: receber link" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/Você ainda não tem senha/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Receber link por e-mail" }));

    expect(client.requestPasswordLink).toHaveBeenCalledTimes(1);
    expect(client.changePassword).not.toHaveBeenCalled();
    expect(await screen.findByText(/Enviamos um link para o seu e-mail/)).toBeInTheDocument();
  });

  it("erro ao pedir o link aparece em role=alert", async () => {
    const user = userEvent.setup();
    const client = fakeClient(TWO_SESSIONS, {
      requestPasswordLink: vi.fn(async () => {
        throw new ApiError("sem rede", 0);
      }),
    });
    renderView(client);

    await user.click(
      await screen.findByRole("button", { name: "Não lembro a senha atual: receber link" }),
    );
    await user.click(screen.getByRole("button", { name: "Receber link por e-mail" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível falar com o servidor",
    );
  });
});

describe("Meu perfil: sessões ativas", () => {
  it("lista as sessões com o aparelho, o último uso em São Paulo e o selo da atual", async () => {
    renderView(fakeClient());

    const list = await screen.findByRole("list", { name: "Sessões ativas" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Chrome no Android");
    expect(items[0]).toHaveTextContent("Esta sessão");
    expect(items[0]).toHaveTextContent("Último uso: 09/11/2026 às 12:30");
    expect(items[1]).toHaveTextContent("Safari no iPhone");
    expect(items[1]).not.toHaveTextContent("Esta sessão");
  });

  it("'Encerrar as outras sessões' chama a API e recarrega", async () => {
    const user = userEvent.setup();
    const client = fakeClient();
    renderView(client);

    await user.click(await screen.findByRole("button", { name: "Encerrar as outras sessões" }));

    expect(client.revokeOtherSessions).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(client.get).toHaveBeenCalledTimes(2));
  });

  it("com só a sessão atual o botão fica desabilitado", async () => {
    renderView(fakeClient({ ...TWO_SESSIONS, sessions: [TWO_SESSIONS.sessions[0] as never] }));

    expect(
      await screen.findByRole("button", { name: "Encerrar as outras sessões" }),
    ).toBeDisabled();
  });

  it("mostra o aparelho como texto, nunca como HTML", async () => {
    renderView(
      fakeClient({
        ...TWO_SESSIONS,
        sessions: [
          {
            device: "<img src=x onerror=alert(1)>",
            lastUsedAt: "2026-11-09T15:30:00.000Z",
            current: true,
          },
        ],
      }),
    );

    const list = await screen.findByRole("list", { name: "Sessões ativas" });
    expect(list.querySelector("img")).toBeNull();
    expect(list).toHaveTextContent("<img src=x onerror=alert(1)>");
  });
});
