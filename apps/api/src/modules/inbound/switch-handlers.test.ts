import type {
  ChoiceDraft,
  ChoiceStore,
  ClaimedInboundMessage,
  OutboundPurpose,
  PendingQuestionRecord,
  SenderMembership,
} from "@app/core";
import { describe, expect, it } from "vitest";
import {
  CHOICE_FAILED_TEXT,
  CHOICE_INVALID_TEXT,
  companySwitchedText,
  onlyOneCompanyText,
  onlyOneUnitText,
  unitSwitchedText,
} from "./messages";
import type { RouteContext } from "./route-inbound";
import { createPendingAnswerRouter, createSwitchHandlers } from "./switch-handlers";

const TENANT_A = "0190a1b2-0000-7000-8000-00000000000a";
const TENANT_B = "0190a1b2-0000-7000-8000-00000000000b";
const NOW = new Date("2026-11-09T12:00:00Z");

const unit = (id: string, name: string, status: "active" | "inactive" = "active") => ({
  id,
  name,
  aliases: [],
  status,
});

function membership(overrides: Partial<SenderMembership> = {}): SenderMembership {
  return {
    membershipId: "m-a",
    tenantId: TENANT_A,
    tenantName: "Bistrô Centro",
    userId: "user-1",
    userName: "Dono",
    role: "owner",
    status: "active",
    allUnits: true,
    unitIds: [],
    defaultUnitId: null,
    permissions: [],
    panelAccess: true,
    tenantUnitIds: ["uA", "uB"],
    tenantUnits: [unit("uA", "Matriz"), unit("uB", "Praia")],
    preferredAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    deactivatedAt: null,
    ...overrides,
  };
}

function setup(
  options: { sender?: SenderMembership; active?: SenderMembership[]; applies?: boolean } = {},
) {
  const sender = options.sender ?? membership();
  const sent: { text: string; purpose: OutboundPurpose }[] = [];
  const opened: Parameters<ChoiceStore["open"]>[0][] = [];
  const applied: Parameters<ChoiceStore["apply"]>[0][] = [];
  const closed: { id: string; status: string }[] = [];
  const choices: ChoiceStore = {
    async open(input) {
      opened.push(input);
    },
    async apply(input) {
      applied.push(input);
      return options.applies ?? true;
    },
  };
  const handlers = createSwitchHandlers({
    choices,
    store: {
      async closePendingQuestion(_tenantId, id, status) {
        closed.push({ id, status });
      },
    },
    clock: { now: () => NOW },
    newId: () => "q-new",
  });
  const context: RouteContext = {
    message: { id: "in-1", type: "text", text: "2" } as ClaimedInboundMessage,
    sender,
    defaultUnitId: null,
    tenantCount: (options.active ?? [sender]).length,
    citedUnitId: null,
    activeMemberships: options.active ?? [sender],
    async reply(text, purpose) {
      sent.push({ text, purpose });
      return "out-1";
    },
    async ack() {},
  };
  return { handlers, context, sent, opened, applied, closed };
}

const pendingChoice = (draft: ChoiceDraft | unknown, id = "q-1"): PendingQuestionRecord => ({
  id,
  kind: "choice",
  inboundMessageId: "in-0",
  draft,
  question: "Qual unidade?",
  expiresAt: new Date("2026-11-10T12:00:00Z"),
});

const UNIT_DRAFT: ChoiceDraft = {
  target: "unit",
  options: [
    { n: 1, id: "uA", label: "Matriz" },
    { n: 2, id: "uB", label: "Praia" },
  ],
};

describe("trocar unidade (RF19)", () => {
  it("com uma só unidade de acesso, avisa e não abre pergunta", async () => {
    const { handlers, context, sent, opened } = setup({
      sender: membership({ allUnits: false, unitIds: ["uA"] }),
    });
    await handlers.switchUnit(context);
    expect(sent).toEqual([{ text: onlyOneUnitText("Matriz"), purpose: "notice" }]);
    expect(opened).toEqual([]);
  });

  it("lista só as unidades de acesso e ativas, numeradas", async () => {
    const { handlers, context, sent, opened } = setup({
      sender: membership({
        tenantUnits: [unit("uA", "Matriz"), unit("uB", "Praia"), unit("uC", "Antiga", "inactive")],
        tenantUnitIds: ["uA", "uB", "uC"],
      }),
    });
    await handlers.switchUnit(context);
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({
      tenantId: TENANT_A,
      userId: "user-1",
      inboundMessageId: "in-1",
      id: "q-new",
      draft: UNIT_DRAFT,
      expiresAt: new Date("2026-11-10T12:00:00Z"),
    });
    expect(sent[0]).toMatchObject({ purpose: "question" });
    expect(sent[0]?.text).toContain("1. Matriz");
    expect(sent[0]?.text).toContain("2. Praia");
    expect(sent[0]?.text).not.toContain("Antiga");
  });

  it("vínculo restrito não vê unidade fora do acesso", async () => {
    const { handlers, context, opened } = setup({
      sender: membership({
        allUnits: false,
        unitIds: ["uA", "uB"],
        tenantUnits: [unit("uA", "Matriz"), unit("uB", "Praia"), unit("uC", "Cozinha")],
        tenantUnitIds: ["uA", "uB", "uC"],
      }),
    });
    await handlers.switchUnit(context);
    expect(opened[0]?.draft.options.map((o) => o.id)).toEqual(["uA", "uB"]);
  });
});

