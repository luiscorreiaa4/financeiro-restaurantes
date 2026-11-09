import { vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import type { SignupApi } from "./signup-api";

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
