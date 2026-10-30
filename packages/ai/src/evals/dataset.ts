import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/** Data fixa dos casos: sexta-feira, 30/10/2026. "Ontem" é 2026-10-29. */
export const EVAL_TODAY = "2026-10-30";

export const CASE_CATEGORIES = [
  "easy",
  "multi",
  "ambiguous",
  "typo",
  "out_of_scope",
  "amount_format",
] as const;

const ExpectedEntrySchema = z.object({
  type: z.enum(["expense", "revenue"]),
  amount_cents: z.number().int().positive(),
  /** Ausente = hoje (a interpretação do sistema preenche). */
  occurred_on: z.iso.date().optional(),
  quantity: z.number().optional(),
  /** Campos opcionais: só são pontuados quando o caso os traz. */
  category: z.string().optional(),
  supplier: z.string().optional(),
  payment: z.string().optional(),
  channel: z.string().optional(),
});
export type ExpectedEntry = z.infer<typeof ExpectedEntrySchema>;

export const EvalCaseSchema = z.object({
  id: z.string().min(1),
  category: z.enum(CASE_CATEGORIES),
  text: z.string().min(1),
  expected: z.object({
    intent: z.enum(["register", "out_of_scope", "unclear"]),
    /** Lançamentos que devem sair prontos para gravar, na ordem da mensagem. */
    ready: z.array(ExpectedEntrySchema).default([]),
    /** O sistema deve perguntar algo (lançamento incompleto, conta que não bate, data futura). */
    asks: z.boolean().default(false),
  }),
});
export type EvalCase = z.infer<typeof EvalCaseSchema>;

export function parseDataset(content: string): EvalCase[] {
  const cases = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((line, index) => {
      const parsed = EvalCaseSchema.safeParse(JSON.parse(line));
      if (!parsed.success) {
        throw new Error(`dataset.jsonl, caso ${index + 1}: ${parsed.error.issues[0]?.message}`);
      }
      return parsed.data;
    });
  const ids = new Set<string>();
  for (const evalCase of cases) {
    if (ids.has(evalCase.id)) throw new Error(`dataset.jsonl: id repetido ${evalCase.id}`);
    ids.add(evalCase.id);
  }
  return cases;
}

export const DATASET_PATH = fileURLToPath(new URL("./dataset.jsonl", import.meta.url));

export function loadDataset(path: string = DATASET_PATH): EvalCase[] {
  return parseDataset(readFileSync(path, "utf8"));
}
