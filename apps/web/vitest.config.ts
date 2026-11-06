import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // O tsconfig usa jsx "preserve" (exigência do Next); aqui o Vitest precisa transformar o JSX.
  oxc: { jsx: { runtime: "automatic" } },
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // Os *.spec.ts de e2e/ são do Playwright e não podem rodar no Vitest.
    exclude: ["e2e/**", "node_modules/**", ".next/**"],
  },
});
