import type { NextConfig } from "next";
import { parsePublicEnv, parseWebEnv } from "./lib/env";
import { securityHeadersConfig } from "./lib/security-headers";

// Número de WhatsApp inválido derruba o build (falha cedo); ausente é aceito e a tela avisa.
parsePublicEnv(process.env);

const nextConfig: NextConfig = {
  transpilePackages: ["@app/config", "@app/core"],
  // Dois flags explícitos (a doc manda definir partialPrefetching para não gerar aviso).
  cacheComponents: true,
  partialPrefetching: true,
  async headers() {
    return securityHeadersConfig();
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
