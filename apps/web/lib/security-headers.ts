export type HeaderRule = {
  source: string;
  headers: { key: string; value: string }[];
};

const BASE_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

// O service worker nunca fica em cache (deploy novo tem de chegar ao app instalado)
// e só pode carregar script da própria origem.
const SERVICE_WORKER_HEADERS = [
  { key: "Content-Type", value: "application/javascript; charset=utf-8" },
  { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
  { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
];

export function securityHeadersConfig(): HeaderRule[] {
  return [
    { source: "/:path*", headers: BASE_HEADERS.map((h) => ({ ...h })) },
    { source: "/sw.js", headers: SERVICE_WORKER_HEADERS.map((h) => ({ ...h })) },
  ];
}
