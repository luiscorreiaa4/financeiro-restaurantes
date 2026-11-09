import { describe, expect, it } from "vitest";
import { parsePublicEnv, parseWebEnv } from "./env";

describe("variáveis públicas do web", () => {
  it("aceita o número do WhatsApp com +, espaços, parênteses e hífen", () => {
    expect(
      parsePublicEnv({ NEXT_PUBLIC_WHATSAPP_NUMBER: "+55 (82) 99999-0000" })
        .NEXT_PUBLIC_WHATSAPP_NUMBER,
    ).toBe("+55 (82) 99999-0000");
  });

  it("sem número (ou vazio) fica indefinido: a tela mostra um aviso", () => {
    expect(parsePublicEnv({}).NEXT_PUBLIC_WHATSAPP_NUMBER).toBeUndefined();
    expect(
      parsePublicEnv({ NEXT_PUBLIC_WHATSAPP_NUMBER: "  " }).NEXT_PUBLIC_WHATSAPP_NUMBER,
    ).toBeUndefined();
  });

  it("rejeita número que não é telefone", () => {
    expect(() => parsePublicEnv({ NEXT_PUBLIC_WHATSAPP_NUMBER: "fale-conosco" })).toThrow();
    expect(() => parsePublicEnv({ NEXT_PUBLIC_WHATSAPP_NUMBER: "12345" })).toThrow();
  });
});

describe("ambiente do web", () => {
  it("aceita API_URL com uma URL válida", () => {
    expect(parseWebEnv({ API_URL: "http://localhost:4000" })).toEqual({
      API_URL: "http://localhost:4000",
    });
  });

  it("rejeita API_URL ausente", () => {
    expect(() => parseWebEnv({})).toThrow();
  });

  it("rejeita API_URL que não é URL", () => {
    expect(() => parseWebEnv({ API_URL: "nao-e-url" })).toThrow();
  });
});
