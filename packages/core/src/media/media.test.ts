import { describe, expect, it } from "vitest";
import {
  accessKeyParts,
  cbrAudioSeconds,
  DEFAULT_USAGE_LIMITS,
  evaluateRateLimit,
  isValidAccessKey,
  parseNfceQr,
} from "./index";

// 43 dígitos + dígito verificador (módulo 11) calculado à mão para o teste.
const KEY = "35261012345678000190650010000001231000001235";

describe("chave de acesso da NFC-e", () => {
  it("aceita chave com dígito verificador certo", () => {
    expect(isValidAccessKey(KEY)).toBe(true);
  });

  it("recusa dígito verificador errado, tamanho errado e letras", () => {
    expect(isValidAccessKey(`${KEY.slice(0, 43)}0`)).toBe(false);
    expect(isValidAccessKey(KEY.slice(1))).toBe(false);
    expect(isValidAccessKey(`${KEY.slice(0, 43)}x`)).toBe(false);
  });

  it("separa a UF e o CNPJ do emitente", () => {
    expect(isValidAccessKey(KEY) && accessKeyParts(KEY)).toEqual({
      ufCode: "35",
      issuerCnpj: "12345678000190",
    });
  });
});

describe("QR Code da NFC-e", () => {
  it("lê a chave no formato da versão 2 (?p=chave|...)", () => {
    const url = `https://www.nfce.fazenda.sp.gov.br/qrcode?p=${KEY}|2|1|1|ABCDEF123`;
    expect(parseNfceQr(url)).toBe(KEY);
  });

  it("lê a chave no formato antigo (chNFe=)", () => {
    expect(parseNfceQr(`http://exemplo.gov.br/consulta?chNFe=${KEY}&nVersao=100`)).toBe(KEY);
  });

  it("lê a chave solta no texto", () => {
    expect(parseNfceQr(`NFCe ${KEY} fim`)).toBe(KEY);
  });

  it("ignora QR sem chave ou com chave inválida (nada de valor inventado)", () => {
    expect(parseNfceQr("https://pix.exemplo.com/abc")).toBeNull();
    expect(parseNfceQr(`?p=${KEY.slice(0, 43)}9|2|1|1|X`)).toBeNull();
  });
});

describe("limites de uso (RF21)", () => {
  it("usa os valores sugeridos nos requisitos", () => {
    expect(DEFAULT_USAGE_LIMITS).toEqual({
      maxAudioSeconds: 180,
      maxImageBytes: 5 * 1024 * 1024,
      messagesPerUserPerHour: 60,
      messagesPerTenantPerDay: 1000,
    });
  });

  it("a 60ª mensagem da hora passa e a 61ª é barrada", () => {
    expect(evaluateRateLimit({ userLastHour: 60, tenantLastDay: 60 })).toEqual({ kind: "allowed" });
    expect(evaluateRateLimit({ userLastHour: 61, tenantLastDay: 61 })).toEqual({
      kind: "limited",
      scope: "user",
    });
  });

  it("barra pela empresa quando passa de 1.000 no dia", () => {
    expect(evaluateRateLimit({ userLastHour: 3, tenantLastDay: 1001 })).toEqual({
      kind: "limited",
      scope: "tenant",
    });
  });

  it("respeita limites configurados por plano", () => {
    const limits = { ...DEFAULT_USAGE_LIMITS, messagesPerUserPerHour: 5 };
    expect(evaluateRateLimit({ userLastHour: 6, tenantLastDay: 6 }, limits).kind).toBe("limited");
  });

  it("duração por taxa constante: 32 kbps, 120 kB ≈ 30 s", () => {
    expect(cbrAudioSeconds(120_000, 32_000)).toBe(30);
    // Exatamente 180 s ainda é aceito; 200 s (CA02) passa do limite.
    expect(cbrAudioSeconds(720_000, 32_000)).toBe(DEFAULT_USAGE_LIMITS.maxAudioSeconds);
    expect(cbrAudioSeconds(800_000, 32_000)).toBeGreaterThan(DEFAULT_USAGE_LIMITS.maxAudioSeconds);
  });
});
