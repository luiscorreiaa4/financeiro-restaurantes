import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Sem `globals`, o Testing Library não registra a limpeza automática entre testes.
afterEach(cleanup);
