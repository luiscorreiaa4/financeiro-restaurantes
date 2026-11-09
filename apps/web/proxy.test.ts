// @vitest-environment node
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { config, proxy } from "./proxy";

function request(path: string, cookie?: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: cookie ? { cookie } : {},
  });
}

describe("proxy de acesso", () => {
  it("sem cookie em /lancamentos: redireciona para /login?next=%2Flancamentos", () => {
    const response = proxy(request("/lancamentos"));

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname + location.search).toBe("/login?next=%2Flancamentos");
  });

  it("com cookie (nome de desenvolvimento ou de produção): segue", () => {
    for (const cookie of [
      "better-auth.session_token=abc",
      "__Secure-better-auth.session_token=abc",
    ]) {
      const response = proxy(request("/lancamentos", cookie));
      expect(response.headers.get("location")).toBeNull();
      expect(response.status).toBe(200);
    }
  });

  it("cookie sem valor ou de outro nome não conta", () => {
    expect(proxy(request("/", "better-auth.session_token=")).status).toBe(307);
    expect(proxy(request("/", "outro=abc")).status).toBe(307);
  });

  it("/login, /_next, /api e arquivos estáticos passam sem cookie", () => {
    for (const path of ["/login", "/login/", "/_next/static/a.js", "/api/health", "/favicon.ico"]) {
      const response = proxy(request(path));
      expect(response.headers.get("location"), path).toBeNull();
    }
  });

  it("/cadastro, /termos e /privacidade passam sem cookie; /bem-vindo e /nova-empresa não", () => {
    for (const path of ["/cadastro", "/cadastro/", "/termos", "/privacidade"]) {
      expect(proxy(request(path)).headers.get("location"), path).toBeNull();
    }
    for (const path of ["/bem-vindo", "/nova-empresa", "/cadastros", "/termosx"]) {
      expect(proxy(request(path)).status, path).toBe(307);
    }
  });

  it("no redirecionamento guarda também a busca da rota", () => {
    const response = proxy(request("/lancamentos?mes=2026-11"));

    const location = new URL(response.headers.get("location") ?? "");
    expect(location.searchParams.get("next")).toBe("/lancamentos?mes=2026-11");
  });

  it("arquivo que não é asset estático (export.xlsx) continua protegido", () => {
    expect(proxy(request("/lancamentos/export.xlsx")).status).toBe(307);
    expect(proxy(request("/apiario")).status).toBe(307);
  });

  it("o matcher não exclui /apiario, só /api e /api/...", () => {
    const pattern = new RegExp(`^${config.matcher[0]}$`);
    expect(pattern.test("/apiario")).toBe(true);
    expect(pattern.test("/api/health")).toBe(false);
    expect(pattern.test("/api")).toBe(false);
  });
});
