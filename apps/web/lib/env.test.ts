import { describe, expect, it } from "vitest";
import { parseWebEnv } from "./env";

describe("ambiente do web", () => {
  it("aceita API_URL com uma URL válida", () => {
    expect(parseWebEnv({ API_URL: "http://localhost:4000" })).toEqual({
      API_URL: "http://localhost:4000",
    });
  });

  it("rejeita API_URL ausente", () => {
    expect(() => parseWebEnv({})).toThrow();
  });

  it("rejeita API_URL que não é URL", () => {
    expect(() => parseWebEnv({ API_URL: "nao-e-url" })).toThrow();
  });
});
