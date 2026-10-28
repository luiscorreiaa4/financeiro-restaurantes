import { normalizeBrazilianPhone, toWaId } from "@app/core";
import type { OutboundMessageRepo } from "@app/db";
import { buildTextWebhookPayload, signBody } from "@app/whatsapp";

/** Linha digitada no chat, já interpretada. */
export type ChatInput =
  | { kind: "empty" }
  | { kind: "exit" }
  | { kind: "message"; text: string }
  | { kind: "switch_user"; phone: string }
  /** Comando previsto no plano (seção 3.6) que ainda não existe. */
  | { kind: "planned"; command: string; stage: string }
  | { kind: "unknown_command"; command: string };

const PLANNED: Record<string, string> = {
  "/reply": "E7",
  "/custo": "E7",
  "/audio": "E9",
  "/foto": "E9",
};

export function parseChatInput(line: string): ChatInput {
  const trimmed = line.trim();
  if (trimmed === "") return { kind: "empty" };
  if (!trimmed.startsWith("/")) return { kind: "message", text: trimmed };

  const [command = "", ...rest] = trimmed.split(/\s+/);
  const name = command.toLowerCase();
  if (name === "/sair") return { kind: "exit" };
  if (name === "/como") return { kind: "switch_user", phone: rest.join(" ") };
  const stage = PLANNED[name];
  if (stage !== undefined) return { kind: "planned", command: name, stage };
  return { kind: "unknown_command", command: name };
}

/**
 * `wa_id` que o chat envia como remetente, a partir do que foi digitado: só dígitos. Sem "+" e
 * com 10 ou 11 dígitos, falta o 55 e ele é acrescentado; com "+", vale exatamente o que foi
 * digitado (permite testar números de outros países). O 9º dígito fica como digitado, para
 * testar as duas formas que a Meta entrega.
 */
export function waIdFromTyped(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (digits === "") return null;
  if (input.trim().startsWith("+")) return digits;
  return digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
}

/** Endereço para onde o worker responde esse remetente: E.164 canônico sem o "+". */
export function replyAddress(waId: string): string {
  const phone = normalizeBrazilianPhone(waId);
  return phone.ok ? toWaId(phone.value.e164) : waId;
}

/** O chat é só para desenvolvimento e assina com o App Secret: recusa os ambientes errados. */
export function chatBlockReason(env: {
  NODE_ENV: string;
  CHANNEL_MODE: string;
  WHATSAPP_APP_SECRET?: string | undefined;
  DATABASE_INGEST_URL?: string | undefined;
}): string | null {
  if (env.NODE_ENV === "production")
    return "o chat de desenvolvimento não roda com NODE_ENV=production";
  if (env.CHANNEL_MODE !== "dev") return "o chat exige CHANNEL_MODE=dev";
  if (env.WHATSAPP_APP_SECRET === undefined) {
    return "defina WHATSAPP_APP_SECRET no .env (o chat assina os payloads como a Meta)";
  }
  if (env.DATABASE_INGEST_URL === undefined) return "defina DATABASE_INGEST_URL no .env";
  return null;
}

export interface ChatDeps {
  /** POST no webhook local; devolve o status HTTP. */
  postWebhook(input: { body: string; signature: string }): Promise<number>;
  outbound: Pick<OutboundMessageRepo, "listSince">;
  /** Estado da mensagem recebida (`received`, `processing`, `processed`, `failed`…), ou nulo. */
  inboundStatus(waMessageId: string): Promise<string | null>;
  appSecret: string;
  newId(): string;
  now(): Date;
  sleep(ms: number): Promise<void>;
  /** Intervalo entre consultas e tempo máximo de espera pela resposta. */
  pollIntervalMs: number;
  timeoutMs: number;
}

const FINAL = new Set(["processed", "failed", "needs_answer"]);

/**
 * Uma conversa do chat de desenvolvimento. Monta o payload no formato real da Cloud API, assina
 * e envia ao webhook (mesmo caminho da produção) e espera as respostas que o worker grava pelo
 * `DevMessageSender`. Devolve as linhas a mostrar; quem imprime é o programa do terminal.
 */
export class ChatSession {
  private waId: string;
  private since: Date;
  private readonly seen = new Set<string>();

  constructor(
    private readonly deps: ChatDeps,
    startWaId: string,
    startedAt: Date,
  ) {
    this.waId = startWaId;
    this.since = startedAt;
  }

  get currentWaId(): string {
    return this.waId;
  }

  switchUser(waId: string): void {
    this.waId = waId;
  }

  async send(text: string): Promise<string[]> {
    const { deps } = this;
    const waMessageId = `dev.wamid.${deps.newId()}`;
    const body = JSON.stringify(
      buildTextWebhookPayload({ waId: this.waId, waMessageId, text, sentAt: deps.now() }),
    );
    const status = await deps.postWebhook({
      body,
      signature: signBody(new TextEncoder().encode(body), deps.appSecret),
    });
    if (status !== 200) return [`(o webhook respondeu ${status}; a mensagem não foi aceita)`];

    const lines: string[] = [];
    let answers = 0;
    const deadline = deps.now().getTime() + deps.timeoutMs;
    for (;;) {
      const state = await deps.inboundStatus(waMessageId);
      // Consulta as respostas depois do estado: se já terminou, esta é a última leitura.
      const fresh = await this.collectAnswers();
      answers += fresh.length;
      lines.push(...fresh);
      if (state !== null && FINAL.has(state)) {
        if (state === "failed") lines.push("(o processamento falhou; veja o log do worker)");
        else if (answers === 0) lines.push(noAnswerNote(state));
        return lines;
      }
      if (deps.now().getTime() >= deadline) {
        lines.push("(sem resposta a tempo: o worker está rodando? use `pnpm dev:worker`)");
        return lines;
      }
      await deps.sleep(deps.pollIntervalMs);
    }
  }

  private async collectAnswers(): Promise<string[]> {
    const rows = await this.deps.outbound.listSince(replyAddress(this.waId), this.since);
    const lines: string[] = [];
    for (const row of rows) {
      if (this.seen.has(row.waMessageId)) continue;
      this.seen.add(row.waMessageId);
      if (row.createdAt > this.since) this.since = row.createdAt;
      lines.push(
        ...row.text.split("\n").map((line, i) => (i === 0 ? `Bot: ${line}` : `     ${line}`)),
      );
    }
    return lines;
  }
}

function noAnswerNote(state: string): string {
  return state === "needs_answer"
    ? "(a mensagem aguarda uma resposta sua)"
    : "(sem resposta: este ramo ainda não está implementado; a extração por IA chega na E6)";
}
