// API falsa, só para o E2E exercitar o rewrite de /api/* sem depender da API real.
import { createServer } from "node:http";

const port = Number(process.env.FAKE_API_PORT ?? 4010);

// Valores fixos de acesso (espelham o contrato da API real, sem a regra).
const SESSION_COOKIE = "better-auth.session_token";
const SESSION_VALUE = "sessao-falsa";
const FIXED_OTP = "123456";
const FIXED_PASSWORD = "demo12345";
// Token do link de recuperação (RF03, DD-27): o único que a API falsa aceita; qualquer outro é inválido.
const VALID_RESET_TOKEN = "link-valido-123";

function send(res, status, body, headers = {}) {
  res.statusCode = status;
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

// Valor do cookie de sessão: o fixo do login ou `sessao-falsa-<qualquer coisa>`. Os specs de perfil
// usam um valor próprio por teste, para o estado em memória não vazar entre testes em paralelo.
function sessionValue(req) {
  const prefix = `${SESSION_COOKIE}=`;
  for (const part of (req.headers.cookie ?? "").split(/;\s*/)) {
    if (!part.startsWith(prefix)) continue;
    const value = part.slice(prefix.length);
    if (value === SESSION_VALUE || value.startsWith(`${SESSION_VALUE}-`)) return value;
  }
  return null;
}

function hasSession(req) {
  return sessionValue(req) !== null;
}

// Senhas aceitas no login por senha: a fixa e as definidas pela recuperação.
const acceptedPasswords = new Set([FIXED_PASSWORD]);

// Perfil por sessão (RF02.R8): a atual e duas outras; senha atual de partida = FIXED_PASSWORD.
const profiles = new Map();

function profileOf(req) {
  const key = sessionValue(req);
  if (!profiles.has(key)) {
    profiles.set(key, {
      name: "Dono Demo",
      email: "dono@demo.dev",
      password: FIXED_PASSWORD,
      sessions: [
        { device: "Chrome no Android", lastUsedAt: "2026-11-09T15:30:00.000Z", current: true },
        { device: "Safari no iPhone", lastUsedAt: "2026-11-08T10:00:00.000Z", current: false },
        { device: "Firefox no Linux", lastUsedAt: "2026-11-07T09:15:00.000Z", current: false },
      ],
    });
  }
  return profiles.get(key);
}

function onlyCurrent(profile) {
  profile.sessions = profile.sessions.filter((s) => s.current);
}

const UNAUTHORIZED = { code: "UNAUTHORIZED", message: "Entre para continuar." };

function passwordProblem(password) {
  if (typeof password !== "string" || password.length < 8) {
    return {
      code: "PASSWORD_TOO_SHORT",
      message: "A senha precisa ter de 8 a 64 caracteres.",
    };
  }
  return null;
}

function readJson(req) {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

// Contexto do painel (F2, DD-31): personas escolhidas pelo valor do cookie de sessão
// (`sessao-falsa-owner2`, `-manager`, `-staff`, `-accountant`, `-readonly`, `-expira`); qualquer
// outro valor é o dono de uma empresa só. Os dados são fixos: a regra mora nos testes da API.
const CONTEXT_COOKIE = "fr_ctx";
const T1 = "0190a000-0000-7000-8000-000000000001";
const T2 = "0190a000-0000-7000-8000-000000000002";
const U1 = "0190a000-0000-7000-8000-0000000000a1";
const U2 = "0190a000-0000-7000-8000-0000000000a2";
const U3 = "0190a000-0000-7000-8000-0000000000a3";

const ACTIONS_BY_ROLE = {
  owner: ["entry:view", "report:view", "export:data", "catalog:view", "panel:access"],
  manager: ["entry:view", "report:view", "catalog:view", "panel:access"],
  staff: ["entry:view", "panel:access"],
  accountant: ["entry:view", "report:view", "export:data", "catalog:view", "panel:access"],
};

function company(tenantId, name, role, units, extra = {}) {
  const allUnits = extra.allUnits ?? true;
  const accessible = extra.unitIds ?? units.map((u) => u.id);
  return {
    tenantId,
    name,
    role,
    accountStatus: extra.accountStatus ?? "active",
    allUnits,
    unitIds: accessible,
    units: units.filter((u) => accessible.includes(u.id)),
    startUnitId: allUnits ? "all" : accessible[0],
  };
}

const MATRIZ = { id: U1, name: "Matriz" };
const FILIAL = { id: U2, name: "Filial" };
const CENTRO = { id: U3, name: "Centro" };

const PERSONAS = {
  owner2: [
    company(T1, "Bistrô Demo", "owner", [MATRIZ, FILIAL]),
    company(T2, "Pizzaria Sul", "owner", [CENTRO]),
  ],
  manager: [
    company(T1, "Bistrô Demo", "manager", [MATRIZ, FILIAL], { allUnits: false, unitIds: [U1, U2] }),
  ],
  staff: [company(T1, "Bistrô Demo", "staff", [MATRIZ], { allUnits: false, unitIds: [U1] })],
  accountant: [company(T1, "Bistrô Demo", "accountant", [MATRIZ, FILIAL])],
  readonly: [company(T1, "Bistrô Demo", "owner", [MATRIZ], { accountStatus: "read_only" })],
};
const DEFAULT_PERSONA = [company(T1, "Bistrô Demo", "owner", [MATRIZ])];

function personaCompanies(req) {
  const value = sessionValue(req) ?? "";
  const name = value.startsWith(`${SESSION_VALUE}-`) ? value.slice(SESSION_VALUE.length + 1) : "";
  return PERSONAS[name] ?? DEFAULT_PERSONA;
}

function cookieValue(req, name) {
  const prefix = `${name}=`;
  for (const part of (req.headers.cookie ?? "").split(/;\s*/)) {
    if (part.startsWith(prefix)) return part.slice(prefix.length);
  }
  return null;
}

function parseCtx(raw) {
  const m = /^([0-9a-f-]{36})\.([0-9a-f-]{36}|all)$/.exec(raw ?? "");
  return m ? { tenantId: m[1], unitId: m[2] } : null;
}

function choiceValid(companies, choice) {
  const c = companies.find((x) => x.tenantId === choice.tenantId);
  if (!c) return false;
  return choice.unitId === "all" ? c.allUnits : c.unitIds.includes(choice.unitId);
}

// Espelha resolvePanelContext do core, sem a regra completa de situação da conta.
function resolveContext(req) {
  const companies = personaCompanies(req);
  const requested = parseCtx(cookieValue(req, CONTEXT_COOKIE));
  if (requested && choiceValid(companies, requested)) {
    return { company: companies.find((c) => c.tenantId === requested.tenantId), unitId: requested.unitId, source: "cookie", companies };
  }
  const kept = requested ? companies.find((c) => c.tenantId === requested.tenantId) : undefined;
  const company = kept ?? companies[0];
  return { company, unitId: company.startUnitId, source: requested ? "invalid_cookie" : "fallback", companies };
}

function meBody(req) {
  const { company, unitId, source, companies } = resolveContext(req);
  return {
    userId: "u-1",
    name: "Dono Demo",
    email: "dono@demo.dev",
    companies: companies.map((c) => ({
      tenantId: c.tenantId,
      name: c.name,
      role: c.role,
      accountStatus: c.accountStatus,
      startUnitId: c.startUnitId,
    })),
    context: {
      tenantId: company.tenantId,
      unitId,
      role: company.role,
      permissions: [],
      allUnits: company.allUnits,
      unitIds: company.unitIds,
      accountStatus: company.accountStatus,
      allowedActions: ACTIONS_BY_ROLE[company.role],
    },
    contextSource: source,
  };
}

const EXPIRE_CTX = `${CONTEXT_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;

const login = {
  "set-cookie": [`${SESSION_COOKIE}=${SESSION_VALUE}; Path=/; HttpOnly; SameSite=Lax`, EXPIRE_CTX],
};

function isValidCnpj(value) {
  // CNPJ numérico ou alfanumérico (valor do caractere = ASCII - 48), igual ao core.
  const d = value.replace(/[.\-/\s]/g, "").toUpperCase();
  if (!/^[0-9A-Z]{12}[0-9]{2}$/.test(d) || /^(.)\1+$/.test(d)) return false;
  const digit = (len) => {
    let sum = 0;
    let weight = len - 7;
    for (let i = 0; i < len; i++) {
      sum += (d.charCodeAt(i) - 48) * weight--;
      if (weight < 2) weight = 9;
    }
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return digit(12) === Number(d[12]) && digit(13) === Number(d[13]);
}

createServer(async (req, res) => {
  res.setHeader("content-type", "application/json");
  const { method, url } = req;

  if (method === "GET" && url === "/api/health") return send(res, 200, { ok: true });

  if (method === "GET" && url === "/api/me") {
    return hasSession(req)
      ? send(res, 200, meBody(req))
      : send(res, 401, { code: "UNAUTHORIZED", message: "Entre para continuar." });
  }

  // Contexto do painel (F2): o cookie fr_ctx só é gravado aqui, e só se o par for válido.
  if (method === "POST" && url === "/api/context") {
    if (!hasSession(req)) return send(res, 401, UNAUTHORIZED);
    const body = await readJson(req);
    const choice = { tenantId: body.tenantId, unitId: body.unitId };
    if (!choiceValid(personaCompanies(req), choice)) {
      return send(res, 403, { code: "context_invalid" });
    }
    res.setHeader(
      "set-cookie",
      `${CONTEXT_COOKIE}=${choice.tenantId}.${choice.unitId}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`,
    );
    res.statusCode = 204;
    return res.end();
  }

  if (method === "GET" && url === "/api/units") {
    if (!hasSession(req) || sessionValue(req) === `${SESSION_VALUE}-expira`) {
      return send(res, 401, UNAUTHORIZED);
    }
    const { company, unitId, source } = resolveContext(req);
    if (source === "invalid_cookie") return send(res, 403, { code: "context_invalid" });
    if (req.headers["x-context"] !== `${company.tenantId}.${unitId}`) {
      return send(res, 409, { code: "context_changed" });
    }
    return send(res, 200, { units: company.units });
  }

  if (method === "POST" && url === "/api/auth/email-otp/send-verification-otp") {
    return send(res, 200, { success: true });
  }

  if (method === "POST" && url === "/api/auth/sign-in/email-otp") {
    const body = await readJson(req);
    return body.otp === FIXED_OTP
      ? send(res, 200, { token: "t", user: {} }, login)
      : send(res, 400, {
          code: "INVALID_OTP",
          message: "Código inválido. Confira e tente de novo.",
        });
  }

  if (method === "POST" && url === "/api/auth/sign-in/email") {
    const body = await readJson(req);
    return acceptedPasswords.has(body.password)
      ? send(res, 200, { token: "t", user: {} }, login)
      : send(res, 401, {
          code: "INVALID_EMAIL_OR_PASSWORD",
          message: "E-mail ou senha incorretos.",
        });
  }

  if (method === "POST" && url === "/api/auth/sign-out") {
    return send(
      res,
      200,
      { success: true },
      { "set-cookie": [`${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly`, EXPIRE_CTX] },
    );
  }

  // Recuperação de senha por link (F1c, RF03, DD-27): espelha /api/recovery/*, sem a regra de verdade.
  if (method === "POST" && url === "/api/recovery/request") {
    return send(res, 200, { success: true });
  }

  if (method === "POST" && url === "/api/recovery/reset") {
    const body = await readJson(req);
    if (body.token !== VALID_RESET_TOKEN) {
      return send(res, 400, {
        code: "INVALID_TOKEN",
        message: "Link inválido ou expirado. Peça um novo.",
      });
    }
    const problem = passwordProblem(body.password);
    if (problem) return send(res, 400, problem);
    if (body.password === FIXED_PASSWORD) {
      return send(res, 400, {
        code: "SAME_PASSWORD",
        message: "A nova senha não pode ser igual à atual.",
      });
    }
    acceptedPasswords.add(body.password);
    return send(res, 200, { success: true });
  }

  // Perfil (F1c, RF02.R8, CA09): espelha /api/profile/*, com estado por sessão.
  if (url?.startsWith("/api/profile")) {
    if (!hasSession(req)) return send(res, 401, UNAUTHORIZED);
    const profile = profileOf(req);

    if (method === "GET" && url === "/api/profile") {
      return send(res, 200, {
        name: profile.name,
        email: profile.email,
        hasPassword: true,
        sessions: profile.sessions,
      });
    }

    if (method === "PATCH" && url === "/api/profile/name") {
      const body = await readJson(req);
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (name.length < 1 || name.length > 120) {
        return send(res, 400, {
          code: "INVALID_NAME",
          message: "Informe um nome de 1 a 120 caracteres.",
        });
      }
      profile.name = name;
      return send(res, 200, { success: true });
    }

    if (method === "POST" && url === "/api/profile/password") {
      const body = await readJson(req);
      if (body.currentPassword !== profile.password) {
        return send(res, 400, { code: "INVALID_PASSWORD", message: "Senha atual incorreta." });
      }
      const problem = passwordProblem(body.newPassword);
      if (problem) return send(res, 400, problem);
      if (body.newPassword === profile.password) {
        return send(res, 400, {
          code: "SAME_PASSWORD",
          message: "A nova senha não pode ser igual à atual.",
        });
      }
      profile.password = body.newPassword;
      acceptedPasswords.add(body.newPassword);
      onlyCurrent(profile);
      return send(res, 200, { success: true });
    }

    if (method === "POST" && url === "/api/profile/password/link") {
      return send(res, 200, { success: true });
    }

    if (method === "POST" && url === "/api/profile/sessions/revoke-others") {
      onlyCurrent(profile);
      return send(res, 200, { success: true });
    }
  }

  // Autocadastro (F1b): espelha apps/api/src/http/signup/signup-routes.ts, sem a regra.
  if (method === "POST" && url === "/api/signup/code") {
    return send(res, 200, { success: true });
  }

  if (method === "POST" && url === "/api/signup/verify") {
    const body = await readJson(req);
    return body.code === FIXED_OTP
      ? send(res, 200, { receipt: "comprovante-falso" })
      : send(res, 400, { code: "INVALID_CODE", message: "Código inválido ou vencido." });
  }

  if (method === "POST" && (url === "/api/signup" || url === "/api/companies")) {
    const body = await readJson(req);
    if (url === "/api/companies" && !hasSession(req)) {
      return send(res, 401, { code: "UNAUTHORIZED", message: "Entre para continuar." });
    }
    if (url === "/api/signup" && body.receipt !== "comprovante-falso") {
      return send(res, 401, { code: "RECEIPT_INVALID" });
    }
    const cnpj = body.company?.cnpj ?? "";
    if (cnpj.trim() !== "" && !isValidCnpj(cnpj)) {
      return send(res, 400, {
        code: "INVALID_FIELDS",
        message: "Confira os campos marcados.",
        fields: { "company.cnpj": "cnpj_invalid" },
      });
    }
    return send(res, 201, { tenantId: "t-novo" }, url === "/api/signup" ? login : {});
  }

  send(res, 404, { error: "not_found" });
}).listen(port, () => {
  console.log(`API falsa em http://localhost:${port}`);
});
