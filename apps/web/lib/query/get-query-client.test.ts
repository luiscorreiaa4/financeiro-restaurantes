// @vitest-environment node
import { describe, expect, it } from "vitest";
import { getQueryClient } from "./get-query-client";

describe("QueryClient do servidor", () => {
  it("devolve uma instância nova a cada chamada, para não misturar dados entre requisições", () => {
    expect(getQueryClient()).not.toBe(getQueryClient());
  });
});
