import { describe, expect, it } from "vitest";
import { BRAZILIAN_STATES } from "../unit";
import { findOfficialCity, loadMunicipalities, normalizeCityKey } from "./index";

describe("normalizeCityKey", () => {
  it("ignora acento, caixa e espaços repetidos", () => {
    expect(normalizeCityKey("  São   JOSÉ  dos Pinhais ")).toBe("sao jose dos pinhais");
    expect(normalizeCityKey("Maceió")).toBe(normalizeCityKey("maceio"));
  });
});

describe("findOfficialCity", () => {
  const list = ["Maceió", "São Paulo", "Santa Rita"];
  it("devolve a grafia oficial", () => {
    expect(findOfficialCity(list, "maceio")).toBe("Maceió");
    expect(findOfficialCity(list, "  SAO paulo ")).toBe("São Paulo");
  });
  it("devolve null para o que não está na lista", () => {
    expect(findOfficialCity(list, "Cidade Inventada")).toBeNull();
    expect(findOfficialCity(list, "")).toBeNull();
    expect(findOfficialCity(list, "Sao")).toBeNull();
  });
});

describe("cópia do IBGE (DD-29)", () => {
  it("tem lista para as 27 UFs, ordenada e sem duplicata", async () => {
    let total = 0;
    for (const uf of BRAZILIAN_STATES) {
      const list = await loadMunicipalities(uf);
      expect(list.length, uf).toBeGreaterThan(0);
      const keys = list.map(normalizeCityKey);
      expect(new Set(keys).size, `${uf} tem nome repetido`).toBe(list.length);
      expect(
        [...list].sort((a, b) => a.localeCompare(b, "pt-BR")),
        `${uf} fora de ordem`,
      ).toEqual([...list]);
      total += list.length;
    }
    // O Brasil tem 5.570 municípios mais Brasília (DF) no IBGE; folga para criação de municípios.
    expect(total).toBeGreaterThanOrEqual(5500);
    expect(total).toBeLessThanOrEqual(5700);
  });

  it("traz municípios conhecidos nas UFs certas", async () => {
    expect(await loadMunicipalities("AL")).toContain("Maceió");
    expect(await loadMunicipalities("SP")).toContain("São Paulo");
    expect(await loadMunicipalities("MG")).toContain("Belo Horizonte");
    expect(await loadMunicipalities("PE")).not.toContain("Maceió");
  });

  it("aceita UF em minúsculas e recusa UF desconhecida", async () => {
    expect(await loadMunicipalities("al")).toContain("Maceió");
    await expect(loadMunicipalities("ZZ")).rejects.toThrow();
  });
});
