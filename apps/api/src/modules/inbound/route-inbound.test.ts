import {
  type ClaimedInboundMessage,
  err,
  type InboundSenderRepo,
  type MessageSender,
  ok,
  type ReplyTarget,
  type SenderMembership,
  type TenantConversationRepo,
} from "@app/core";
import { describe, expect, it } from "vitest";
import { createLogger } from "../../infra/logger";
import { NOTHING_TO_UNDO_TEXT, UNSUPPORTED_TYPE_TEXT } from "./messages";
import {
  createRouteInbound,
  defaultHandlers,
  type RouteHandlers,
  SenderConflictError,
  SendFailedError,
} from "./route-inbound";

const TENANT_A = "0190a1b2-0000-7000-8000-00000000000a";
const TENANT_B = "0190a1b2-0000-7000-8000-00000000000b";
const NOW = new Date("2026-10-28T15:00:00Z");
const SECRET_TEXT = "paguei 350 pro seu Zé do peixe";

function membership(overrides: Partial<SenderMembership> = {}): SenderMembership {
  return {
    membershipId: "m1",
    tenantId: TENANT_A,
    tenantName: "Restaurante A",
    userId: "user-1",
    userName: "Dono",
    role: "owner",
    unitId: null,
    tenantUnitIds: ["unit-1"],
    createdAt: new Date("2026-01-01T00:00:00Z"),
    deactivatedAt: null,
    ...overrides,
  };
}

function inbound(overrides: Partial<ClaimedInboundMessage> = {}): ClaimedInboundMessage {
  return {
    id: "in-1",
    waMessageId: "dev.wamid.1",
    waId: "551187654321",
    waUserId: null,
    type: "text",
    text: SECRET_TEXT,
    replyToWaMessageId: null,
    ...overrides,
  };
}

interface Options {
  memberships?: SenderMembership[];
  replyTargets?: Record<string, ReplyTarget>;
  pending?: boolean;
  assignOk?: boolean;
  sendFails?: boolean;
  supportContact?: string;
}

function setup(options: Options = {}) {
  const calls = {
    lookups: [] as (readonly string[])[],
    assigned: [] as { id: string; tenantId: string; userId: string }[],
    optIns: [] as { tenantId: string; userId: string; inboundMessageId: string }[],
    sent: [] as { to: string; text: string; tenantId: string | null; purpose: string }[],
    handlers: [] as string[],
    replyLookups: [] as string[],
  };
  const lines: string[] = [];
  const logger = createLogger("info", { write: (line) => lines.push(line) });

  const sender: MessageSender = {
    async sendText({ to, text, trace }) {
      if (options.sendFails) return err({ code: "SendFailed" as const, detail: "x" });
      calls.sent.push({
        to,
        text,
        tenantId: trace?.tenantId ?? null,
        purpose: trace?.purpose ?? "?",
      });
      return ok({ waMessageId: "dev.out.1" });
    },
    async markAsRead() {
      return ok(true as const);
    },
    async showTyping() {
      return ok(true as const);
    },
  };
  const senderRepo: InboundSenderRepo = {
    async assignSender(id, who) {
      calls.assigned.push({ id, ...who });
      return options.assignOk ?? true;
    },
  };
  const optedIn = new Set<string>();
  const conversation: TenantConversationRepo = {
    async recordOptIn(input) {
      calls.optIns.push(input);
      const key = `${input.tenantId}:${input.userId}`;
      if (optedIn.has(key)) return false;
      optedIn.add(key);
      return true;
    },
    async findReplyTarget(_tenantId, waMessageId) {
      calls.replyLookups.push(waMessageId);
      return options.replyTargets?.[waMessageId] ?? null;
    },
    async hasPendingQuestion() {
      return options.pending ?? false;
    },
  };
  const handlers: RouteHandlers = {
    ...defaultHandlers(logger),
    correction: async (_context, target) => {
      calls.handlers.push(`correction:${target.outboundMessageId}`);
    },
    pendingAnswer: async () => {
      calls.handlers.push("pending_answer");
    },
    extract: async () => {
      calls.handlers.push("extract");
    },
  };

  const route = createRouteInbound({
    directory: {
      async findMemberships(candidates) {
        calls.lookups.push(candidates);
        return options.memberships ?? [];
      },
    },
    senderRepo,
    conversation,
    sender,
    clock: { now: () => NOW },
    handlers,
    supportContact: options.supportContact,
    logger,
  });
  return { route, calls, lines };
}

