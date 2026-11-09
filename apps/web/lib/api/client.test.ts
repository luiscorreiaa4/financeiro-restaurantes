import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ApiError, createApiClient } from "./client";

const healthSchema = z.object({ ok: z.boolean() });

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("cliente da API", () => {
  it("devolve o dado validado quando a API responde 200 com corpo no contrato", async () => {
    const api = createApiClient({
      baseUrl: "http://api.local",
      fetch: async () => jsonResponse({ ok: true }),
    });

    await expect(api.get("/api/health", healthSchema)).resolves.toEqual({ ok: true });
  });

  it("chama baseUrl + caminho enviando os cookies da sessão", async () => {
    let called: { url: string; init?: RequestInit } | undefined;
    const api = createApiClient({
      baseUrl: "http://api.local",
      fetch: async (url, init) => {
        called = { url: String(url), init };
        return jsonResponse({ ok: true });
      },
    });

    await api.get("/api/health", healthSchema);

    expect(called?.url).toBe("http://api.local/api/health");
    expect(called?.init?.credentials).toBe("include");
  });

  it("lança ApiError com o status quando a API responde erro", async () => {
    const api = createApiClient({
      baseUrl: "http://api.local",
      fetch: async () => jsonResponse({ error: "boom" }, 500),
    });

    await expect(api.get("/api/health", healthSchema)).rejects.toMatchObject({
      name: "ApiError",
      status: 500,
    });
  });

  it("lança ApiError quando o corpo foge do contrato", async () => {
    const api = createApiClient({
      baseUrl: "http://api.local",
      fetch: async () => jsonResponse({ ok: "sim" }),
    });

    await expect(api.get("/api/health", healthSchema)).rejects.toBeInstanceOf(ApiError);
  });

  it("lança ApiError com status 0 quando a API está fora do ar", async () => {
    const api = createApiClient({
      baseUrl: "http://api.local",
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });

    await expect(api.get("/api/health", healthSchema)).rejects.toMatchObject({
      name: "ApiError",
      status: 0,
    });
  });
});

describe("cliente da API: POST", () => {
  it("envia JSON com cookies e valida a resposta", async () => {
    let called: { url: string; init?: RequestInit } | undefined;
    const api = createApiClient({
      baseUrl: "",
      fetch: async (url, init) => {
        called = { url: String(url), init };
        return jsonResponse({ ok: true });
      },
    });

    await expect(api.post("/api/x", { a: 1 }, healthSchema)).resolves.toEqual({ ok: true });

    expect(called?.url).toBe("/api/x");
    expect(called?.init?.method).toBe("POST");
    expect(called?.init?.credentials).toBe("include");
    expect(called?.init?.body).toBe('{"a":1}');
  });

  it("erro da API vira ApiError com o corpo {code, message}", async () => {
    const api = createApiClient({
      baseUrl: "",
      fetch: async () => jsonResponse({ code: "INVALID_OTP", message: "Código inválido." }, 400),
    });

    await expect(api.post("/api/x", {}, healthSchema)).rejects.toMatchObject({
      status: 400,
      body: { code: "INVALID_OTP" },
    });
  });
});
