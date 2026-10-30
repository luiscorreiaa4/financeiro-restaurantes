export type Command = "undo" | "help" | "cancel" | "support";

const COMMANDS: Record<string, Command> = {
  desfazer: "undo",
  ajuda: "help",
  cancelar: "cancel",
  suporte: "support",
};

/**
 * Reconhece os comandos `desfazer`, `ajuda`, `cancelar` e `suporte`, ignorando caixa, acento, espaços nas
 * pontas ou repetidos e pontuação final ("Desfazer!", "  AJUDA  ", "ajúda?").
 * A mensagem inteira precisa ser o comando: "desfazer o almoço" não é comando.
 */
export function parseCommand(text: string): Command | null {
  const normalized = text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[\s.!?,;:]+/g, " ")
    .trim();
  return COMMANDS[normalized] ?? null;
}
