import type { TenantExtractionContext } from "@app/core";
import { describe, expect, it } from "vitest";
import { buildSystem, buildUserText } from "./prompt";

const context: TenantExtractionContext = {
  categories: ["Carnes", "Bebidas", "Bebidas"],
  suppliers: ["Atacadão"],
  units: ["Centro"],
  paymentMethods: ["Pix"],
};

describe("prompt de extração", () => {
  it("mantém idêntico o prefixo cacheável entre duas mensagens do mesmo tenant", () => {
    const a = buildSystem(context);
    const b = buildSystem({ ...context, categories: ["Bebidas", "Carnes"] });
    expect(a).toEqual(b);
    // O texto e a data de hoje ficam fora do system, depois do ponto de cache.
    const joined = a.map((block) => block.text).join("\n");
    expect(joined).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("marca o cache só no último bloco do system", () => {
    expect(buildSystem(context).map((block) => block.cache)).toEqual([false, true]);
  });

  it("não repete item da lista e ordena por nome", () => {
    const text = buildSystem(context)[1]?.text ?? "";
    expect(text).toContain("Categorias:\nBebidas\nCarnes\n");
  });

  it("leva a data de hoje e a mensagem na parte do usuário", () => {
    const text = buildUserText({ today: "2026-10-30", text: " camarão 450 " });
    expect(text).toContain("Data de hoje: 2026-10-30");
    expect(text).toContain('"""\ncamarão 450\n"""');
  });

  it("avisa quando a mensagem é só imagem", () => {
    expect(buildUserText({ today: "2026-10-30" })).toContain("somente imagem");
  });

  it("não instrui a IA a atender assuntos gerais", () => {
    const rules = buildSystem(context)[0]?.text ?? "";
    expect(rules).toContain("out_of_scope");
    expect(rules).not.toMatch(/responda qualquer/i);
  });
});
