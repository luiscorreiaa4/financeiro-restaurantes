import { describe, expect, it } from "vitest";
import { describeDevice } from "./describe-device";

const CHROME_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const EDGE_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0";
const FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0";
const CHROME_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const CHROME_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1";

describe("describeDevice (RF02.R8)", () => {
  it("reconhece Chrome no Android", () => {
    expect(describeDevice(CHROME_ANDROID)).toBe("Chrome no Android");
  });

  it("reconhece Safari no iPhone", () => {
    expect(describeDevice(SAFARI_IPHONE)).toBe("Safari no iPhone");
  });

  it("reconhece Edge no Windows antes de Chrome", () => {
    expect(describeDevice(EDGE_WINDOWS)).toBe("Edge no Windows");
  });

  it("reconhece Firefox no Linux", () => {
    expect(describeDevice(FIREFOX_LINUX)).toBe("Firefox no Linux");
  });

  it("reconhece Chrome no Mac", () => {
    expect(describeDevice(CHROME_MAC)).toBe("Chrome no Mac");
  });

  it("reconhece Chrome no iPhone pelo CriOS", () => {
    expect(describeDevice(CHROME_IPHONE)).toBe("Chrome no iPhone");
  });

  it("devolve 'Navegador desconhecido' para vazio, nulo e indefinido", () => {
    expect(describeDevice(undefined)).toBe("Navegador desconhecido");
    expect(describeDevice(null)).toBe("Navegador desconhecido");
    expect(describeDevice("")).toBe("Navegador desconhecido");
  });

  it("navegador conhecido sem sistema devolve só o navegador", () => {
    expect(describeDevice("Chrome/126.0.0.0")).toBe("Chrome");
  });

  it("texto aleatório devolve 'Navegador desconhecido'", () => {
    expect(describeDevice("curl/8.0 qualquer coisa")).toBe("Navegador desconhecido");
  });
});
