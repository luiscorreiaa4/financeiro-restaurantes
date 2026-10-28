import { describe, expect, it } from "vitest";
import { decideRoute, type ReplyTarget, type RouteInput } from "./routing";
import type { SenderResolution } from "./sender";

const KNOWN: SenderResolution = {
  kind: "known",
  sender: {
    membershipId: "m1",
    tenantId: "t1",
    tenantName: "Restaurante",
    userId: "u1",
    userName: "Dono",
    role: "owner",
    unitId: null,
    tenantUnitIds: [],
    createdAt: new Date("2026-01-01T00:00:00Z"),
    deactivatedAt: null,
  },
  defaultUnitId: null,
  tenantCount: 1,
};

const confirmation: ReplyTarget = {
  outboundMessageId: "out-1",
  inboundMessageId: "in-1",
  purpose: "confirmation",
};

function route(overrides: Partial<RouteInput> & { text?: string } = {}) {
  const { text, ...rest } = overrides;
  return decideRoute({
    resolution: KNOWN,
    message: { type: "text", text: text ?? "paguei 350 de carne" },
    replyTarget: null,
    hasPendingQuestion: false,
    ...rest,
  });
}

describe("decideRoute", () => {
  it("número desconhecido cai no ramo próprio, mesmo que a mensagem seja um comando", () => {
    expect(route({ resolution: { kind: "unknown" }, text: "ajuda" })).toEqual({
      kind: "unknown_sender",
    });
  });

  it("número desconhecido ganha de resposta a confirmação e de pergunta pendente", () => {
    expect(
      route({
        resolution: { kind: "unknown" },
        replyTarget: confirmation,
        hasPendingQuestion: true,
      }),
    ).toEqual({ kind: "unknown_sender" });
  });

  it.each([
    ["Desfazer", "undo"],
    ["  AJUDA!  ", "help"],
    ["ajúda?", "help"],
  ] as const)("a mensagem %j é o comando %s", (text, command) => {
    expect(route({ text })).toEqual({ kind: "command", command, replyTarget: null });
  });

  it("frase que só começa com a palavra do comando não é comando", () => {
    expect(route({ text: "desfazer o almoço de ontem" })).toEqual({ kind: "extract" });
  });

  it("comando vence resposta a confirmação e pergunta pendente, e carrega a mensagem citada", () => {
    expect(
      route({ text: "desfazer", replyTarget: confirmation, hasPendingQuestion: true }),
    ).toEqual({ kind: "command", command: "undo", replyTarget: confirmation });
  });

  it("resposta a uma confirmação nossa é correção daquele lançamento", () => {
    expect(route({ text: "era 50", replyTarget: confirmation })).toEqual({
      kind: "correction",
      target: confirmation,
    });
  });

  it("resposta a uma confirmação antiga continua sendo correção dela", () => {
    const antiga: ReplyTarget = { ...confirmation, outboundMessageId: "out-antiga" };
    expect(route({ text: "era 50", replyTarget: antiga })).toEqual({
      kind: "correction",
      target: antiga,
    });
  });

  it("resposta a uma mensagem nossa que não é confirmação não corrige nada", () => {
    for (const purpose of ["help", "notice"] as const) {
      expect(route({ replyTarget: { ...confirmation, purpose } })).toEqual({ kind: "extract" });
    }
  });

  it("resposta a uma mensagem desconhecida segue o fluxo normal", () => {
    expect(route({ replyTarget: null })).toEqual({ kind: "extract" });
  });

  it("correção vence a pergunta pendente", () => {
    expect(route({ replyTarget: confirmation, hasPendingQuestion: true })).toMatchObject({
      kind: "correction",
    });
  });

  it("com pergunta pendente, a mensagem é a resposta dela", () => {
    expect(route({ text: "foi no pix", hasPendingQuestion: true })).toEqual({
      kind: "pending_answer",
    });
  });

  it("sem nada de especial, a mensagem vai para a extração", () => {
    expect(route()).toEqual({ kind: "extract" });
  });

  it("tipo não suportado pede texto, áudio ou foto", () => {
    expect(route({ message: { type: "unsupported", text: null } })).toEqual({
      kind: "unsupported",
    });
  });

  it.each(["", "   ", "\n\t"])("texto vazio (%j) é tratado como não suportado", (text) => {
    expect(route({ text })).toEqual({ kind: "unsupported" });
  });

  it("áudio e foto vão para a extração, ou para a pergunta pendente se houver", () => {
    for (const type of ["audio", "image"] as const) {
      expect(route({ message: { type, text: null } })).toEqual({ kind: "extract" });
      expect(route({ message: { type, text: null }, hasPendingQuestion: true })).toEqual({
        kind: "pending_answer",
      });
    }
  });
});
