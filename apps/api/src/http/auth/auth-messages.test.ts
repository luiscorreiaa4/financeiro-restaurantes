import { describe, expect, it } from "vitest";
import { authError } from "./auth-messages";

describe("authError", () => {
  it("código conhecido do Better Auth vira mensagem em português", () => {
    expect(authError(401, "INVALID_EMAIL_OR_PASSWORD")).toEqual({
      code: "INVALID_EMAIL_OR_PASSWORD",
      message: expect.stringMatching(/^E-mail ou senha incorretos/),
    });
  });

  it("código desconhecido ou ausente cai no código do status, sem texto em inglês", () => {
    expect(authError(400, "VALIDATION_ERROR")).toEqual({
      code: "INVALID_REQUEST",
      message: expect.stringMatching(/Confira os dados/),
    });
    expect(authError(401)).toMatchObject({ code: "UNAUTHORIZED" });
    expect(authError(429, 42)).toMatchObject({ code: "TOO_MANY_REQUESTS" });
    expect(authError(500)).toEqual({
      code: "INTERNAL_ERROR",
      message: expect.stringMatching(/Tente de novo/),
    });
  });

  it("bloqueio de senha não diz se o e-mail existe", () => {
    expect(authError(429, "PASSWORD_LOCKED").message).not.toMatch(/não existe|cadastrad/i);
  });
});
