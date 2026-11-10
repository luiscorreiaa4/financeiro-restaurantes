import type { z } from "zod";

/** Erro de chamada à API. `status` 0 = a API não respondeu (fora do ar, rede). */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export type ApiClient = {
  get<T>(path: string, schema: z.ZodType<T>): Promise<T>;
  post<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T>;
  patch<T>(path: string, body: unknown, schema: z.ZodType<T>): Promise<T>;
};

export type ApiClientOptions = {
  baseUrl: string;
  fetch?: typeof fetch;
  /** Valor do cabeçalho `X-Context` (empresa.unidade); `null` = não envia. */
  contextHeader?: () => string | null;
  /** Chamado com todo `ApiError` antes de ele ser lançado (401, 409, API fora do ar...). */
  onError?: (e: ApiError) => void;
};

export function createApiClient(options: ApiClientOptions): ApiClient {
  const doFetch = options.fetch ?? fetch;

  function fail(error: ApiError): never {
    options.onError?.(error);
    throw error;
  }

  function withContext(init: RequestInit): RequestInit {
    const context = options.contextHeader?.() ?? null;
    if (context === null) return init;
    const headers = new Headers(init.headers);
    headers.set("x-context", context);
    return { ...init, headers };
  }

  async function request<T>(path: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
    {
      let response: Response;
      try {
        response = await doFetch(`${options.baseUrl}${path}`, {
          credentials: "include",
          ...withContext(init),
        });
      } catch (cause) {
        return fail(new ApiError(`API indisponível: ${path}`, 0, cause));
      }

      const body: unknown = await response.json().catch(() => undefined);
      if (!response.ok) {
        return fail(
          new ApiError(`A API respondeu ${response.status}: ${path}`, response.status, body),
        );
      }

      const parsed = schema.safeParse(body);
      if (!parsed.success) {
        return fail(new ApiError(`Resposta fora do contrato: ${path}`, response.status, body));
      }
      return parsed.data;
    }
  }

  function withBody(method: "POST" | "PATCH"): RequestInit {
    return { method, headers: { "content-type": "application/json" } };
  }

  return {
    get: (path, schema) => request(path, {}, schema),
    post: (path, body, schema) =>
      request(path, { ...withBody("POST"), body: JSON.stringify(body) }, schema),
    patch: (path, body, schema) =>
      request(path, { ...withBody("PATCH"), body: JSON.stringify(body) }, schema),
  };
}
