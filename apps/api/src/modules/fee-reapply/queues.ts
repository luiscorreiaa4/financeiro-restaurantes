import { z } from "zod";

export const FEE_REAPPLY_QUEUE = "fee-reapply";

/** Só ids: período, alvo e taxa o job relê da linha `fee_reapplications`. */
export const feeReapplyJobSchema = z.object({
  tenantId: z.uuid(),
  reapplicationId: z.uuid(),
});

export type FeeReapplyJob = z.infer<typeof feeReapplyJobSchema>;

export interface FeeReapplyJobAttempt {
  /** Quantas vezes o job já foi retentado (0 na primeira execução). */
  readonly retryCount: number;
  readonly retryLimit: number;
}

export type FeeReapplyJobOutcome = "done" | "skipped";

/** Códigos curtos gravados em `fee_reapplications.error_code`. */
export const FEE_REAPPLY_ERROR_CODES = [
  "rate_changed",
  "target_not_found",
  "queue_unavailable",
  "job_failed",
] as const;
