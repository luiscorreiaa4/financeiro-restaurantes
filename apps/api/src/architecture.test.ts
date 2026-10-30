import { projectFiles } from "archunit";
import { describe, expect, it } from "vitest";

describe("regras de arquitetura da api", () => {
  it("não tem dependências circulares entre os arquivos", async () => {
    const violations = await projectFiles().inFolder("src/**").should().haveNoCycles().check();
    expect(violations).toEqual([]);
  });

  it("casos de uso (modules) não dependem de HTTP nem do chat de desenvolvimento", async () => {
    for (const camada of ["src/http/**", "src/dev/**"]) {
      const violations = await projectFiles()
        .inFolder("src/modules/**")
        .shouldNot()
        .dependOnFiles()
        .inFolder(camada)
        .check();
      expect(violations, camada).toEqual([]);
    }
  });

  it("rotas HTTP não dependem da infraestrutura nem do chat de desenvolvimento", async () => {
    for (const camada of ["src/infra/**", "src/dev/**"]) {
      const violations = await projectFiles()
        .inFolder("src/http/**")
        .shouldNot()
        .dependOnFiles()
        .inFolder(camada)
        .check();
      expect(violations, camada).toEqual([]);
    }
  });
});
