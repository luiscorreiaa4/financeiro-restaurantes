import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import {
  createSignupApi,
  fieldErrorMessage,
  signupErrorCode,
  signupErrorMessage,
  signupFieldErrors,
} from "./signup-api";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("cliente das rotas de cadastro", () => {
  it("chama as quatro rotas com o corpo certo e valida a resposta", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse(200, { success: true }))
      .mockResolvedValueOnce(jsonResponse(200, { receipt: "r-1" }))
      .mockResolvedValueOnce(jsonResponse(201, { tenantId: "t-1" }))
      .mockResolvedValueOnce(jsonResponse(201, { tenantId: "t-2" }));
    const api = createSignupApi(fetchImpl);

    await api.requestCode("dono@novo.dev");
    expect(await api.verifyCode("dono@novo.dev", "123456")).toEqual({ receipt: "r-1" });
    const payload = {
      receipt: "r-1",
      email: "dono@novo.dev",
      owner: { name: "Maria", email: "dono@novo.dev", phone: "82996585647", password: "" },
      company: {
        tradeName: "Cantina",
        legalName: "",
        cnpj: "",
        segment: "restaurant",
        taxRegime: "",
        revenueRange: "",
      },
      unit: { name: "Cantina", city: "Maceió", uf: "AL" },
      terms: { accepted: true },
    } as const;
    expect(await api.submitSignup(payload)).toEqual({ tenantId: "t-1" });
    const { receipt: _r, email: _e, owner: _o, ...company } = payload;
    expect(await api.submitCompany({ owner: {}, ...company })).toEqual({ tenantId: "t-2" });

    const calls = fetchImpl.mock.calls.map(([url, init]) => [url, JSON.parse(String(init?.body))]);
    expect(calls).toEqual([
      ["/api/signup/code", { email: "dono@novo.dev" }],
      ["/api/signup/verify", { email: "dono@novo.dev", code: "123456" }],
      ["/api/signup", payload],
      ["/api/companies", { owner: {}, ...company }],
    ]);
  });

  it("resposta fora do contrato vira ApiError", async () => {
    const api = createSignupApi(vi.fn<typeof fetch>(async () => jsonResponse(200, { ok: 1 })));
    await expect(api.verifyCode("a@b.dev", "123456")).rejects.toBeInstanceOf(ApiError);
  });

  it("lê código, mensagem e campos do erro; sem mensagem usa o texto por código", () => {
    const withFields = new ApiError("x", 400, {
      code: "INVALID_FIELDS",
      message: "Confira os campos marcados e tente de novo.",
      fields: { "company.cnpj": "cnpj_invalid", "unit.uf": "uf_invalid", lixo: 3 },
    });
    expect(signupErrorCode(withFields)).toBe("INVALID_FIELDS");
    expect(signupFieldErrors(withFields)).toEqual({
      "company.cnpj": "cnpj_invalid",
      "unit.uf": "uf_invalid",
    });
    expect(
      signupErrorMessage(new ApiError("x", 409, { code: "PHONE_TAKEN", message: "" })),
    ).toMatch(/suporte/);
    expect(signupErrorMessage(new ApiError("x", 0))).toMatch(
      /Não foi possível falar com o servidor/,
    );
    expect(fieldErrorMessage("cnpj_invalid")).toMatch(/dígito verificador/);
  });
});
