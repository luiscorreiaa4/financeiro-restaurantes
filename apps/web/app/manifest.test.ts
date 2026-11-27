import { describe, expect, it } from "vitest";
import { APP_NAME, APP_SHORT_NAME, BACKGROUND_COLOR, ICONS, THEME_COLOR } from "@/lib/app-identity";
import manifest from "./manifest";

describe("manifest do PWA", () => {
  it("abre em modo standalone", () => {
    expect(manifest().display).toBe("standalone");
  });

  it("começa na raiz", () => {
    expect(manifest().start_url).toBe("/");
  });

  it("tem escopo na raiz", () => {
    expect(manifest().scope).toBe("/");
  });

  it("declara o idioma pt-BR", () => {
    expect(manifest().lang).toBe("pt-BR");
  });

  it("tem id estável na raiz", () => {
    expect(manifest().id).toBe("/");
  });

  it("lista os ícones de app-identity", () => {
    expect(manifest().icons).toEqual(ICONS);
  });

  it("usa a cor do tema de app-identity", () => {
    expect(manifest().theme_color).toBe(THEME_COLOR);
  });

  it("usa a cor de fundo de app-identity", () => {
    expect(manifest().background_color).toBe(BACKGROUND_COLOR);
  });

  it("usa o nome do app", () => {
    expect(manifest().name).toBe(APP_NAME);
  });

  it("usa o nome curto do app", () => {
    expect(manifest().short_name).toBe(APP_SHORT_NAME);
  });
});
