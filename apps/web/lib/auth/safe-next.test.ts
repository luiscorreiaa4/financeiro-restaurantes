import { describe, expect, it } from "vitest";
import { safeNext } from "./safe-next";

describe("destino depois do login (safeNext)", () => {
  it("recusa tudo que sai do site", () => {
    const evil = [
      "//evil.com",
      "///evil.com",
      "/\\evil.com",
      "/\t/evil.com",
      "/\n/evil.com",
      "/\r/evil.com",
      "https://evil.com",
      "javascript:alert(1)",
      "evil.com",
    ];
    for (const value of evil) expect(safeNext(value), JSON.stringify(value)).toBe("/");
  });

  it("TAB codificado (%09) é só um caminho interno, nunca um host", () => {
    expect(safeNext("/%09/evil.com")).toBe("/%09/evil.com");
  });

  it("parâmetro repetido (array), vazio ou ausente", () => {
    expect(safeNext(["//evil.com", "/lancamentos"])).toBe("/");
    expect(safeNext(["/lancamentos"])).toBe("/lancamentos");
    expect(safeNext("")).toBe("/");
    expect(safeNext(undefined)).toBe("/");
  });

  it("telas de acesso e rotas da API nunca são destino (sem laço de redirecionamento)", () => {
    const refused = [
      "/login",
      "/login/",
      "/login?x=1",
      "/login#a",
      "/LOGIN",
      "/%6cogin",
      "/login?next=/login",
      "/cadastro",
      "/cadastro/",
      "/recuperar-senha",
      "/recuperar-senha?x=1",
      "/api",
      "/api/",
      "/api/auth/sign-out",
      "/API/auth/sign-out",
      "/api?x=1",
    ];
    for (const value of refused) expect(safeNext(value), value).toBe("/");
  });

  it("barras codificadas (%2F) não viram host nem escondem tela de acesso ou API (PF2-7)", () => {
    // Continua caminho interno: o navegador não decodifica %2F para decidir o host.
    expect(safeNext("/%2F%2Fevil.com")).toBe("/%2F%2Fevil.com");
    expect(safeNext("/%2Fevil.com")).toBe("/%2Fevil.com");
    for (const next of ["/api%2Fme", "/API%2fme", "/login%2F", "/%2e%2e/api/me"]) {
      expect(safeNext(next), next).toBe("/");
    }
  });

  it("/redefinir-senha e caminhos parecidos continuam aceitos", () => {
    expect(safeNext("/redefinir-senha")).toBe("/redefinir-senha");
    expect(safeNext("/login-ajuda")).toBe("/login-ajuda");
    expect(safeNext("/apis")).toBe("/apis");
  });

  it("caminho interno válido mantém busca e âncora", () => {
    expect(safeNext("/lancamentos?mes=2026-11#topo")).toBe("/lancamentos?mes=2026-11#topo");
    expect(safeNext("/")).toBe("/");
  });
});
