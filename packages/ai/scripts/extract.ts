/**
 * Script da E6: manda frases direto para a IA (sem banco, sem fila) e imprime os lançamentos
 * extraídos com o custo de cada mensagem. Gasta crédito de verdade.
 *
 *   pnpm --filter @app/ai extract                       # usa scripts/frases.txt
 *   pnpm --filter @app/ai extract "paguei 350 de carne"  # só as frases dadas
 *
 * Lê ANTHROPIC_API_KEY do ambiente; `pnpm --filter @app/ai extract` carrega o `.env` da raiz.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  type AiUsageRecord,
  formatBRL,
  interpretExtraction,
  type TenantExtractionContext,
} from "@app/core";
import { createAnthropicLlmClient, createClaudeEntryExtractor } from "../src";

const CONTEXT: TenantExtractionContext = {
  categories: ["Carnes e peixes", "Hortifruti", "Bebidas", "Gás", "Outras despesas", "Vendas"],
  suppliers: ["Atacadão", "Ceasa", "Ambev"],
  units: ["Restaurante Centro"],
  paymentMethods: ["Dinheiro", "Pix", "Débito", "Crédito"],
};

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("Defina ANTHROPIC_API_KEY (no .env da raiz).");
  process.exit(1);
}

const defaultFile = fileURLToPath(new URL("./frases.txt", import.meta.url));
const phrases =
  process.argv.length > 2
    ? process.argv.slice(2)
    : readFileSync(defaultFile, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== "" && !line.startsWith("#"));

const extractor = createClaudeEntryExtractor({
  llm: createAnthropicLlmClient(apiKey),
  models: {
    default: process.env.AI_MODEL_DEFAULT ?? "claude-haiku-5-5",
    advanced: process.env.AI_MODEL_ADVANCED ?? "claude-sonnet-5-5",
  },
});

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(
  new Date(),
);
const usd = (micros: number) => `US$ ${(micros / 1_000_000).toFixed(5)}`;
let totalMicros = 0;

for (const phrase of phrases) {
  console.log(`\n> ${phrase}`);
  const outcome = await extractor.extract({ text: phrase, context: CONTEXT, today });
  if (!outcome.ok) {
    console.log(`  erro: ${outcome.error.code}`);
    continue;
  }
  const usage: readonly AiUsageRecord[] = outcome.value.usage;
  const cost = usage.reduce((sum, item) => sum + item.costUsdMicros, 0);
  totalMicros += cost;

  const interpretation = interpretExtraction(outcome.value.result, today);
  if (interpretation.kind === "out_of_scope") console.log("  fora do escopo");
  else if (interpretation.kind === "unclear") console.log(`  pergunta: ${interpretation.question}`);
  else {
    for (const entry of interpretation.ready) {
      const quantity = entry.extracted.quantity
        ? ` ${entry.extracted.quantity}${entry.extracted.quantity_unit ?? ""}`
        : "";
      console.log(
        `  ✔ ${entry.extracted.type} ${formatBRL(entry.amountCents)} "${entry.description}"${quantity} em ${entry.occurredOn}` +
          ` [cat: ${entry.extracted.category_hint ?? "-"} | forn: ${entry.extracted.supplier_hint ?? "-"} | pgto: ${entry.extracted.payment_method_hint ?? "-"} | canal: ${entry.extracted.sales_channel_hint ?? "-"}]` +
          (entry.flags.length > 0 ? ` sinais: ${entry.flags.join(",")}` : ""),
      );
    }
    for (const entry of interpretation.pending) {
      console.log(`  … pendente "${entry.extracted.description}": ${entry.reasons.join(", ")}`);
    }
    if (interpretation.modelQuestion) console.log(`  pergunta: ${interpretation.modelQuestion}`);
  }
  const detail = usage
    .map(
      (item) =>
        `${item.model} in=${item.inputTokens} out=${item.outputTokens} cache_lido=${item.cacheReadTokens} cache_escrito=${item.cacheWriteTokens}`,
    )
    .join(" | ");
  console.log(`  custo: ${usd(cost)} (${detail})`);
}

console.log(`\nTotal: ${usd(totalMicros)} em ${phrases.length} frases.`);
