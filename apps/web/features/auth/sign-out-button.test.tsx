import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import type { AuthClient } from "./auth-client";
import { SignOutButton } from "./sign-out-button";

function client(signOut: AuthClient["signOut"]): AuthClient {
  return { signOut } as AuthClient;
}

describe("botão Sair", () => {
  it("sair com sucesso leva ao /login", async () => {
    const user = userEvent.setup();
    const onSignedOut = vi.fn();
    render(<SignOutButton client={client(async () => {})} onSignedOut={onSignedOut} />);

    await user.click(screen.getByRole("button", { name: "Sair" }));

    expect(onSignedOut).toHaveBeenCalledTimes(1);
  });

  it("se a API falhar, mostra o erro e não age como se tivesse saído", async () => {
    const user = userEvent.setup();
    const onSignedOut = vi.fn();
    const failing = client(async () => {
      throw new ApiError("x", 0);
    });
    render(<SignOutButton client={failing} onSignedOut={onSignedOut} />);

    await user.click(screen.getByRole("button", { name: "Sair" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Não foi possível sair");
    expect(onSignedOut).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Sair" })).toBeEnabled();
  });
});
