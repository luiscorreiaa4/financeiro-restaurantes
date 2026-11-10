/**
 * Chamado quando o registro de auditoria falha DEPOIS de a troca já ter sido gravada. Recebe só o
 * nome do evento e o erro: quem implementa não deve logar `error.message` (o Drizzle põe os
 * parâmetros do SQL nela, regra 9 do CLAUDE.md).
 */
export type AuditFailureReporter = (event: string, error: unknown) => void;

/**
 * Registra a auditoria de uma troca que já aconteceu (DD-30, F1c-2). Se o registro falhar, a troca
 * continua valendo: o erro vai só para o log e o usuário não vê falha de algo que foi feito.
 * Nunca lança.
 */
export async function recordAuditSafely(
  event: string,
  record: () => Promise<unknown>,
  report?: AuditFailureReporter,
): Promise<void> {
  try {
    await record();
  } catch (error) {
    try {
      report?.(event, error);
    } catch {
      // O próprio log não pode derrubar uma troca que já foi feita.
    }
  }
}
