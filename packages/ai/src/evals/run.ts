/**
 * Runner dos evals (E8): manda cada caso do dataset ao modelo REAL e mede por campo e por
 * lançamento. Gasta crédito: tem trava de orçamento.
 *
 *   pnpm --filter @app/ai eval                     # roda, imprime métricas e compara com o baseline
 *   pnpm --filter @app/ai eval -- --update-baseline # grava as métricas atuais como baseline
 *   pnpm --filter @app/ai eval -- --only=f01,m02    # só alguns casos (barato, para depurar)
 *   pnpm --filter @app/ai eval -- --max-usd=0.5     # trava de orçamento (padrão US$ 1,00)
 *   pnpm --filter @app/ai eval -- --verbose         # mostra a saída bruta dos casos que erram
 *
 * Sai com código 1 se alguma métrica protegida cair além da tolerância do baseline (RNF07.R4).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { AiUsageRecord } from "@app/core";
import { createClaudeEntryExtractor } from "../claude/claude-entry-extractor";
import { createAnthropicLlmClient } from "../claude/llm-client";
import { EVAL_CONTEXT } from "./context";
import { EVAL_TODAY, loadDataset } from "./dataset";
import { compareToBaseline, formatMetrics } from "./report";
import { aggregate, type CaseScore, type Metrics, observe, scoreCase } from "./score";

const BASELINE_PATH = fileURLToPath(new URL("./baseline.json", import.meta.url));
const LAST_RUN_PATH = fileURLToPath(new URL("./last-run.json", import.meta.url));

function flag(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}
const has = (name: string) => process.argv.includes(`--${name}`);

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("Defina ANTHROPIC_API_KEY (no .env da raiz).");
  process.exit(1);
}
const maxUsd = Number(flag("max-usd") ?? "1");
const only = flag("only")?.split(",");

const dataset = loadDataset().filter((evalCase) => !only || only.includes(evalCase.id));
const extractor = createClaudeEntryExtractor({
  llm: createAnthropicLlmClient(apiKey),
  models: {
    default: process.env.AI_MODEL_DEFAULT ?? "claude-haiku-5-5",
    advanced: process.env.AI_MODEL_ADVANCED ?? "claude-sonnet-5-5",
  },
});

const scores: CaseScore[] = [];
let spentMicros = 0;
for (const evalCase of dataset) {
  if (spentMicros / 1_000_000 > maxUsd) {
    console.error(
      `\nTrava de orçamento: passou de US$ ${maxUsd}. Parando em ${scores.length} casos.`,
    );
    break;
  }
  const usage: AiUsageRecord[] = [];
  const startedAt = performance.now();
  const outcome = await extractor.extract({
    text: evalCase.text,
    context: EVAL_CONTEXT,
    today: EVAL_TODAY,
    onUsage: (record) => usage.push(record),
  });
  const latencyMs = Math.round(performance.now() - startedAt);
  const costUsdMicros = usage.reduce((sum, item) => sum + item.costUsdMicros, 0);
  spentMicros += costUsdMicros;

  const score = scoreCase(evalCase, outcome.ok ? observe(outcome.value.result) : null, {
    costUsdMicros,
    latencyMs,
  });
  scores.push(score);
  const wrong =
    !score.intentOk ||
    !score.askOk ||
    !score.countOk ||
    score.entries.some((entry) => !entry.exact);
  if (wrong) {
    const fields = score.entries.flatMap((entry, index) =>
      Object.entries(entry)
        .filter(([key, value]) => key !== "exact" && value === false)
        .map(([key]) => `${index + 1}:${key.replace(/Ok$/, "")}`),
    );
    const notes = [
      score.failed ? "extração falhou" : null,
      score.intentOk ? null : "intenção",
      score.askOk ? null : score.expectedAsks ? "devia perguntar" : "perguntou sem precisar",
      score.countOk ? null : "nº de lançamentos",
      ...fields,
    ].filter((note) => note !== null);
    console.log(
      `✗ ${evalCase.id} [${evalCase.category}] ${JSON.stringify(evalCase.text)} → ${notes.join(", ")}`,
    );
    if (has("verbose") && outcome.ok)
      console.log(`   saída: ${JSON.stringify(outcome.value.result)}`);
  }
}

const metrics: Metrics = aggregate(
  scores,
  new Map(dataset.map((evalCase) => [evalCase.id, evalCase.expected])),
);
console.log(`\n${formatMetrics(metrics)}`);
console.log(`Gasto desta rodada: US$ ${(spentMicros / 1_000_000).toFixed(4)}`);
writeFileSync(LAST_RUN_PATH, `${JSON.stringify({ metrics, scores }, null, 2)}\n`);

if (has("update-baseline")) {
  if (only) {
    console.error("--update-baseline exige a rodada completa (sem --only).");
    process.exit(1);
  }
  writeFileSync(BASELINE_PATH, `${JSON.stringify(metrics, null, 2)}\n`);
  console.log("Baseline atualizado.");
} else if (existsSync(BASELINE_PATH) && !only) {
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Metrics;
  const comparison = compareToBaseline(metrics, baseline);
  if (!comparison.ok) {
    for (const item of comparison.regressions) {
      console.error(`PIOROU ${item.metric}: ${item.baseline} → ${item.current}`);
    }
    process.exit(1);
  }
  console.log("Dentro da tolerância do baseline.");
}
