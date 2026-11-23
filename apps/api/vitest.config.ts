import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Exigido pelo archunit (testes de arquitetura), que estende o expect global.
    globals: true,
    // Os testes de integração sobem um Postgres em container: o primeiro pull pode demorar.
    testTimeout: 60_000,
    hookTimeout: 180_000,
    // Provas pontuais (F5, T2) ficam fora da suíte; rode com RUN_SPIKE=1.
    exclude: process.env.RUN_SPIKE
      ? configDefaults.exclude
      : [...configDefaults.exclude, "**/*.spike.test.ts"],
  },
});
