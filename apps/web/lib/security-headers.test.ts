import { describe, expect, it } from "vitest";
import { securityHeadersConfig } from "./security-headers";

function headersOf(source: string): Record<string, string> {
  const entry = securityHeadersConfig().find((item) => item.source === source);
  expect(entry, source).toBeDefined();
  return Object.fromEntries((entry?.headers ?? []).map((h) => [h.key, h.value]));
}

describe("cabeçalhos de segurança", () => {
  it("/sw.js traz tipo, sem cache e CSP restrita", () => {
    expect(headersOf("/sw.js")).toEqual({
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'",
    });
  });

  it("/:path* mantém os quatro cabeçalhos atuais", () => {
    expect(headersOf("/:path*")).toEqual({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Frame-Options": "DENY",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    });
  });

  it("não há outro source", () => {
    expect(
      securityHeadersConfig()
        .map((item) => item.source)
        .sort(),
    ).toEqual(["/:path*", "/sw.js"]);
  });
});
