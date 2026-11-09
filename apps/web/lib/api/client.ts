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
};

export function createApiClient(options: { baseUrl: string; fetch?: typeof fetch }): ApiClient {
  const doFetch = options.fetch ?? fetch;

  async function request<T>(path: string, init: RequestInit, schema: z.ZodType<T>): Promise<T> {
    {
      let response: Response;
      try {
        response = await doFetch(`${options.baseUrl}${path}`, { credentials: "include", ...init });
      } catch (cause) {
        throw new ApiError(`API indisponível: ${path}`, 0, cause);
      }

      const body: unknown = await response.json().catch(() => undefined);
      if (!response.ok) {
        throw new ApiError(`A API respondeu ${response.status}: ${path}`, response.status, body);
      }

      const parsed = schema.safeParse(body);
      if (!parsed.success) {
        throw new ApiError(`Resposta fora do contrato: ${path}`, response.status, body);
      }
      return parsed.data;
    }
  }

  return {
    get: (path, schema) => request(path, {}, schema),
    post: (path, body, schema) =>
      request(
        path,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
        schema,
      ),
  };
}
