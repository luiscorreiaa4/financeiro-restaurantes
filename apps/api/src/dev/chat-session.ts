import { normalizeBrazilianPhone, toWaId } from "@app/core";
import type { OutboundMessageRepo } from "@app/db";
import { buildMediaWebhookPayload, buildTextWebhookPayload, signBody } from "@app/whatsapp";

/** Linha digitada no chat, já interpretada. */
export type ChatInput =
  | { kind: "empty" }
  | { kind: "exit" }
  | { kind: "message"; text: string }
  | { kind: "switch_user"; phone: string }
  /** Responde à última confirmação recebida (preenche `context.message_id`). */
  | { kind: "reply"; text: string }
  /** Mostra o custo de IA acumulado do usuário atual. */
  | { kind: "cost" }
  /** `/audio arquivo.ogg` ou `/foto nota.jpg [legenda]`: manda a mídia de um arquivo local. */
  | { kind: "media"; media: "audio" | "image"; path: string; caption: string }
  | { kind: "unknown_command"; command: string };

export function parseChatInput(line: string): ChatInput {
  const trimmed = line.trim();
  if (trimmed === "") return { kind: "empty" };
  if (!trimmed.startsWith("/")) return { kind: "message", text: trimmed };

  const [command = "", ...rest] = trimmed.split(/\s+/);
  const name = command.toLowerCase();
  if (name === "/sair") return { kind: "exit" };
  if (name === "/como") return { kind: "switch_user", phone: rest.join(" ") };
  if (name === "/reply") return { kind: "reply", text: rest.join(" ") };
  if (name === "/custo") return { kind: "cost" };
  if (name === "/audio" || name === "/foto") {
    const [path = "", ...caption] = rest;
    return {
      kind: "media",
      media: name === "/audio" ? "audio" : "image",
      path,
      caption: caption.join(" "),
    };
  }
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
  /**
   * Copia o arquivo para a pasta de mídia de desenvolvimento e devolve o id e o tipo; nulo se o
   * arquivo não existe ou o tipo não é áudio nem imagem conhecidos.
   */
  stageMedia(path: string): Promise<{ mediaId: string; mimeType: string } | null>;
  /** Chamadas e custo de IA do usuário do telefone informado, ou nulo se não é conhecido. */
  usageSummary(waId: string): Promise<{ calls: number; costUsdMicros: number } | null>;
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
  private lastConfirmation: string | null = null;

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

  /** Responde à última confirmação recebida, como o "responder" do WhatsApp (RF17, RF18.R2). */
  async reply(text: string): Promise<string[]> {
    if (this.lastConfirmation === null) {
      return ["(ainda não recebi nenhuma confirmação para responder)"];
    }
    if (text === "") return ["(use: /reply <texto>, por exemplo /reply foi 400)"];
    return this.send(text, this.lastConfirmation);
  }

  async cost(): Promise<string[]> {
    const summary = await this.deps.usageSummary(this.waId);
    if (summary === null) return ["(esse telefone não é de um usuário conhecido)"];
    const usd = (summary.costUsdMicros / 1_000_000).toFixed(5);
    return [`(custo de IA: US$ ${usd} em ${summary.calls} chamada(s))`];
  }

  /** Manda um áudio ou uma foto de um arquivo local, pelo mesmo caminho do webhook real. */
  async sendMedia(media: "audio" | "image", path: string, caption: string): Promise<string[]> {
    if (path === "") return ["(use: /audio <arquivo> ou /foto <arquivo> [legenda])"];
    const staged = await this.deps.stageMedia(path);
    if (staged === null) {
      return [
        `(não achei um arquivo de ${media === "audio" ? "áudio" : "imagem"} válido em ${path})`,
      ];
    }
    const waMessageId = `dev.wamid.${this.deps.newId()}`;
    return this.deliver(
      buildMediaWebhookPayload({
        waId: this.waId,
        waMessageId,
        kind: media,
        mediaId: staged.mediaId,
        mimeType: staged.mimeType,
        ...(caption === "" || media === "audio" ? {} : { caption }),
        sentAt: this.deps.now(),
      }),
      waMessageId,
    );
  }

  async send(text: string, replyToWaMessageId?: string): Promise<string[]> {
    const waMessageId = `dev.wamid.${this.deps.newId()}`;
    return this.deliver(
      buildTextWebhookPayload({
        waId: this.waId,
        waMessageId,
        text,
        replyToWaMessageId,
        sentAt: this.deps.now(),
      }),
      waMessageId,
    );
  }

  private async deliver(payload: unknown, waMessageId: string): Promise<string[]> {
    const { deps } = this;
    const body = JSON.stringify(payload);
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
      if (row.purpose === "confirmation") this.lastConfirmation = row.waMessageId;
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
    : "(sem resposta para essa mensagem)";
}
