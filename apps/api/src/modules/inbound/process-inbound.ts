import type { ClaimedInboundMessage, InboundProcessingRepo } from "@app/core";
import { z } from "zod";
import type { JobLogger } from "../../infra/logger";
import type { ProcessInboundJob } from "./ingest-webhook";

const processInboundJobSchema = z.object({
  inboundMessageId: z.uuid(),
  waMessageId: z.string().min(1),
}) satisfies z.ZodType<ProcessInboundJob>;

/**
 * Porta do roteamento da mensagem (comando, reply, pergunta pendente, IA). A E5 troca o padrão
 * pela implementação real. Se lançar erro, o job é retentado; na última tentativa a mensagem
 * fica `failed`.
 */
export type RouteInbound = (message: ClaimedInboundMessage) => Promise<void>;

/** Padrão da E4: ainda não há roteamento, a mensagem só atravessa o ciclo de estados. */
export const routeNothing: RouteInbound = async () => {};

export interface JobAttempt {
  /** Quantas vezes o job já foi retentado (0 na primeira execução). */
  readonly retryCount: number;
  readonly retryLimit: number;
}

export type ProcessInboundOutcome =
  /** Terminou nesta execução. */
  | "processed"
  /** Nada a fazer: a mensagem já foi concluída (reentrega, job duplicado ou worker concorrente). */
  | "skipped"
  /** Payload do job fora do contrato; não adianta retentar. */
  | "invalid_payload";

export type ProcessInbound = (data: unknown, attempt: JobAttempt) => Promise<ProcessInboundOutcome>;

/**
 * Caso de uso do worker `process-inbound`. Idempotente: as transições são `UPDATE`s guardados
 * (ver `InboundProcessingRepo`), então reprocessar o mesmo job nunca repete o efeito. Erros do
 * roteamento sobem para o pg-boss retentar; na última tentativa a mensagem é marcada `failed`
 * com um código curto (nunca o conteúdo, regra 9).
 */
export function createProcessInbound(deps: {
  repo: InboundProcessingRepo;
  route: RouteInbound;
  logger: JobLogger;
}): ProcessInbound {
  return async (data, attempt) => {
    const parsed = processInboundJobSchema.safeParse(data);
    if (!parsed.success) {
      deps.logger.error({ issues: parsed.error.issues.length }, "job process-inbound inválido");
      return "invalid_payload";
    }
    const { inboundMessageId } = parsed.data;
    const startedAt = performance.now();
    const fields = { inboundMessageId, retryCount: attempt.retryCount };

    const message = await deps.repo.claim(inboundMessageId);
    if (message === null) {
      deps.logger.info(fields, "mensagem já concluída ou inexistente, job ignorado");
      return "skipped";
    }

    try {
      await deps.route(message);
      await deps.repo.markProcessed(inboundMessageId);
    } catch (error) {
      const errorCode = describeError(error);
      const lastAttempt = attempt.retryCount >= attempt.retryLimit;
      if (lastAttempt) await deps.repo.markFailed(inboundMessageId, errorCode);
      deps.logger.warn(
        { ...fields, errorCode, lastAttempt, durationMs: elapsed(startedAt) },
        lastAttempt
          ? "mensagem falhou após todas as tentativas"
          : "erro ao processar, vai retentar",
      );
      throw error;
    }

    deps.logger.info({ ...fields, durationMs: elapsed(startedAt) }, "mensagem processada");
    return "processed";
  };
}

const elapsed = (startedAt: number) => Math.round(performance.now() - startedAt);

/**
 * Código curto e seguro do erro. Nunca a mensagem: erros do Drizzle trazem os parâmetros do
 * SQL, que podem conter o texto do usuário.
 */
export function describeError(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? `${error.name}:${code}` : error.name;
  }
  return "UnknownError";
}
