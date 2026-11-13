import { describe, expect, it, vi } from "vitest";
import { CONTEXT_CHANGED_MESSAGE, handleBrowserApiError } from "./browser-client";
import { ApiError } from "./client";

function nav(pathname = "/lancamentos", search = "?mes=2026-11") {
  return { assign: vi.fn(), reload: vi.fn(), pathname, search };
}

const conflict = () => new ApiError("409", 409, { code: "context_changed" });

describe("tratamento global de erro no navegador", () => {
  it("401 leva a /login com next seguro, em query e em mutação", () => {
    for (const kind of ["query", "mutation"] as const) {
      const n = nav();
      handleBrowserApiError(new ApiError("401", 401), kind, n);
      expect(n.assign).toHaveBeenCalledWith("/login?next=%2Flancamentos%3Fmes%3D2026-11");
    }
  });

  it("401 já em /login não redireciona de novo", () => {
    const n = nav("/login", "");
    handleBrowserApiError(new ApiError("401", 401), "query", n);
    expect(n.assign).not.toHaveBeenCalled();
  });

  it("409 context_changed em query recarrega a página", () => {
    const n = nav();
    handleBrowserApiError(conflict(), "query", n);
    expect(n.reload).toHaveBeenCalledOnce();
  });

  it("409 em mutation não recarrega e vira a mensagem para o usuário", () => {
    const n = nav();
    const e = conflict();
    handleBrowserApiError(e, "mutation", n);
    expect(n.reload).not.toHaveBeenCalled();
    expect(e.message).toBe(CONTEXT_CHANGED_MESSAGE);
  });

  it("409 com outro code não recarrega", () => {
    const n = nav();
    handleBrowserApiError(new ApiError("409", 409, { code: "conflito_qualquer" }), "query", n);
    expect(n.reload).not.toHaveBeenCalled();
  });
});
