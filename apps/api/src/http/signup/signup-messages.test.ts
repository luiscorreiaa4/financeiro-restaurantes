import { describe, expect, it } from "vitest";
import { signupError } from "./signup-messages";

describe("signupError", () => {
  it("código errado e excesso de tentativas viram mensagens em português", () => {
    expect(signupError(400, "INVALID_CODE")).toEqual({
      code: "INVALID_CODE",
      message: expect.stringMatching(/^Código inválido/),
    });
    expect(signupError(429, "TOO_MANY_ATTEMPTS")).toEqual({
      code: "TOO_MANY_ATTEMPTS",
      message: expect.stringMatching(/peça um novo código/i),
    });
  });

  it("sem código conhecido, cai no código do status", () => {
    expect(signupError(400)).toMatchObject({ code: "INVALID_REQUEST" });
    expect(signupError(500)).toEqual({
      code: "INTERNAL_ERROR",
      message: expect.stringMatching(/Tente de novo/),
    });
  });

  it("nenhuma mensagem diz se o e-mail tem conta", () => {
    for (const code of ["INVALID_CODE", "TOO_MANY_ATTEMPTS", "INVALID_EMAIL"] as const) {
      expect(signupError(400, code).message).not.toMatch(/já tem conta|cadastrad|não existe/i);
    }
  });

  it("celular em uso manda falar com o suporte; e-mail repetido na gravação é genérico (CA05)", () => {
    expect(signupError(409, "PHONE_TAKEN").message).toMatch(/suporte/i);
    expect(signupError(409, "SIGNUP_FAILED").message).not.toMatch(/e-mail|já tem conta|cadastrad/i);
  });
});
