import { describe, expect, it } from "vitest";
import { isValidSignature, signBody } from "./signature";

const SECRET = "segredo-do-app";
const body = new TextEncoder().encode('{"object":"whatsapp_business_account","entry":[]}');

describe("assinatura X-Hub-Signature-256", () => {
  it("aceita a assinatura calculada com o segredo do app sobre os bytes recebidos", () => {
    const header = signBody(body, SECRET);
    expect(isValidSignature({ rawBody: body, header, appSecret: SECRET })).toBe(true);
  });

  it("recusa quando o corpo foi alterado em 1 byte", () => {
    const header = signBody(body, SECRET);
    const tampered = new Uint8Array(body);
    tampered[10] = (tampered[10] ?? 0) ^ 1;
    expect(isValidSignature({ rawBody: tampered, header, appSecret: SECRET })).toBe(false);
  });

  it("recusa assinatura feita com outro segredo", () => {
    const header = signBody(body, "outro-segredo");
    expect(isValidSignature({ rawBody: body, header, appSecret: SECRET })).toBe(false);
  });

  it("recusa cabeçalho ausente", () => {
    expect(isValidSignature({ rawBody: body, header: undefined, appSecret: SECRET })).toBe(false);
  });

  it("recusa cabeçalho sem o prefixo sha256=", () => {
    const hex = signBody(body, SECRET).slice("sha256=".length);
    expect(isValidSignature({ rawBody: body, header: hex, appSecret: SECRET })).toBe(false);
  });

  it.each([
    ["vazio", "sha256="],
    ["hex curto", "sha256=abcd"],
    ["não é hex", "sha256=zzzz"],
    ["maiúsculas do prefixo", "SHA256=abcd"],
  ])("recusa cabeçalho malformado sem lançar erro (%s)", (_name, header) => {
    expect(isValidSignature({ rawBody: body, header, appSecret: SECRET })).toBe(false);
  });

  it("aceita corpo vazio com a assinatura correta, mas não com a de outro corpo", () => {
    const empty = new Uint8Array();
    expect(
      isValidSignature({ rawBody: empty, header: signBody(empty, SECRET), appSecret: SECRET }),
    ).toBe(true);
    expect(
      isValidSignature({ rawBody: empty, header: signBody(body, SECRET), appSecret: SECRET }),
    ).toBe(false);
  });

  it("valida sobre bytes, não sobre JSON reparseado (espaços contam)", () => {
    const original = new TextEncoder().encode('{"a":1}');
    const reformatted = new TextEncoder().encode('{ "a": 1 }');
    const header = signBody(original, SECRET);
    expect(isValidSignature({ rawBody: reformatted, header, appSecret: SECRET })).toBe(false);
  });
});
