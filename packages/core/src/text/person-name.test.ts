import { describe, expect, it } from "vitest";
import { normalizePersonName } from "./person-name";

describe("normalizePersonName", () => {
  it("recusa nome só com U+200B ou U+3164", () => {
    expect(normalizePersonName("​​")).toBeNull();
    expect(normalizePersonName("ㅤㅤ")).toBeNull();
  });

  it("recusa nome só com U+FE0F, U+115F, U+1160, U+FFA0 ou U+2800", () => {
    for (const ch of ["️", "ᅟ", "ᅠ", "ﾠ", "⠀"]) {
      expect(normalizePersonName(ch + ch), ch.codePointAt(0)?.toString(16)).toBeNull();
    }
  });

  it("recusa vazio, só espaços e só pontuação", () => {
    expect(normalizePersonName("")).toBeNull();
    expect(normalizePersonName("   ")).toBeNull();
    expect(normalizePersonName("...")).toBeNull();
  });

  it("grava José em NFD como NFC", () => {
    const nfd = "José";
    expect(nfd.length).toBe(5);
    expect(normalizePersonName(nfd)).toBe("José");
  });

  it("remove U+00AD, U+FEFF, quebra de linha e tab no meio", () => {
    expect(normalizePersonName("A­n﻿a\nMa\tria")).toBe("AnaMaria");
  });

  it("mantém espaços internos comuns e apara as pontas", () => {
    expect(normalizePersonName("  Ana  Maria  ")).toBe("Ana  Maria");
  });

  it("aceita nome só com número", () => {
    expect(normalizePersonName("123")).toBe("123");
  });
});
