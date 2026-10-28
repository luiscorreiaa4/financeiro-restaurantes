import { createInterface } from "node:readline/promises";
import { loadEnv } from "@app/config/env";
import { createDatabase, createOutboundMessageRepo, createPool, DEV_PHONES, uuidv7 } from "@app/db";
import {
  ChatSession,
  chatBlockReason,
  parseChatInput,
  replyAddress,
  waIdFromTyped,
} from "./chat-session";

/**
 * Chat de desenvolvimento (`pnpm dev:chat`, plano do canal seção 3.6): simula o WhatsApp no
 * terminal. Só para desenvolvimento; não é produto. Precisa da API (`pnpm dev`) e do worker
 * (`pnpm dev:worker`) rodando.
 */
const env = loadEnv();
const blocked = chatBlockReason(env);
if (blocked !== null || env.WHATSAPP_APP_SECRET === undefined || !env.DATABASE_INGEST_URL) {
  console.error(`dev:chat: ${blocked ?? "configuração incompleta"}`);
  process.exit(1);
}
const appSecret = env.WHATSAPP_APP_SECRET;

const pool = createPool(env.DATABASE_INGEST_URL);
const db = createDatabase(pool);
const webhookUrl = new URL("/webhooks/whatsapp", env.API_URL);

// Largada pelo relógio do banco: o horário da máquina pode diferir do container.
const { rows } = await pool.query<{ now: Date }>("select now() as now");
const startedAt = rows[0]?.now ?? new Date();

const session = new ChatSession(
  {
    async postWebhook({ body, signature }) {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json", "x-hub-signature-256": signature },
        body,
      });
      return response.status;
    },
    outbound: createOutboundMessageRepo(db),
    async inboundStatus(waMessageId) {
      const result = await pool.query<{ status: string }>(
        "select status from inbound_messages where wa_message_id = $1",
        [waMessageId],
      );
      return result.rows[0]?.status ?? null;
    },
    appSecret,
    newId: uuidv7,
    now: () => new Date(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    pollIntervalMs: 500,
    timeoutMs: 15_000,
  },
  DEV_PHONES.owner.replace("+", ""),
  startedAt,
);

console.log("Chat de desenvolvimento (simula o WhatsApp). Só para testes.");
console.log(
  "Comandos: /como <telefone>  /sair   (previstos: /reply, /custo na E7; /audio, /foto na E9)",
);
console.log(`Telefones do seed (pnpm db:seed:dev): ${Object.values(DEV_PHONES).join(", ")}`);
console.log(`Você é ${session.currentWaId}.\n`);

const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: "Você: " });
let inputEnded = false;
rl.on("close", () => {
  inputEnded = true;
});
try {
  rl.prompt();
  // `for await` guarda as linhas que chegam durante o processamento: serve ao uso interativo
  // e a entrada por pipe (ex.: um arquivo de roteiro redirecionado para `pnpm dev:chat`).
  for await (const line of rl) {
    const input = parseChatInput(line);
    if (input.kind === "exit") break;
    if (input.kind === "message") {
      for (const out of await session.send(input.text)) console.log(out);
    } else if (input.kind === "switch_user") {
      const waId = waIdFromTyped(input.phone);
      if (waId === null) console.log("(use: /como <telefone>, por exemplo /como 11987650001)");
      else {
        session.switchUser(waId);
        console.log(`(agora você é ${waId}; as respostas chegam em ${replyAddress(waId)})`);
      }
    } else if (input.kind === "planned") {
      console.log(`(${input.command} ainda não existe: chega na ${input.stage})`);
    } else if (input.kind === "unknown_command") {
      console.log(`(comando desconhecido: ${input.command})`);
    }
    if (!inputEnded) rl.prompt();
  }
} finally {
  rl.close();
  await pool.end();
}
