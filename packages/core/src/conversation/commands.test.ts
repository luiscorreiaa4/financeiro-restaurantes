import { describe, expect, it } from "vitest";
import { parseCommand } from "./commands";

describe("comando desfazer", () => {
  it.each(["desfazer", "Desfazer", "DESFAZER", "  desfazer  ", "desfazer!", "Desfazer."])(
    "reconhece %j",
    (text) => {
      expect(parseCommand(text)).toBe("undo");
    },
  );

  it("ignora espaços e quebras de linha nas pontas", () => {
    expect(parseCommand("\n desfazer \t")).toBe("undo");
  });
});

describe("comando ajuda", () => {
  it.each(["ajuda", "Ajuda", "AJUDA", " ajuda ", "ajuda?", "Ajuda!", "ajúda", "AJÚDA"])(
    "reconhece %j",
    (text) => {
      expect(parseCommand(text)).toBe("help");
    },
  );
});

describe("o que não é comando", () => {
  it.each([
    "",
    "   ",
    "desfazer o almoço",
    "me ajuda a lançar",
    "paguei 100 de carne",
    "ajuda desfazer",
    "desfazerr",
  ])("não trata %j como comando", (text) => {
    expect(parseCommand(text)).toBeNull();
  });
});
