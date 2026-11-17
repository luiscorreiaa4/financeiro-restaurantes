import { normalizeName } from "./catalog";

/** Janela do "desfazer" sozinho (RF18.R1) e da busca por duplicidade (RF12.R13, RF26.R4). */
export const RECENT_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Lançamento recente, para o sinal POSSIVEL_DUPLICIDADE (RF12.R13). */
export interface RecentEntry {
  readonly inboundMessageId: string | null;
  readonly amountCents: number;
  readonly supplierId: string | null;
  readonly description: string;
  readonly occurredOn: string;
}

export interface DuplicateCandidate {
  readonly inboundMessageId: string | null;
  readonly amountCents: number;
  readonly supplierId: string | null;
  readonly description: string;
  readonly occurredOn: string;
}

/**
 * Possível duplicidade: valor igual com o mesmo fornecedor, ou mesma descrição na mesma data.
 * Um recente da mesma mensagem é ignorado; sem mensagem (painel) nada é ignorado.
 */
export function isPossibleDuplicate(
  candidate: DuplicateCandidate,
  recent: readonly RecentEntry[],
): boolean {
  const key = normalizeName(candidate.description);
  return recent.some((other) => {
    const sameMessage =
      other.inboundMessageId !== null &&
      candidate.inboundMessageId !== null &&
      other.inboundMessageId === candidate.inboundMessageId;
    if (sameMessage) return false;
    return (
      (other.amountCents === candidate.amountCents &&
        candidate.supplierId !== null &&
        other.supplierId === candidate.supplierId) ||
      (normalizeName(other.description) === key && other.occurredOn === candidate.occurredOn)
    );
  });
}
