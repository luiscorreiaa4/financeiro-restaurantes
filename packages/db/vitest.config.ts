import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Exigido pelo archunit (testes de arquitetura), que estende o expect global.
    globals: true,
    // Os testes de integração sobem um Postgres em container: o primeiro pull pode demorar.
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
