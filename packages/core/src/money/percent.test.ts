import { describe, expect, it } from "vitest";
import { formatBp, parsePercentToBp } from "./percent";

const value = (text: string) => {
  const r = parsePercentToBp(text);
  return r.ok ? r.value : r.error.code;
};

describe("parsePercentToBp", () => {
  it("converte texto em pontos-base", () => {
    expect(value("3,2")).toBe(320);
    expect(value("3,25")).toBe(325);
    expect(value("3.25")).toBe(325);
    expect(value("100")).toBe(10000);
    expect(value("0")).toBe(0);
    expect(value(" 3,20 % ")).toBe(320);
  });

  it("recusa mais de 100 % (RF08.CA05)", () => {
    expect(value("120")).toBe("InvalidFeeRate");
    expect(value("100,01")).toBe("InvalidFeeRate");
  });

  it("recusa mais de 2 casas, negativo e lixo", () => {
    expect(value("3,256")).toBe("InvalidFeeRate");
    expect(value("-1")).toBe("InvalidFeeRate");
    expect(value("")).toBe("InvalidFeeRate");
    expect(value("abc")).toBe("InvalidFeeRate");
  });
});

describe("formatBp", () => {
  it("formata com duas casas e vírgula", () => {
    expect(formatBp(320)).toBe("3,20 %");
    expect(formatBp(0)).toBe("0,00 %");
    expect(formatBp(10000)).toBe("100,00 %");
    expect(formatBp(5)).toBe("0,05 %");
  });
});
