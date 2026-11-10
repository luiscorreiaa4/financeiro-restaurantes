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

const login = {
  "set-cookie": `${SESSION_COOKIE}=${SESSION_VALUE}; Path=/; HttpOnly; SameSite=Lax`,
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
      ? send(res, 200, { userId: "u-1", name: "Dono Demo", email: "dono@demo.dev" })
      : send(res, 401, { code: "UNAUTHORIZED", message: "Entre para continuar." });
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
      { "set-cookie": `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly` },
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
