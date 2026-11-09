import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/client";
import { authErrorCode, authErrorMessage } from "./auth-client";

describe("mensagens de erro do acesso", () => {
  it("usa a message em português da API e expõe o code", () => {
    const error = new ApiError("x", 400, { code: "INVALID_OTP", message: "Código inválido." });

    expect(authErrorMessage(error)).toBe("Código inválido.");
    expect(authErrorCode(error)).toBe("INVALID_OTP");
  });

  it("sem message: texto de reserva por code (código expirado e excesso de tentativas)", () => {
    expect(authErrorMessage(new ApiError("x", 400, { code: "OTP_EXPIRED", message: "" }))).toBe(
      "O código expirou. Peça um novo.",
    );
    expect(
      authErrorMessage(new ApiError("x", 403, { code: "TOO_MANY_ATTEMPTS", message: "" })),
    ).toBe("Muitas tentativas com este código. Peça um novo.");
  });

  it("API fora do ar e erro desconhecido têm texto próprio", () => {
    expect(authErrorMessage(new ApiError("x", 0))).toContain(
      "Não foi possível falar com o servidor",
    );
    expect(authErrorMessage(new Error("boom"))).toBe("Algo deu errado. Tente de novo.");
    expect(authErrorCode(new Error("boom"))).toBeNull();
  });
});
