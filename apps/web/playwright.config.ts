import { defineConfig, devices } from "@playwright/test";

const WEB_PORT = 3100;
const FAKE_API_PORT = 4010;

export default defineConfig({
  testDir: "./e2e",
  workers: process.env.CI ? 1 : undefined,
  retries: process.env.CI ? 1 : 0,
  reporter: [["html", { open: "never" }]],
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "Desktop Chrome", use: { ...devices["Desktop Chrome"] } },
    { name: "Mobile Chrome", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    {
      name: "API falsa",
      command: "node e2e/fake-api.mjs",
      url: `http://localhost:${FAKE_API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      name: "Web",
      // No CI testa o build de produção (onde o Cache Components importa); local usa o dev.
      command: process.env.CI
        ? `pnpm exec next build && pnpm exec next start -p ${WEB_PORT}`
        : `pnpm exec next dev -p ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}`,
      env: { API_URL: `http://localhost:${FAKE_API_PORT}`, PORT: String(WEB_PORT) },
      reuseExistingServer: false,
      timeout: 180_000,
    },
  ],
});
