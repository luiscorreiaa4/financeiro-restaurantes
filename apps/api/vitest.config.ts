import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Os testes de integração sobem um Postgres em container: o primeiro pull pode demorar.
    testTimeout: 60_000,
    hookTimeout: 180_000,
  },
});
