import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import type { AuthClient } from "./auth-client";
import { ResetPasswordForm } from "./reset-password-form";

function fakeClient(overrides: Partial<AuthClient> = {}): AuthClient {
  return {
    sendCode: vi.fn(async () => {}),
    signInWithCode: vi.fn(async () => {}),
    signInWithPassword: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
    requestPasswordReset: vi.fn(async () => {}),
    resetPassword: vi.fn(async () => {}),
    ...overrides,
  };
}

function apiError(status: number, code: string, message: string): ApiError {
  return new ApiError(`A API respondeu ${status}`, status, { code, message });
}

async function fill(
  user: ReturnType<typeof userEvent.setup>,
  input: { password?: string; confirm?: string } = {},
) {
  const password = input.password ?? "nova12345";
  const confirm = input.confirm ?? password;
  await user.type(await screen.findByLabelText("Nova senha"), password);
  await user.type(screen.getByLabelText("Confirmar nova senha"), confirm);
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/redefinir-senha#token=abc123");
});

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("nova senha pelo link (RF03, DD-27)", () => {
  it("lê o token do fragmento da URL e o tira da barra de endereço", async () => {
    render(<ResetPasswordForm client={fakeClient()} />);

    expect(await screen.findByLabelText("Nova senha")).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
    expect(window.location.hash).toBe("");
  });

  it("em StrictMode (o next dev roda o efeito duas vezes) o token continua valendo", async () => {
    const user = userEvent.setup();
    const client = fakeClient();
    render(
      <StrictMode>
        <ResetPasswordForm client={client} onDone={() => {}} />
      </StrictMode>,
    );

    await fill(user);
    await user.click(screen.getByRole("button", { name: "Alterar senha" }));

    expect(client.resetPassword).toHaveBeenCalledWith({ token: "abc123", password: "nova12345" });
  });

  it("com sessão aberta, ao concluir encerra a sessão do aparelho antes de ir ao login (RF02.R9)", async () => {
    const user = userEvent.setup();
    const order: string[] = [];
    const client = fakeClient({
      resetPassword: vi.fn(async () => {
        order.push("reset");
      }),
      signOut: vi.fn(async () => {
        order.push("signOut");
      }),
    });
    const onDone = vi.fn(() => order.push("done"));
    render(<ResetPasswordForm client={client} onDone={onDone} />);

    await fill(user);
    await user.click(screen.getByRole("button", { name: "Alterar senha" }));

    expect(order).toEqual(["reset", "signOut", "done"]);
  });

  it("se o sign-out falhar, ainda vai ao login", async () => {
    const user = userEvent.setup();
    const client = fakeClient({
      signOut: vi.fn(async () => {
        throw apiError(500, "internal", "erro");
      }),
    });
    const onDone = vi.fn();
    render(<ResetPasswordForm client={client} onDone={onDone} />);

    await fill(user);
    await user.click(screen.getByRole("button", { name: "Alterar senha" }));

    expect(onDone).toHaveBeenCalled();
  });

  it("conclui: chama resetPassword com o token e a senha, avisa no login e vai para ele", async () => {
    const user = userEvent.setup();
    const client = fakeClient();
    const onDone = vi.fn();
    render(<ResetPasswordForm client={client} onDone={onDone} />);

    await fill(user);
    await user.click(screen.getByRole("button", { name: "Alterar senha" }));

    expect(client.resetPassword).toHaveBeenCalledWith({ token: "abc123", password: "nova12345" });
    expect(onDone).toHaveBeenCalled();
    const stored = JSON.parse(window.sessionStorage.getItem("login:prefill") ?? "null");
    expect(stored).toEqual({ notice: "Senha alterada. Entre com a nova senha." });
    expect(window.sessionStorage.getItem("login:prefill")).not.toContain("nova12345");
    expect(window.sessionStorage.getItem("login:prefill")).not.toContain("abc123");
  });

  it("recusa confirmação diferente sem chamar a API", async () => {
    const user = userEvent.setup();
    const client = fakeClient();
    render(<ResetPasswordForm client={client} onDone={() => {}} />);

    await fill(user, { password: "nova12345", confirm: "outra12345" });
    await user.click(screen.getByRole("button", { name: "Alterar senha" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("As senhas não conferem.");
    expect(client.resetPassword).not.toHaveBeenCalled();
  });

  it("mostra a mensagem de erro da API e mantém o formulário (senha fraca, link ainda vale)", async () => {
    const user = userEvent.setup();
    const client = fakeClient({
      resetPassword: vi.fn(async () => {
        throw apiError(400, "PASSWORD_TOO_SHORT", "A senha precisa ter pelo menos 8 caracteres.");
      }),
    });
    const onDone = vi.fn();
    render(<ResetPasswordForm client={client} onDone={onDone} />);

    await fill(user, { password: "curta1" });
    await user.click(screen.getByRole("button", { name: "Alterar senha" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("pelo menos 8 caracteres");
    expect(screen.getByLabelText("Nova senha")).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("link inválido ou vencido troca o formulário por 'pedir um novo link'", async () => {
    const user = userEvent.setup();
    const client = fakeClient({
      resetPassword: vi.fn(async () => {
        throw apiError(400, "INVALID_TOKEN", "Link inválido ou expirado. Peça um novo.");
      }),
    });
    render(<ResetPasswordForm client={client} onDone={() => {}} />);

    await fill(user);
    await user.click(screen.getByRole("button", { name: "Alterar senha" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Link inválido ou expirado");
    expect(screen.queryByLabelText("Nova senha")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pedir um novo link" })).toHaveAttribute(
      "href",
      "/recuperar-senha",
    );
  });

  it("sem token na URL mostra a mensagem de link inválido e o caminho para pedir outro", async () => {
    window.history.replaceState(null, "", "/redefinir-senha");
    render(<ResetPasswordForm client={fakeClient()} />);

    expect(await screen.findByRole("alert")).toHaveTextContent("Link inválido ou expirado");
    expect(screen.queryByLabelText("Nova senha")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Pedir um novo link" })).toBeInTheDocument();
  });
});
