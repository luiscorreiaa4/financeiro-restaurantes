import { normalizeEmail } from "@app/core";
import type { FastifyError, FastifyPluginAsync, FastifyRequest } from "fastify";
import { z } from "zod";
import type { CheckSession } from "../../modules/auth/check-session";
import type { CreateAccount } from "../../modules/signup/create-account";
import type { CreateCompany } from "../../modules/signup/create-company";
import type { RequestSignupCode } from "../../modules/signup/request-signup-code";
import type { VerifySignupCode } from "../../modules/signup/verify-signup-code";
import { authError } from "../auth/auth-messages";
import { toWebHeaders } from "../auth/require-session";
import { signupError } from "./signup-messages";

export interface SignupRoutesDeps {
  readonly requestCode: RequestSignupCode;
  readonly verifyCode: VerifySignupCode;
  readonly createAccount: CreateAccount;
  /** "Criar outra empresa" (`POST /api/companies`), só com sessão. */
  readonly companies?: {
    readonly checkSession: CheckSession;
    readonly createCompany: CreateCompany;
  };
}

const normalizedEmail = z.string().max(320).transform(normalizeEmail).pipe(z.email());

const codeBody = z.object({ email: z.unknown() });
const verifyBody = z.object({ email: z.unknown(), code: z.string().max(32) });
/** O formulário (`owner`, `company`, `unit`, `terms`) é validado no core, campo a campo. */
const createBody = z.looseObject({
  receipt: z.string().min(1).max(128),
  email: z.unknown(),
});

const CREATE_CONFLICTS = {
  cnpj_taken: "CNPJ_TAKEN",
  phone_taken: "PHONE_TAKEN",
  email_taken: "SIGNUP_FAILED",
} as const;

const companyBody = z.looseObject({});

const auditOf = (request: FastifyRequest) => ({
  ip: request.ip,
  userAgent: request.headers["user-agent"],
});

/**
 * `POST /api/signup/code`, `POST /api/signup/verify` e `POST /api/signup` (F1b, RF01), públicas,
 * e `POST /api/companies` ("Criar outra empresa"), que exige sessão.
 * Nunca logam corpo, e-mail, celular, CNPJ, senha, código nem comprovante (regra 9): o
 * serializer do app só registra o caminho.
 */
export const signupRoutes: FastifyPluginAsync<{ deps: SignupRoutesDeps }> = async (
  app,
  { deps },
) => {
  // JSON malformado e afins: 4xx no formato da API, nunca o texto do Fastify.
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const status =
      error.statusCode !== undefined && error.statusCode < 500 ? error.statusCode : 500;
    if (status >= 500) {
      request.log.error({ errorName: error.name, errorCode: error.code }, "falha no cadastro");
    }
    return reply.code(status).send(signupError(status));
  });

  app.post("/api/signup/code", async (request, reply) => {
    const body = codeBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send(signupError(400));
    const email = normalizedEmail.safeParse(body.data.email);
    if (!email.success) return reply.code(400).send(signupError(400, "INVALID_EMAIL"));
    // Mesma resposta, já, para e-mail novo, cadastrado ou bloqueado: o resto roda depois.
    deps.requestCode({ email: email.data, ...auditOf(request) });
    return reply.send({ success: true });
  });

  app.post("/api/signup/verify", async (request, reply) => {
    const body = verifyBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send(signupError(400));
    const email = normalizedEmail.safeParse(body.data.email);
    if (!email.success) return reply.code(400).send(signupError(400, "INVALID_EMAIL"));
    const result = await deps.verifyCode({
      email: email.data,
      code: body.data.code.trim(),
      ...auditOf(request),
    });
    if (result.ok) return reply.send({ receipt: result.value.receipt });
    return result.error === "too_many_attempts"
      ? reply.code(429).send(signupError(429, "TOO_MANY_ATTEMPTS"))
      : reply.code(400).send(signupError(400, "INVALID_CODE"));
  });

  app.post("/api/signup", async (request, reply) => {
    const body = createBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send(signupError(400));
    const email = normalizedEmail.safeParse(body.data.email);
    if (!email.success) return reply.code(400).send(signupError(400, "INVALID_EMAIL"));
    const { receipt, email: _email, ...form } = body.data;
    const result = await deps.createAccount({
      receipt,
      email: email.data,
      form,
      ...auditOf(request),
    });
    if (result.ok) {
      const { tenantId, setCookies } = result.value;
      if (setCookies.length > 0) reply.header("set-cookie", setCookies);
      return reply.code(201).send({ tenantId });
    }
    const failure = result.error;
    if (failure.kind === "invalid_fields") {
      return reply
        .code(400)
        .send({ ...signupError(400, "INVALID_FIELDS"), fields: failure.fields });
    }
    if (failure.kind === "receipt_invalid") {
      return reply.code(401).send(signupError(401, "RECEIPT_INVALID"));
    }
    return reply.code(409).send(signupError(409, CREATE_CONFLICTS[failure.kind]));
  });

  const companies = deps.companies;
  if (companies === undefined) return;
  app.post("/api/companies", async (request, reply) => {
    // Mesma autoridade das rotas do painel: cookie válido e vínculo ativo (RF02.CA07, CA08).
    const check = await companies.checkSession(toWebHeaders(request));
    if (!check.ok) return reply.code(401).send(authError(401));
    if (check.setCookies.length > 0) reply.header("set-cookie", check.setCookies);
    const body = companyBody.safeParse(request.body);
    if (!body.success) return reply.code(400).send(signupError(400));
    const result = await companies.createCompany({
      userId: check.session.userId,
      email: check.session.email,
      form: body.data,
      ...auditOf(request),
    });
    if (result.ok) return reply.code(201).send({ tenantId: result.value.tenantId });
    const failure = result.error;
    if (failure.kind === "invalid_fields") {
      return reply
        .code(400)
        .send({ ...signupError(400, "INVALID_FIELDS"), fields: failure.fields });
    }
    return reply.code(409).send(signupError(409, CREATE_CONFLICTS[failure.kind]));
  });
};
