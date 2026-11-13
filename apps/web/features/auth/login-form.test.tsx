import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import type { AuthClient } from "./auth-client";
import { LoginForm, RESEND_SECONDS } from "./login-form";

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

afterEach(() => {
  vi.useRealTimers();
  window.sessionStorage.clear();
});

describe("formulário de acesso", () => {
  it("abre no modo código: campo de e-mail e botão 'Enviar código', sem senha", () => {
    render(<LoginForm client={fakeClient()} onSignedIn={() => {}} />);

    expect(screen.getByLabelText("E-mail")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar código" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Senha")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Código de 6 dígitos")).not.toBeInTheDocument();
  });

  it("'Enviar código' mostra a mensagem genérica e o campo de 6 dígitos", async () => {
    const user = userEvent.setup();
    const client = fakeClient();
    render(<LoginForm client={client} onSignedIn={() => {}} />);

    await user.type(screen.getByLabelText("E-mail"), "dono@demo.dev");
    await user.click(screen.getByRole("button", { name: "Enviar código" }));

    expect(client.sendCode).toHaveBeenCalledWith("dono@demo.dev");
    expect(
      await screen.findByText("Se o e-mail estiver cadastrado, você receberá o código."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Código de 6 dígitos")).toBeInTheDocument();
  });

  it("depois do envio o botão de reenviar fica desabilitado com a contagem de 60 s", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<LoginForm client={fakeClient()} onSignedIn={() => {}} />);

    await user.type(screen.getByLabelText("E-mail"), "dono@demo.dev");
    await user.click(screen.getByRole("button", { name: "Enviar código" }));

    expect(RESEND_SECONDS).toBe(60);
    const resend = await screen.findByRole("button", { name: /Reenviar código em \d+ s/ });
    expect(resend).toBeDisabled();

    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByRole("button", { name: /Reenviar código em [1-3]\d s/ })).toBeDisabled();

    await act(async () => {
      vi.advanceTimersByTime(31_000);
    });
    expect(screen.getByRole("button", { name: "Reenviar código" })).toBeEnabled();
  });

  it("código recusado mostra a mensagem da API sem repetir o e-mail e anuncia como alerta", async () => {
    const user = userEvent.setup();
    const client = fakeClient({
      signInWithCode: vi.fn(async () => {
        throw apiError(400, "INVALID_OTP", "Código inválido. Confira e tente de novo.");
      }),
    });
    render(<LoginForm client={client} onSignedIn={() => {}} />);

    await user.type(screen.getByLabelText("E-mail"), "dono@demo.dev");
    await user.click(screen.getByRole("button", { name: "Enviar código" }));
    await user.type(await screen.findByLabelText("Código de 6 dígitos"), "000000");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Código inválido. Confira e tente de novo.");
    expect(alert).not.toHaveTextContent("dono@demo.dev");
  });

  it("envia sozinho ao completar o sexto dígito, com o 'manter conectado' já marcado", async () => {
    const user = userEvent.setup();
    const client = fakeClient();
    const onSignedIn = vi.fn();
    render(<LoginForm client={client} onSignedIn={onSignedIn} />);

    await user.type(screen.getByLabelText("E-mail"), "dono@demo.dev");
    await user.click(screen.getByRole("button", { name: "Enviar código" }));
    await screen.findByLabelText("Código de 6 dígitos");
    await user.click(screen.getByLabelText("Manter conectado"));
    await user.type(screen.getByLabelText("Código de 6 dígitos"), "123456");

    expect(client.signInWithCode).toHaveBeenCalledTimes(1);
    expect(client.signInWithCode).toHaveBeenCalledWith({
      email: "dono@demo.dev",
      otp: "123456",
      rememberMe: true,
    });
    expect(onSignedIn).toHaveBeenCalledTimes(1);
  });

  it("não envia duas vezes se o formulário for enviado durante o envio automático", async () => {
    const user = userEvent.setup();
    const client = fakeClient({ signInWithCode: vi.fn(() => new Promise<void>(() => {})) });
    render(<LoginForm client={client} onSignedIn={() => {}} />);

    await user.type(screen.getByLabelText("E-mail"), "dono@demo.dev");
    await user.click(screen.getByRole("button", { name: "Enviar código" }));
    await user.type(await screen.findByLabelText("Código de 6 dígitos"), "123456");
    // Enter no campo envia o formulário mesmo com o botão desabilitado.
    await user.keyboard("{Enter}");

    expect(screen.getByRole("button", { name: "Entrar" })).toBeDisabled();
    expect(client.signInWithCode).toHaveBeenCalledTimes(1);
  });

  it("depois de código inválido, completar um novo código envia de novo", async () => {
    const user = userEvent.setup();
    const signInWithCode = vi
      .fn()
      .mockRejectedValueOnce(apiError(400, "INVALID_OTP", "Código inválido."))
      .mockResolvedValueOnce(undefined);
    const onSignedIn = vi.fn();
    render(<LoginForm client={fakeClient({ signInWithCode })} onSignedIn={onSignedIn} />);

    await user.type(screen.getByLabelText("E-mail"), "dono@demo.dev");
    await user.click(screen.getByRole("button", { name: "Enviar código" }));
    await user.type(await screen.findByLabelText("Código de 6 dígitos"), "000000");
    await screen.findByRole("alert");
    await user.clear(screen.getByLabelText("Código de 6 dígitos"));
    await user.type(screen.getByLabelText("Código de 6 dígitos"), "123456");

    expect(signInWithCode).toHaveBeenCalledTimes(2);
    expect(signInWithCode).toHaveBeenLastCalledWith(expect.objectContaining({ otp: "123456" }));
    expect(onSignedIn).toHaveBeenCalledTimes(1);
  });

  it("depois de código inválido, clicar em 'Entrar' sem mudar o campo envia o mesmo código de novo", async () => {
    const user = userEvent.setup();
    const signInWithCode = vi
      .fn()
      .mockRejectedValueOnce(apiError(400, "INVALID_OTP", "Código inválido."))
      .mockResolvedValueOnce(undefined);
    const onSignedIn = vi.fn();
    render(<LoginForm client={fakeClient({ signInWithCode })} onSignedIn={onSignedIn} />);

    await user.type(screen.getByLabelText("E-mail"), "dono@demo.dev");
    await user.click(screen.getByRole("button", { name: "Enviar código" }));
    await user.type(await screen.findByLabelText("Código de 6 dígitos"), "000000");
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Entrar" }));

    expect(signInWithCode).toHaveBeenCalledTimes(2);
    expect(signInWithCode).toHaveBeenLastCalledWith(expect.objectContaining({ otp: "000000" }));
    expect(onSignedIn).toHaveBeenCalledTimes(1);
  });

  it("durante o envio o código não pode ser editado; depois do erro o campo volta com o foco", async () => {
    const user = userEvent.setup();
    let reject: (cause: unknown) => void = () => {};
    const signInWithCode = vi.fn(
      () =>
        new Promise<void>((_, fail) => {
          reject = fail;
        }),
    );
    render(<LoginForm client={fakeClient({ signInWithCode })} onSignedIn={() => {}} />);

    await user.type(screen.getByLabelText("E-mail"), "dono@demo.dev");
    await user.click(screen.getByRole("button", { name: "Enviar código" }));
    await user.type(await screen.findByLabelText("Código de 6 dígitos"), "000000");

    expect(screen.getByLabelText("Código de 6 dígitos")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Colar código" })).toBeDisabled();

    await act(async () => {
      reject(apiError(400, "INVALID_OTP", "Código inválido."));
    });

    await screen.findByRole("alert");
    expect(screen.getByLabelText("Código de 6 dígitos")).toBeEnabled();
    expect(screen.getByLabelText("Código de 6 dígitos")).toHaveFocus();
  });

  it("tem o botão 'Colar código' no passo do código", async () => {
    const user = userEvent.setup();
    render(<LoginForm client={fakeClient()} onSignedIn={() => {}} />);

    await user.type(screen.getByLabelText("E-mail"), "dono@demo.dev");
    await user.click(screen.getByRole("button", { name: "Enviar código" }));

    expect(await screen.findByRole("button", { name: "Colar código" })).toBeInTheDocument();
  });

  it("'Entrar com senha' troca os campos e 'Entrar com código' volta", async () => {
    const user = userEvent.setup();
    render(<LoginForm client={fakeClient()} onSignedIn={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Entrar com senha" }));

    expect(screen.getByLabelText("E-mail")).toBeInTheDocument();
    expect(screen.getByLabelText("Senha")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Enviar código" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Entrar com código" }));
    expect(screen.queryByLabelText("Senha")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar código" })).toBeInTheDocument();
  });

  it("senha: envia e-mail, senha e rememberMe; erro e bloqueio aparecem em português", async () => {
    const user = userEvent.setup();
    const signInWithPassword = vi
      .fn()
      .mockRejectedValueOnce(
        apiError(401, "INVALID_EMAIL_OR_PASSWORD", "E-mail ou senha incorretos."),
      )
      .mockRejectedValueOnce(
        apiError(429, "PASSWORD_LOCKED", "Muitas tentativas. Use o código ou tente em 15 minutos."),
      );
    render(<LoginForm client={fakeClient({ signInWithPassword })} onSignedIn={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Entrar com senha" }));
    await user.type(screen.getByLabelText("E-mail"), "dono@demo.dev");
    await user.type(screen.getByLabelText("Senha"), "errada123");
    await user.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("E-mail ou senha incorretos.");
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "dono@demo.dev",
      password: "errada123",
      rememberMe: false,
    });

    await user.click(screen.getByRole("button", { name: "Entrar" }));
    expect(await screen.findByText(/Muitas tentativas/)).toBeInTheDocument();
  });

  it("API fora do ar mostra aviso genérico em português", async () => {
    const user = userEvent.setup();
    const client = fakeClient({
      sendCode: vi.fn(async () => {
        throw new ApiError("API indisponível", 0);
      }),
    });
    render(<LoginForm client={client} onSignedIn={() => {}} />);

    await user.type(screen.getByLabelText("E-mail"), "dono@demo.dev");
    await user.click(screen.getByRole("button", { name: "Enviar código" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível falar com o servidor",
    );
  });

  it("colar o código com espaço ('123 456') mantém só os 6 dígitos", async () => {
    const user = userEvent.setup();
    render(<LoginForm client={fakeClient()} onSignedIn={() => {}} />);
    await user.type(screen.getByLabelText("E-mail"), "dono@demo.dev");
    await user.click(screen.getByRole("button", { name: "Enviar código" }));

    const field = await screen.findByLabelText("Código de 6 dígitos");
    await user.click(field);
    await user.paste("123 456 789");

    const digits = screen.getAllByLabelText(/^(Código de 6 dígitos|Dígito \d de 6)$/);
    expect(digits.map((box) => (box as HTMLInputElement).value).join("")).toBe("123456");
  });

  it("trocar o e-mail depois de enviar o código volta ao passo de envio", async () => {
    const user = userEvent.setup();
    render(<LoginForm client={fakeClient()} onSignedIn={() => {}} />);
    await user.type(screen.getByLabelText("E-mail"), "dono@demo.dev");
    await user.click(screen.getByRole("button", { name: "Enviar código" }));
    await screen.findByLabelText("Código de 6 dígitos");

    await user.type(screen.getByLabelText("E-mail"), "x");

    expect(screen.queryByLabelText("Código de 6 dígitos")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar código" })).toBeInTheDocument();
  });

  it("código expirado ou com excesso de tentativas volta ao envio com a mensagem", async () => {
    for (const code of ["OTP_EXPIRED", "TOO_MANY_ATTEMPTS"]) {
      const user = userEvent.setup();
      const client = fakeClient({
        signInWithCode: vi.fn(async () => {
          throw apiError(400, code, "Peça um novo código.");
        }),
      });
      const { unmount } = render(<LoginForm client={client} onSignedIn={() => {}} />);
      await user.type(screen.getByLabelText("E-mail"), "dono@demo.dev");
      await user.click(screen.getByRole("button", { name: "Enviar código" }));
      await user.type(await screen.findByLabelText("Código de 6 dígitos"), "123456");

      expect(await screen.findByRole("alert")).toHaveTextContent("Peça um novo código.");
      expect(screen.queryByLabelText("Código de 6 dígitos")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Enviar código" })).toBeEnabled();
      unmount();
    }
  });

  it("campo com erro recebe aria-invalid e aria-describedby apontando para a mensagem", async () => {
    const user = userEvent.setup();
    const client = fakeClient({
      signInWithCode: vi.fn(async () => {
        throw apiError(400, "INVALID_OTP", "Código inválido.");
      }),
    });
    render(<LoginForm client={client} onSignedIn={() => {}} />);
    await user.type(screen.getByLabelText("E-mail"), "dono@demo.dev");
    await user.click(screen.getByRole("button", { name: "Enviar código" }));
    const field = await screen.findByLabelText("Código de 6 dígitos");
    expect(field).not.toHaveAttribute("aria-invalid", "true");
    await user.type(field, "000000");

    const alert = await screen.findByRole("alert");
    expect(screen.getByLabelText("Código de 6 dígitos")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Código de 6 dígitos")).toHaveAttribute(
      "aria-describedby",
      alert.id,
    );
  });

  it("tem o link 'Criar conta' para o cadastro", () => {
    render(<LoginForm client={fakeClient()} onSignedIn={() => {}} />);

    expect(screen.getByRole("link", { name: "Criar conta" })).toHaveAttribute("href", "/cadastro");
  });

  it("a região de status já existe vazia antes do envio (leitores de tela anunciam a troca)", () => {
    render(<LoginForm client={fakeClient()} onSignedIn={() => {}} />);

    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});

describe("recuperação de acesso no login (RF03, RF02.R2)", () => {
  it("o link 'Esqueci a senha' e a dica só aparecem no modo senha", async () => {
    const user = userEvent.setup();
    render(<LoginForm client={fakeClient()} onSignedIn={() => {}} />);

    expect(screen.queryByRole("link", { name: "Esqueci a senha" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Ainda não tem senha\?/)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Entrar com senha" }));

    expect(screen.getByRole("link", { name: "Esqueci a senha" })).toHaveAttribute(
      "href",
      "/recuperar-senha",
    );
    expect(
      screen.getByText("Ainda não tem senha? Entre com o código ou toque em Esqueci a senha."),
    ).toBeInTheDocument();
  });

  it("com login:prefill abre no modo senha com o e-mail preenchido e remove a chave", async () => {
    window.sessionStorage.setItem("login:prefill", JSON.stringify({ email: "dono@demo.dev" }));
    render(<LoginForm client={fakeClient()} onSignedIn={() => {}} />);

    expect(await screen.findByLabelText("Senha")).toBeInTheDocument();
    expect(screen.getByLabelText("E-mail")).toHaveValue("dono@demo.dev");
    expect(window.sessionStorage.getItem("login:prefill")).toBeNull();
  });

  it("login:prefill só com aviso (vindo do link de recuperação) abre no modo senha e mostra o aviso", async () => {
    window.sessionStorage.setItem(
      "login:prefill",
      JSON.stringify({ notice: "Senha alterada. Entre com a nova senha." }),
    );
    render(<LoginForm client={fakeClient()} onSignedIn={() => {}} />);

    expect(await screen.findByLabelText("Senha")).toBeInTheDocument();
    expect(screen.getByLabelText("E-mail")).toHaveValue("");
    expect(screen.getByText("Senha alterada. Entre com a nova senha.")).toBeInTheDocument();
    expect(window.sessionStorage.getItem("login:prefill")).toBeNull();
  });

  it("login:prefill torto é ignorado e removido", async () => {
    window.sessionStorage.setItem("login:prefill", "não é json");
    render(<LoginForm client={fakeClient()} onSignedIn={() => {}} />);

    expect(screen.queryByLabelText("Senha")).not.toBeInTheDocument();
    expect(screen.getByLabelText("E-mail")).toHaveValue("");
    expect(window.sessionStorage.getItem("login:prefill")).toBeNull();
  });
});

describe("empresa sem unidade ativa (RF02.CA10)", () => {
  const ORIENTATION =
    "Sua empresa está sem unidade ativa. Peça ao dono da empresa para reativar uma unidade.";

  it("senha certa de quem não pode entrar mostra a orientação do NO_ACTIVE_UNIT", async () => {
    const user = userEvent.setup();
    const client = fakeClient({
      signInWithPassword: vi.fn(async () => {
        throw apiError(403, "NO_ACTIVE_UNIT", "texto do servidor");
      }),
    });
    render(<LoginForm client={client} onSignedIn={() => {}} />);

    await user.click(screen.getByRole("button", { name: "Entrar com senha" }));
    await user.type(screen.getByLabelText("E-mail"), "gerente@demo.dev");
    await user.type(screen.getByLabelText("Senha"), "senha-certa-123");
    await user.click(screen.getByRole("button", { name: "Entrar" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(ORIENTATION);
  });

  it("código certo de quem não pode entrar mostra a mesma orientação", async () => {
    const user = userEvent.setup();
    const client = fakeClient({
      signInWithCode: vi.fn(async () => {
        throw apiError(403, "NO_ACTIVE_UNIT", "");
      }),
    });
    render(<LoginForm client={client} onSignedIn={() => {}} />);

    await user.type(screen.getByLabelText("E-mail"), "gerente@demo.dev");
    await user.click(screen.getByRole("button", { name: "Enviar código" }));
    await user.type(await screen.findByLabelText("Código de 6 dígitos"), "123456");

    expect(await screen.findByRole("alert")).toHaveTextContent(ORIENTATION);
  });
});
