// API falsa, só para o E2E exercitar o rewrite de /api/* sem depender da API real.
import { createServer } from "node:http";

const port = Number(process.env.FAKE_API_PORT ?? 4010);

// Valores fixos de acesso (espelham o contrato da API real, sem a regra).
const SESSION_COOKIE = "better-auth.session_token";
const SESSION_VALUE = "sessao-falsa";
const FIXED_OTP = "123456";
const FIXED_PASSWORD = "demo12345";

function send(res, status, body, headers = {}) {
  res.statusCode = status;
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(body));
}

function hasSession(req) {
  return (req.headers.cookie ?? "").split(/;\s*/).includes(`${SESSION_COOKIE}=${SESSION_VALUE}`);
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
    return body.password === FIXED_PASSWORD
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

  send(res, 404, { error: "not_found" });
}).listen(port, () => {
  console.log(`API falsa em http://localhost:${port}`);
});
