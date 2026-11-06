import type { NextConfig } from "next";
import { parseWebEnv } from "./lib/env";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  transpilePackages: ["@app/config", "@app/core"],
  // Dois flags explícitos (a doc manda definir partialPrefetching para não gerar aviso).
  cacheComponents: true,
  partialPrefetching: true,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // Cookies de primeira parte: o navegador fala só com o web, que repassa /api/* para a API.
  async rewrites() {
    // Em desenvolvimento a API local é o padrão (o Next não lê o .env da raiz do monorepo).
    // Em produção a variável é obrigatória e a falta dela derruba o build, de propósito.
    const fallback =
      process.env.NODE_ENV === "production" ? {} : { API_URL: "http://localhost:4000" };
    const { API_URL } = parseWebEnv({ ...fallback, ...process.env });
    return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }];
  },
};

export default nextConfig;
