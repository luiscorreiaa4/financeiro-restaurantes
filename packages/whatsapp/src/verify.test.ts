import { describe, expect, it } from "vitest";
import { safeEqual, verifyHandshake } from "./verify";

const TOKEN = "token-de-verificacao";
const query = (overrides: Record<string, unknown> = {}) => ({
  "hub.mode": "subscribe",
  "hub.verify_token": TOKEN,
  "hub.challenge": "1158201444",
  ...overrides,
});

describe("handshake de verificação do webhook", () => {
  it("devolve o challenge quando modo e token conferem", () => {
    expect(verifyHandshake({ query: query(), verifyToken: TOKEN })).toEqual({
      ok: true,
      challenge: "1158201444",
    });
  });

  it("recusa token errado", () => {
    expect(
      verifyHandshake({ query: query({ "hub.verify_token": "x" }), verifyToken: TOKEN }),
    ).toEqual({ ok: false });
  });

  it("recusa token com tamanho diferente sem lançar erro", () => {
    const result = verifyHandshake({
      query: query({ "hub.verify_token": `${TOKEN}${TOKEN}` }),
      verifyToken: TOKEN,
    });
    expect(result.ok).toBe(false);
  });

  it("recusa modo diferente de subscribe", () => {
    expect(
      verifyHandshake({ query: query({ "hub.mode": "unsubscribe" }), verifyToken: TOKEN }).ok,
    ).toBe(false);
  });

  it.each([
    ["sem token", { "hub.verify_token": undefined }],
    ["token que não é texto", { "hub.verify_token": ["a", "b"] }],
    ["sem challenge", { "hub.challenge": undefined }],
    ["challenge vazio", { "hub.challenge": "" }],
    ["sem modo", { "hub.mode": undefined }],
  ])("recusa requisição incompleta (%s)", (_name, overrides) => {
    expect(verifyHandshake({ query: query(overrides), verifyToken: TOKEN }).ok).toBe(false);
  });

  it("safeEqual compara textos de tamanhos diferentes sem lançar erro", () => {
    expect(safeEqual("a", "abc")).toBe(false);
    expect(safeEqual("abc", "abc")).toBe(true);
  });
});
