// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const cookieGet = vi.fn();
const currentSession = vi.fn();
const redirect = vi.fn((path: string) => {
  throw new Error(`REDIRECT:${path}`);
});

vi.mock("next/headers", () => ({ cookies: async () => ({ get: cookieGet }) }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("@/lib/auth/session", () => ({ currentSession }));

const { RedirectIfSignedIn } = await import("./redirect-if-signed-in");

const children = "formulario";

beforeEach(() => {
  vi.clearAllMocks();
  cookieGet.mockReturnValue(undefined);
});

describe("telas de acesso com sessão aberta (RF02.R9)", () => {
  it("sem cookie de sessão não chama a API e mostra o formulário", async () => {
    const result = await RedirectIfSignedIn({ children });
    expect(result).toBe(children);
    expect(currentSession).not.toHaveBeenCalled();
  });

  it("cookie com sessão válida redireciona para o destino seguro", async () => {
    cookieGet.mockImplementation((name: string) =>
      name === "better-auth.session_token" ? { value: "abc" } : undefined,
    );
    currentSession.mockResolvedValue({ access: "full" });
    await expect(RedirectIfSignedIn({ next: "/lancamentos", children })).rejects.toThrow(
      "REDIRECT:/lancamentos",
    );
  });

  it("/login?next=//evil.com logado vai para /", async () => {
    cookieGet.mockReturnValue({ value: "abc" });
    currentSession.mockResolvedValue({ access: "restricted" });
    await expect(RedirectIfSignedIn({ next: "//evil.com", children })).rejects.toThrow(
      "REDIRECT:/",
    );
  });

  it("cookie vencido (sessão nula) mostra o formulário, sem laço", async () => {
    cookieGet.mockReturnValue({ value: "velho" });
    currentSession.mockResolvedValue(null);
    expect(await RedirectIfSignedIn({ children })).toBe(children);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("cookie com nome de produção também conta", async () => {
    cookieGet.mockImplementation((name: string) =>
      name === "__Secure-better-auth.session_token" ? { value: "abc" } : undefined,
    );
    currentSession.mockResolvedValue({ access: "full" });
    await expect(RedirectIfSignedIn({ children })).rejects.toThrow("REDIRECT:/");
  });
});
