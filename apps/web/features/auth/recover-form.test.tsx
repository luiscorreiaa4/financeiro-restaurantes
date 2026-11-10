import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import type { AuthClient } from "./auth-client";
import { RecoverForm } from "./recover-form";

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

const SENT =
  "Se o e-mail estiver cadastrado, você receberá um link para criar uma nova senha. Ele vale por 30 minutos.";

afterEach(() => {
  vi.useRealTimers();
});

describe("pedido do link de recuperação (RF03, DD-27)", () => {
  it("pede o link e mostra a mensagem fixa, sem revelar se o e-mail existe", async () => {
    const user = userEvent.setup();
    const client = fakeClient();
    render(<RecoverForm client={client} />);

    await user.type(screen.getByLabelText("E-mail"), "dono@demo.dev");
    await user.click(screen.getByRole("button", { name: "Enviar link" }));

    expect(client.requestPasswordReset).toHaveBeenCalledWith("dono@demo.dev");
    expect(await screen.findByText(SENT)).toBeInTheDocument();
  });

  it("não tem campo de código nem de senha", () => {
    render(<RecoverForm client={fakeClient()} />);

    expect(screen.queryByLabelText(/código/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/senha/i)).not.toBeInTheDocument();
  });

  it("com erro de rede mostra o texto de conexão e não a mensagem fixa", async () => {
    const user = userEvent.setup();
    const client = fakeClient({
      requestPasswordReset: vi.fn(async () => {
        throw new ApiError("sem rede", 0);
      }),
    });
    render(<RecoverForm client={client} />);

    await user.type(screen.getByLabelText("E-mail"), "dono@demo.dev");
    await user.click(screen.getByRole("button", { name: "Enviar link" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Não foi possível falar com o servidor",
    );
    expect(screen.queryByText(SENT)).not.toBeInTheDocument();
  });

  it("depois do envio o reenvio fica desabilitado com a contagem de 60 s", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<RecoverForm client={fakeClient()} />);

    await user.type(screen.getByLabelText("E-mail"), "dono@demo.dev");
    await user.click(screen.getByRole("button", { name: "Enviar link" }));

    const resend = await screen.findByRole("button", { name: /Reenviar link em \d+ s/ });
    expect(resend).toBeDisabled();
  });

  it("trocar o e-mail volta ao passo de envio", async () => {
    const user = userEvent.setup();
    render(<RecoverForm client={fakeClient()} />);

    await user.type(screen.getByLabelText("E-mail"), "dono@demo.dev");
    await user.click(screen.getByRole("button", { name: "Enviar link" }));
    await screen.findByText(SENT);
    await user.type(screen.getByLabelText("E-mail"), "x");

    expect(screen.queryByText(SENT)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar link" })).toBeInTheDocument();
  });
});
