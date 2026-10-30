import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Exigido pelo archunit (testes de arquitetura), que estende o expect global.
    globals: true,
  },
});
