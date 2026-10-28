import type { JobQueue } from "@app/core";

export interface QueuedJob {
  readonly queue: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly singletonKey?: string;
}

/** Fila para testes e desenvolvimento: guarda os jobs e respeita `singletonKey`. */
export class InMemoryQueue implements JobQueue {
  readonly jobs: QueuedJob[] = [];
  /** Quando preenchido, o próximo `enqueue` falha com este erro (simula fila fora do ar). */
  failWith: Error | null = null;
  private nextId = 1;

  async enqueue(
    queue: string,
    payload: Readonly<Record<string, unknown>>,
    options?: { singletonKey?: string; startAfterSeconds?: number },
  ): Promise<{ jobId: string | null }> {
    if (this.failWith) {
      const error = this.failWith;
      this.failWith = null;
      throw error;
    }
    const key = options?.singletonKey;
    if (key !== undefined && this.jobs.some((j) => j.queue === queue && j.singletonKey === key)) {
      return { jobId: null };
    }
    this.jobs.push({ queue, payload, ...(key === undefined ? {} : { singletonKey: key }) });
    return { jobId: String(this.nextId++) };
  }
}
