import { screen, waitFor } from "@testing-library/react";
import type userEvent from "@testing-library/user-event";
import { expect, vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import type { SignupApi } from "./signup-api";

/**
 * Escolhe o município na lista, como o usuário: digita para filtrar e clica na opção.
 * Escolha o estado antes: sem UF o campo fica desabilitado.
 */
export async function pickCity(user: ReturnType<typeof userEvent.setup>, name: string) {
  const input = screen.getByLabelText("Município");
  await waitFor(() => expect(input).toBeEnabled());
  await user.type(input, name);
  await user.click(await screen.findByRole("option", { name }));
}

/** API falsa do cadastro: tudo dá certo, a não ser o que o teste trocar. */
export function fakeSignupApi(overrides: Partial<SignupApi> = {}): SignupApi {
  return {
    requestCode: vi.fn(async () => {}),
    verifyCode: vi.fn(async () => ({ receipt: "comprovante-1" })),
    submitSignup: vi.fn(async () => ({ tenantId: "tenant-1" })),
    submitCompany: vi.fn(async () => ({ tenantId: "tenant-2" })),
    ...overrides,
  };
}

export function apiError(
  status: number,
  code: string,
  message: string,
  fields?: Record<string, string>,
): ApiError {
  return new ApiError(`A API respondeu ${status}`, status, {
    code,
    message,
    ...(fields ? { fields } : {}),
  });
}
