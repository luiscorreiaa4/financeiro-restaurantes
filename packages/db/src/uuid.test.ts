import { isUuidV7 } from "@app/core";
import { describe, expect, it } from "vitest";
import { uuidv7 } from "./uuid";

describe("uuidv7", () => {
  it("gera um UUID v7 válido para o domínio", () => {
    for (let i = 0; i < 50; i++) expect(isUuidV7(uuidv7())).toBe(true);
  });

  it("grava o timestamp nos 48 primeiros bits, versão 7 e variante 10", () => {
    const id = uuidv7({ now: 0x0123_4567_89ab, random: new Uint8Array(10).fill(0xff) });
    expect(id).toBe("01234567-89ab-7fff-bfff-ffffffffffff");
  });

  it("ordena por tempo: ids de instantes posteriores são maiores", () => {
    const ids = [1_000, 2_000, 1_700_000_000_000, 1_700_000_000_001].map((now) => uuidv7({ now }));
    expect([...ids].sort()).toEqual(ids);
  });

  it("gera ids diferentes no mesmo milissegundo", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uuidv7({ now: 1_700_000_000_000 })));
    expect(ids.size).toBe(1000);
  });

  it("aceita o menor e o maior timestamp de 48 bits", () => {
    expect(uuidv7({ now: 0 }).startsWith("00000000-0000-7")).toBe(true);
    expect(uuidv7({ now: 0xffff_ffff_ffff }).startsWith("ffffffff-ffff-7")).toBe(true);
  });

  it("rejeita timestamp negativo, fracionário ou acima de 48 bits", () => {
    expect(() => uuidv7({ now: -1 })).toThrow(RangeError);
    expect(() => uuidv7({ now: 1.5 })).toThrow(RangeError);
    expect(() => uuidv7({ now: 0x1_0000_0000_0000 })).toThrow(RangeError);
  });

  it("rejeita entropia insuficiente", () => {
    expect(() => uuidv7({ random: new Uint8Array(9) })).toThrow(RangeError);
  });
});
