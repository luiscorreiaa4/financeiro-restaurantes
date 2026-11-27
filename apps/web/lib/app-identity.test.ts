import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ICONS } from "./app-identity";

const publicDir = path.join(__dirname, "..", "public");

describe("identidade do app", () => {
  it("ícones do manifest existem em public", () => {
    for (const icon of ICONS) {
      expect(fs.existsSync(path.join(publicDir, icon.src)), icon.src).toBe(true);
    }
  });

  it("há um maskable 512", () => {
    expect(
      ICONS.some(
        (i) => i.purpose === "maskable" && i.sizes === "512x512" && i.type === "image/png",
      ),
    ).toBe(true);
  });

  it("há ícones any de 192 e 512", () => {
    const any = ICONS.filter((i) => i.purpose === "any").map((i) => i.sizes);
    expect(any).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  });

  it("apple-touch e favicon existem", () => {
    expect(fs.existsSync(path.join(publicDir, "icons", "apple-touch-icon.png"))).toBe(true);
    expect(fs.existsSync(path.join(publicDir, "icons", "favicon-32.png"))).toBe(true);
  });
});
