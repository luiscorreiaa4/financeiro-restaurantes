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
    // Testes de formulário digitam campo a campo no jsdom: no `pnpm test` da raiz (pacotes em
    // paralelo) passam dos 5 s padrão sem haver defeito (PF2-6).
    testTimeout: 20_000,
  },
});
