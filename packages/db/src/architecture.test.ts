import { projectFiles } from "archunit";
import { describe, expect, it } from "vitest";

describe("regras de arquitetura do db", () => {
  it("não tem dependências circulares entre os arquivos", async () => {
    const violations = await projectFiles().inFolder("src/**").should().haveNoCycles().check();
    expect(violations).toEqual([]);
  });
});