describe("trocar empresa (RF19)", () => {
  it("com uma só empresa, avisa e não abre pergunta", async () => {
    const { handlers, context, sent, opened } = setup();
    await handlers.switchTenant(context);
    expect(sent).toEqual([{ text: onlyOneCompanyText("Bistrô Centro"), purpose: "notice" }]);
    expect(opened).toEqual([]);
  });

  it("lista as empresas ativas, uma por restaurante, e abre a pergunta no restaurante atual", async () => {
    const other = membership({
      membershipId: "m-b",
      tenantId: TENANT_B,
      tenantName: "Bistrô Praia",
    });
    const duplicate = membership({ membershipId: "m-a2" });
    const { handlers, context, sent, opened } = setup({ active: [membership(), duplicate, other] });
    await handlers.switchTenant(context);
    expect(opened[0]).toMatchObject({
      tenantId: TENANT_A,
      draft: {
        target: "tenant",
        options: [
          { n: 1, id: TENANT_A, label: "Bistrô Centro" },
          { n: 2, id: TENANT_B, label: "Bistrô Praia" },
        ],
      },
    });
    expect(sent[0]?.text).toContain("2. Bistrô Praia");
  });
});

describe("resposta à lista numerada", () => {
  it("o número escolhe a unidade e confirma, sem IA", async () => {
    const { handlers, context, sent, applied } = setup();
    await handlers.answerChoice(context, pendingChoice(UNIT_DRAFT));
    expect(applied).toEqual([
      {
        tenantId: TENANT_A,
        userId: "user-1",
        questionId: "q-1",
        target: "unit",
        chosenId: "uB",
        now: NOW,
      },
    ]);
    expect(sent).toEqual([{ text: unitSwitchedText("Praia"), purpose: "notice" }]);
  });

  it("o número escolhe a empresa", async () => {
    const draft: ChoiceDraft = {
      target: "tenant",
      options: [
        { n: 1, id: TENANT_A, label: "Bistrô Centro" },
        { n: 2, id: TENANT_B, label: "Bistrô Praia" },
      ],
    };
    const { handlers, context, sent, applied } = setup();
    await handlers.answerChoice(context, pendingChoice(draft));
    expect(applied[0]).toMatchObject({ target: "tenant", chosenId: TENANT_B });
    expect(sent[0]?.text).toBe(companySwitchedText("Bistrô Praia"));
  });

  it.each(["9", "0", "praia", "1 2"])(
    "a resposta %j repete a lista e não grava nada",
    async (answer) => {
      const { handlers, context, sent, applied, closed } = setup();
      await handlers.answerChoice(
        { ...context, message: { ...context.message, text: answer } },
        pendingChoice(UNIT_DRAFT),
      );
      expect(applied).toEqual([]);
      expect(closed).toEqual([]);
      expect(sent[0]?.text).toContain(CHOICE_INVALID_TEXT);
      expect(sent[0]?.text).toContain("1. Matriz");
    },
  );

  it("quando o banco não grava, avisa e deixa a pergunta aberta", async () => {
    const { handlers, context, sent } = setup({ applies: false });
    await handlers.answerChoice(context, pendingChoice(UNIT_DRAFT));
    expect(sent).toEqual([{ text: CHOICE_FAILED_TEXT, purpose: "notice" }]);
  });

  it("rascunho corrompido cancela a pergunta em vez de travar a conversa", async () => {
    const { handlers, context, sent, closed, applied } = setup();
    await handlers.answerChoice(context, pendingChoice({ lixo: true }));
    expect(closed).toEqual([{ id: "q-1", status: "cancelled" }]);
    expect(applied).toEqual([]);
    expect(sent[0]?.text).toBe(CHOICE_FAILED_TEXT);
  });
});

describe("encaminhamento da resposta pendente", () => {
  const route = (pending: PendingQuestionRecord | null) => {
    const calls: string[] = [];
    const router = createPendingAnswerRouter({
      store: {
        async findOpenPendingQuestion() {
          return pending;
        },
      },
      clock: { now: () => NOW },
      answerChoice: async () => {
        calls.push("choice");
      },
      fallback: async () => {
        calls.push("clarify");
      },
    });
    return { router, calls };
  };

  it("pergunta de escolha vai para o tratamento da lista, não para a IA", async () => {
    const { router, calls } = route(pendingChoice(UNIT_DRAFT));
    await router(setup().context);
    expect(calls).toEqual(["choice"]);
  });

  it("pergunta de esclarecimento segue o caminho de sempre", async () => {
    const { router, calls } = route({ ...pendingChoice(UNIT_DRAFT), kind: "clarify" });
    await router(setup().context);
    expect(calls).toEqual(["clarify"]);
  });

  it("sem pergunta aberta (expirou no meio), segue o caminho de sempre", async () => {
    const { router, calls } = route(null);
    await router(setup().context);
    expect(calls).toEqual(["clarify"]);
  });
});
