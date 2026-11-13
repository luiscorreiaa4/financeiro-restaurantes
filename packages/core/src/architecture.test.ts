import { projectFiles } from "archunit";
import { describe, expect, it } from "vitest";
import pkg from "../package.json";

describe("regras de arquitetura do core", () => {
  it("só depende de zod em produção: nada de banco, HTTP ou SDKs", () => {
    expect(Object.keys(pkg.dependencies)).toEqual(["zod"]);
  });

  it("não tem dependências circulares entre os arquivos", async () => {
    const violations = await projectFiles().inFolder("src/**").should().haveNoCycles().check();
    expect(violations).toEqual([]);
    // Lê todos os arquivos do pacote: com a máquina carregada passa dos 5 s padrão (PF2-6).
  }, 30_000);
});
