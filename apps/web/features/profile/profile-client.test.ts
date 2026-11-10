import { describe, expect, it } from "vitest";
import { ApiError } from "@/lib/api/client";
import { createProfileClient } from "./profile-client";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const VALID_PROFILE = {
  name: "Maria",
  email: "maria@demo.dev",
  hasPassword: true,
  sessions: [
    { device: "Chrome no Android", lastUsedAt: "2026-11-09T15:30:00.000Z", current: true },
    { device: "Safari no iPhone", lastUsedAt: "2026-11-08T10:00:00.000Z", current: false },
  ],
};

type Call = { url: string; init?: RequestInit };

function recordingFetch(response: () => Response) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return response();
  };
  return { calls, fetchImpl };
}

describe("cliente do perfil", () => {
  it("get: lê /api/profile e devolve o perfil validado", async () => {
    const { calls, fetchImpl } = recordingFetch(() => jsonResponse(VALID_PROFILE));

    await expect(createProfileClient(fetchImpl).get()).resolves.toEqual(VALID_PROFILE);

    expect(calls[0]?.url).toBe("/api/profile");
  });

  it("get: rejeita resposta fora do contrato", async () => {
    const { fetchImpl } = recordingFetch(() => jsonResponse({ name: "Maria" }));

    await expect(createProfileClient(fetchImpl).get()).rejects.toBeInstanceOf(ApiError);
  });

  it("get: rejeita sessão sem rótulo de aparelho", async () => {
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse({ ...VALID_PROFILE, sessions: [{ lastUsedAt: "x", current: true }] }),
    );

    await expect(createProfileClient(fetchImpl).get()).rejects.toBeInstanceOf(ApiError);
  });

  it("updateName: PATCH /api/profile/name com o nome", async () => {
    const { calls, fetchImpl } = recordingFetch(() => jsonResponse({ success: true }));

    await createProfileClient(fetchImpl).updateName("Maria Souza");

    expect(calls[0]?.url).toBe("/api/profile/name");
    expect(calls[0]?.init?.method).toBe("PATCH");
    expect(calls[0]?.init?.body).toBe('{"name":"Maria Souza"}');
  });

  it("changePassword: POST /api/profile/password com a senha atual e a nova", async () => {
    const { calls, fetchImpl } = recordingFetch(() => jsonResponse({ success: true }));

    await createProfileClient(fetchImpl).changePassword({
      currentPassword: "antiga123",
      newPassword: "nova12345",
    });

    expect(calls[0]?.url).toBe("/api/profile/password");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      currentPassword: "antiga123",
      newPassword: "nova12345",
    });
  });

  it("requestPasswordLink: POST /api/profile/password/link", async () => {
    const { calls, fetchImpl } = recordingFetch(() => jsonResponse({ success: true }));

    await createProfileClient(fetchImpl).requestPasswordLink();

    expect(calls[0]?.url).toBe("/api/profile/password/link");
    expect(calls[0]?.init?.method).toBe("POST");
  });

  it("revokeOtherSessions: POST /api/profile/sessions/revoke-others", async () => {
    const { calls, fetchImpl } = recordingFetch(() => jsonResponse({ success: true }));

    await createProfileClient(fetchImpl).revokeOtherSessions();

    expect(calls[0]?.url).toBe("/api/profile/sessions/revoke-others");
    expect(calls[0]?.init?.method).toBe("POST");
  });

  it("erro da API vira ApiError com o corpo {code, message}", async () => {
    const { fetchImpl } = recordingFetch(() =>
      jsonResponse({ code: "INVALID_PASSWORD", message: "Senha atual incorreta." }, 400),
    );

    await expect(
      createProfileClient(fetchImpl).changePassword({
        currentPassword: "x",
        newPassword: "nova12345",
      }),
    ).rejects.toMatchObject({ status: 400, body: { code: "INVALID_PASSWORD" } });
  });
});
