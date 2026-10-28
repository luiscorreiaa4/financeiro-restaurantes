import type { InboundIngestRepo, JobQueue } from "@app/core";
import { parseWebhook } from "@app/whatsapp";

export const PROCESS_INBOUND_QUEUE = "process-inbound";

export type ProcessInboundJob = {
  readonly inboundMessageId: string;
  readonly waMessageId: string;
};

export interface IngestResult {
  readonly messages: number;
  readonly newMessages: number;
  readonly enqueued: number;
  readonly statuses: number;
  readonly newStatuses: number;
  readonly invalidItems: number;
}

export type IngestWebhook = (payload: unknown) => Promise<IngestResult>;

/**
 * Caso de uso do webhook: percorre todos os eventos do POST, grava as mensagens e os
 * status (idempotente) e enfileira `process-inbound` uma vez por mensagem.
 *
 * A reentrega de uma mensagem que ainda está `received` enfileira de novo (a chave única
 * da fila impede duplicar se o job original ainda existe). Isso cobre a falha entre gravar
 * e enfileirar: o erro vira 500, a Meta reenvia e o job é recriado.
 */
export function createIngestWebhook(deps: {
  repo: InboundIngestRepo;
  queue: JobQueue;
}): IngestWebhook {
  return async (payload) => {
    const parsed = parseWebhook(payload);
    const stored = await deps.repo.saveMessages(parsed.messages);
    const newStatuses = await deps.repo.saveStatuses(parsed.statuses);

    let enqueued = 0;
    for (const message of stored) {
      if (!message.isNew && message.status !== "received") continue;
      const job: ProcessInboundJob = {
        inboundMessageId: message.id,
        waMessageId: message.waMessageId,
      };
      const { jobId } = await deps.queue.enqueue(PROCESS_INBOUND_QUEUE, job, {
        singletonKey: message.waMessageId,
      });
      if (jobId !== null) enqueued += 1;
    }

    return {
      messages: parsed.messages.length,
      newMessages: stored.filter((message) => message.isNew).length,
      enqueued,
      statuses: parsed.statuses.length,
      newStatuses,
      invalidItems: parsed.invalidItems,
    };
  };
}
