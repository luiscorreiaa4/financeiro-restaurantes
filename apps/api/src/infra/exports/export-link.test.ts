import { EXPORT_LINK_TTL_SECONDS } from "@app/core/contracts";
import { describe, expect, it } from "vitest";
import { createFixedClock } from "../clock.js";
import { createExportLinkSigner } from "./export-link.js";

const T0 = new Date("2026-11-23T12:00:00.000Z");
const input = { exportId: "exp-1", userId: "user-1", tenantId: "tenant-1" };
const SECRET = "segredo-de-teste-com-tamanho-ok";

function setup() {
  const clock = createFixedClock(T0);
  return { clock, signer: createExportLinkSigner(SECRET, clock) };
}

function at(seconds: number): Date {
  return new Date(T0.getTime() + seconds * 1000);
}

function decode(token: string): string {
  return Buffer.from(token, "base64url").toString("utf8");
}

function encode(raw: string): string {
  return Buffer.from(raw, "utf8").toString("base64url");
}

describe("token do link de download da exportação", () => {
  it("emite com validade de 1 hora e verifica logo depois", () => {
    const { signer } = setup();
    const { token, expiresAt } = signer.issue(input);
    expect(expiresAt.getTime()).toBe(at(EXPORT_LINK_TTL_SECONDS).getTime());
    expect(signer.verify(token, input)).toBe(true);
  });

  it("passa em t0 + 3600 s e falha em t0 + 3601 s", () => {
    const { signer, clock } = setup();
    const { token } = signer.issue(input);
    clock.set(at(EXPORT_LINK_TTL_SECONDS));
    expect(signer.verify(token, input)).toBe(true);
    clock.set(at(EXPORT_LINK_TTL_SECONDS + 1));
    expect(signer.verify(token, input)).toBe(false);
  });

  it("recusa token de outro exportId, userId ou tenantId", () => {
    const { signer } = setup();
    const { token } = signer.issue(input);
    expect(signer.verify(token, { ...input, exportId: "exp-2" })).toBe(false);
    expect(signer.verify(token, { ...input, userId: "user-2" })).toBe(false);
    expect(signer.verify(token, { ...input, tenantId: "tenant-2" })).toBe(false);
  });

  it("não confunde ids que só diferem pela fronteira entre os campos", () => {
    const { signer } = setup();
    const { token } = signer.issue({ exportId: "a", userId: "bc", tenantId: "d" });
    expect(signer.verify(token, { exportId: "ab", userId: "c", tenantId: "d" })).toBe(false);
  });

  it("recusa token assinado com outro segredo", () => {
    const { clock, signer } = setup();
    const other = createExportLinkSigner("outro-segredo-completamente-diferente", clock);
    expect(signer.verify(other.issue(input).token, input)).toBe(false);
  });

  it("recusa token adulterado no hmac ou na expiração, sem lançar", () => {
    const { signer } = setup();
    const { token } = signer.issue(input);
    const [exp, mac] = decode(token).split(".") as [string, string];

    const flippedMac = (mac.startsWith("0") ? "1" : "0") + mac.slice(1);
    expect(signer.verify(encode(`${exp}.${flippedMac}`), input)).toBe(false);
    expect(signer.verify(encode(`${Number(exp) - 1}.${mac}`), input)).toBe(false);
  });

  it("não deixa estender a expiração mantendo o hmac", () => {
    const { signer } = setup();
    const { token } = signer.issue(input);
    const [exp, mac] = decode(token).split(".") as [string, string];
    expect(signer.verify(encode(`${Number(exp) + 86_400}.${mac}`), input)).toBe(false);
  });

  it("devolve false para token malformado, sem lançar", () => {
    const { signer } = setup();
    const { token } = signer.issue(input);
    const [exp, mac] = decode(token).split(".") as [string, string];
    const malformed = [
      "",
      "sem-ponto",
      encode("sem-ponto"),
      "!!!não é base64!!!",
      encode(`.${mac}`),
      encode(`${exp}.`),
      encode(`abc.${mac}`),
      encode(`-5.${mac}`),
      encode(`NaN.${mac}`),
      encode(`Infinity.${mac}`),
      encode(`1.5.${mac}`),
      encode(`${exp}.abcd`),
      encode(`${exp}.${mac}.extra`),
      encode(`${exp}.${mac}00`),
      "a".repeat(100_000),
    ];
    for (const bad of malformed) {
      expect(signer.verify(bad, input)).toBe(false);
    }
  });

  it("dois issue seguidos geram tokens que verificam", () => {
    const { signer } = setup();
    const first = signer.issue(input);
    const second = signer.issue(input);
    expect(signer.verify(first.token, input)).toBe(true);
    expect(signer.verify(second.token, input)).toBe(true);
  });

  it("não deixa nenhum id em claro dentro do token", () => {
    const { signer } = setup();
    const raw = decode(signer.issue(input).token);
    for (const id of Object.values(input)) expect(raw).not.toContain(id);
  });

  it("recusa segredo vazio", () => {
    expect(() => createExportLinkSigner("", createFixedClock(T0))).toThrow();
  });
});
