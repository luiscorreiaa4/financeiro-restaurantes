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

  it("caminho interno válido mantém busca e âncora", () => {
    expect(safeNext("/lancamentos?mes=2026-11#topo")).toBe("/lancamentos?mes=2026-11#topo");
    expect(safeNext("/")).toBe("/");
  });
});