describe("roteamento da mensagem recebida", () => {
  describe("número desconhecido", () => {
    it("responde o texto padrão, sem tenant, sem atribuir a mensagem e sem chamar a IA", async () => {
      const { route, calls } = setup({ supportContact: "suporte@exemplo.com.br" });
      await route(inbound());
      expect(calls.sent).toHaveLength(1);
      expect(calls.sent[0]).toMatchObject({
        to: "+5511987654321",
        tenantId: null,
        purpose: "notice",
      });
      expect(calls.sent[0]?.text).toContain("Não encontrei este número cadastrado");
      expect(calls.sent[0]?.text).toContain("suporte@exemplo.com.br");
      expect(calls.assigned).toEqual([]);
      expect(calls.optIns).toEqual([]);
      expect(calls.handlers).toEqual([]);
    });

    it("não expõe nenhum dado: a resposta não traz nome de restaurante nem de pessoa", async () => {
      const { route, calls } = setup();
      await route(inbound());
      expect(calls.sent[0]?.text).not.toMatch(/Restaurante|Dono/);
    });

    it("sem contato de suporte configurado, manda falar com o suporte", async () => {
      const { route, calls } = setup();
      await route(inbound());
      expect(calls.sent[0]?.text).toContain("fale com o suporte");
    });

    it("usuário desativado recebe a mesma resposta de quem nunca foi cadastrado", async () => {
      const desconhecido = setup();
      await desconhecido.route(inbound());
      const desativado = setup({
        memberships: [membership({ deactivatedAt: new Date("2026-09-01T00:00:00Z") })],
      });
      await desativado.route(inbound());
      expect(desativado.calls.sent[0]).toEqual(desconhecido.calls.sent[0]);
      expect(desativado.calls.assigned).toEqual([]);
      expect(desativado.calls.optIns).toEqual([]);
    });

    it("comando de número desconhecido não é executado", async () => {
      const { route, calls } = setup();
      await route(inbound({ text: "desfazer" }));
      expect(calls.sent[0]?.text).toContain("Não encontrei este número");
    });

    it("telefone que não é brasileiro também recebe a resposta padrão", async () => {
      const { route, calls } = setup();
      await route(inbound({ waId: "14155550123" }));
      expect(calls.lookups[0]).toEqual([]);
      expect(calls.sent[0]).toMatchObject({ to: "+14155550123", tenantId: null });
    });

    it("mensagem sem remetente não gera resposta nem erro", async () => {
      const { route, calls, lines } = setup();
      await route(inbound({ waId: null }));
      expect(calls.sent).toEqual([]);
      expect(lines.join("")).toContain("mensagem sem remetente");
    });
  });

  describe("busca do telefone", () => {
    it.each([
      ["551187654321", ["+5511987654321", "+551187654321"]],
      ["5511987654321", ["+5511987654321", "+551187654321"]],
      ["551133334444", ["+551133334444"]],
    ])("wa_id %s procura o usuário nos formatos com e sem o 9º dígito", async (waId, expected) => {
      const { route, calls } = setup();
      await route(inbound({ waId }));
      expect(calls.lookups[0]).toEqual(expected);
    });

    it("responde sempre no formato com o 9º dígito, aceito no envio", async () => {
      const { route, calls } = setup({ memberships: [membership()] });
      await route(inbound({ waId: "551187654321", text: "ajuda" }));
      expect(calls.sent[0]?.to).toBe("+5511987654321");
    });
  });

  describe("usuário conhecido", () => {
    it("atribui a mensagem ao tenant e registra o opt-in", async () => {
      const { route, calls } = setup({ memberships: [membership()] });
      await route(inbound());
      expect(calls.assigned).toEqual([{ id: "in-1", tenantId: TENANT_A, userId: "user-1" }]);
      expect(calls.optIns).toEqual([
        { tenantId: TENANT_A, userId: "user-1", inboundMessageId: "in-1" },
      ]);
    });

    it("em dois restaurantes usa o vínculo mais antigo", async () => {
      const { route, calls } = setup({
        memberships: [
          membership({
            membershipId: "novo",
            tenantId: TENANT_B,
            createdAt: new Date("2026-05-01"),
          }),
          membership({ membershipId: "antigo", tenantId: TENANT_A }),
        ],
      });
      await route(inbound({ text: "ajuda" }));
      expect(calls.assigned[0]?.tenantId).toBe(TENANT_A);
      expect(calls.sent[0]?.tenantId).toBe(TENANT_A);
    });

    it("falha de atribuição (mensagem de outro restaurante) é erro, sem resposta", async () => {
      const { route, calls } = setup({ memberships: [membership()], assignOk: false });
      await expect(route(inbound())).rejects.toBeInstanceOf(SenderConflictError);
      expect(calls.sent).toEqual([]);
    });
  });

  describe("comandos", () => {
    it.each(["ajuda", "AJUDA!", " Ajúda? "])(
      "%j responde a ajuda sem chamar a IA",
      async (text) => {
        const { route, calls } = setup({
          memberships: [membership()],
          supportContact: "suporte@exemplo.com.br",
        });
        await route(inbound({ text }));
        expect(calls.sent).toHaveLength(1);
        expect(calls.sent[0]).toMatchObject({ tenantId: TENANT_A, purpose: "help" });
        expect(calls.sent[0]?.text).toContain("desfazer");
        expect(calls.sent[0]?.text).toContain("responda à minha confirmação");
        expect(calls.sent[0]?.text).toContain("suporte@exemplo.com.br");
        expect(calls.handlers).toEqual([]);
      },
    );

    it.each(["desfazer", "Desfazer!", "  DESFAZER "])(
      "%j responde o provisório até existirem lançamentos",
      async (text) => {
        const { route, calls } = setup({ memberships: [membership()] });
        await route(inbound({ text }));
        expect(calls.sent).toEqual([
          {
            to: "+5511987654321",
            text: NOTHING_TO_UNDO_TEXT,
            tenantId: TENANT_A,
            purpose: "notice",
          },
        ]);
        expect(calls.handlers).toEqual([]);
      },
    );

    it("frase que só começa com 'desfazer' vai para a extração", async () => {
      const { route, calls } = setup({ memberships: [membership()] });
      await route(inbound({ text: "desfazer o almoço de ontem" }));
      expect(calls.handlers).toEqual(["extract"]);
      expect(calls.sent).toEqual([]);
    });
  });

  describe("tipo de mensagem não suportado", () => {
    it.each([
      { type: "unsupported" as const, text: null },
      { type: "text" as const, text: "   " },
    ])("pede texto, áudio ou foto ($type)", async (overrides) => {
      const { route, calls } = setup({ memberships: [membership()] });
      await route(inbound(overrides));
      expect(calls.sent[0]?.text).toBe(UNSUPPORTED_TYPE_TEXT);
      expect(calls.handlers).toEqual([]);
    });
  });

  describe("resposta a uma mensagem nossa", () => {
    const confirmacao: ReplyTarget = {
      outboundMessageId: "out-atual",
      inboundMessageId: "in-0",
      purpose: "confirmation",
    };
    const antiga: ReplyTarget = { ...confirmacao, outboundMessageId: "out-antiga" };

    it("reply à confirmação certa chama a correção daquele lançamento", async () => {
      const { route, calls } = setup({
        memberships: [membership()],
        replyTargets: { "dev.out.atual": confirmacao },
      });
      await route(inbound({ text: "era 50", replyToWaMessageId: "dev.out.atual" }));
      expect(calls.handlers).toEqual(["correction:out-atual"]);
    });

    it("reply a uma confirmação antiga chama a correção dela, não da última", async () => {
      const { route, calls } = setup({
        memberships: [membership()],
        replyTargets: { "dev.out.atual": confirmacao, "dev.out.antiga": antiga },
      });
      await route(inbound({ text: "era 50", replyToWaMessageId: "dev.out.antiga" }));
      expect(calls.handlers).toEqual(["correction:out-antiga"]);
    });

    it("reply a uma mensagem que não é nossa segue o fluxo normal", async () => {
      const { route, calls } = setup({ memberships: [membership()] });
      await route(inbound({ text: "era 50", replyToWaMessageId: "wamid.OUTRA" }));
      expect(calls.replyLookups).toEqual(["wamid.OUTRA"]);
      expect(calls.handlers).toEqual(["extract"]);
    });

    it("reply a uma mensagem de ajuda não vira correção", async () => {
      const { route, calls } = setup({
        memberships: [membership()],
        replyTargets: { "dev.out.ajuda": { ...confirmacao, purpose: "help" } },
      });
      await route(inbound({ text: "era 50", replyToWaMessageId: "dev.out.ajuda" }));
      expect(calls.handlers).toEqual(["extract"]);
    });

    it("comando em reply continua sendo comando", async () => {
      const { route, calls } = setup({
        memberships: [membership()],
        replyTargets: { "dev.out.atual": confirmacao },
      });
      await route(inbound({ text: "ajuda", replyToWaMessageId: "dev.out.atual" }));
      expect(calls.sent[0]).toMatchObject({ purpose: "help" });
      expect(calls.handlers).toEqual([]);
    });

    it("sem reply, nem consulta a mensagem citada", async () => {
      const { route, calls } = setup({ memberships: [membership()] });
      await route(inbound());
      expect(calls.replyLookups).toEqual([]);
    });
  });

  describe("pergunta pendente e extração", () => {
    it("com pergunta em aberto, a mensagem é a resposta dela", async () => {
      const { route, calls } = setup({ memberships: [membership()], pending: true });
      await route(inbound({ text: "foi no pix" }));
      expect(calls.handlers).toEqual(["pending_answer"]);
    });

    it("mensagem comum vai para a extração", async () => {
      const { route, calls } = setup({ memberships: [membership()] });
      await route(inbound());
      expect(calls.handlers).toEqual(["extract"]);
    });

    it("áudio e foto vão para a extração", async () => {
      for (const type of ["audio", "image"] as const) {
        const { route, calls } = setup({ memberships: [membership()] });
        await route(inbound({ type, text: null }));
        expect(calls.handlers).toEqual(["extract"]);
      }
    });

    it("com os handlers padrão da E5, extração, correção e pergunta pendente não respondem nada", async () => {
      const sent: string[] = [];
      const logger = createLogger("silent");
      const route = createRouteInbound({
        directory: { findMemberships: async () => [membership()] },
        senderRepo: { assignSender: async () => true },
        conversation: {
          recordOptIn: async () => true,
          findReplyTarget: async () => ({
            outboundMessageId: "out-1",
            inboundMessageId: "in-0",
            purpose: "confirmation",
          }),
          hasPendingQuestion: async () => false,
        },
        sender: {
          sendText: async ({ text }) => {
            sent.push(text);
            return ok({ waMessageId: "x" });
          },
          markAsRead: async () => ok(true as const),
          showTyping: async () => ok(true as const),
        },
        clock: { now: () => NOW },
        handlers: defaultHandlers(logger),
        supportContact: undefined,
        logger,
      });
      await route(inbound());
      await route(inbound({ replyToWaMessageId: "dev.out.1" }));
      expect(sent).toEqual([]);
    });
  });

  describe("falhas e privacidade", () => {
    it("falha ao enviar a resposta sobe para o worker retentar", async () => {
      const { route } = setup({ memberships: [membership()], sendFails: true });
      await expect(route(inbound({ text: "ajuda" }))).rejects.toBeInstanceOf(SendFailedError);
    });

    it("o log do roteamento não contém o texto da mensagem nem o telefone", async () => {
      const { route, lines } = setup({ memberships: [membership()] });
      await route(inbound());
      const log = lines.join("");
      expect(log).toContain("mensagem roteada");
      expect(log).not.toContain("Zé do peixe");
      expect(log).not.toContain("551187654321");
      expect(log).not.toContain("5511987654321");
    });
  });
});
