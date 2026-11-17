import { describe, expect, it } from "vitest";
import { isPossibleDuplicate, type RecentEntry } from "./duplicate";

const recent = (over: Partial<RecentEntry> = {}): RecentEntry => ({
  inboundMessageId: null,
  amountCents: 5000,
  supplierId: "sup-1",
  description: "Tomate",
  occurredOn: "2026-11-16",
  ...over,
});

const candidate = {
  inboundMessageId: null as string | null,
  amountCents: 5000,
  supplierId: "sup-1" as string | null,
  description: "Tomate",
  occurredOn: "2026-11-16",
};

describe("isPossibleDuplicate", () => {
  it("dois lançamentos do painel sem mensagem se reconhecem", () => {
    expect(isPossibleDuplicate(candidate, [recent()])).toBe(true);
  });

  it("mesma mensagem não conta", () => {
    expect(
      isPossibleDuplicate({ ...candidate, inboundMessageId: "m1" }, [
        recent({ inboundMessageId: "m1" }),
      ]),
    ).toBe(false);
  });

  it("mensagem diferente conta", () => {
    expect(
      isPossibleDuplicate({ ...candidate, inboundMessageId: "m1" }, [
        recent({ inboundMessageId: "m2" }),
      ]),
    ).toBe(true);
  });

  it("valor igual com fornecedor nulo não conta", () => {
    expect(
      isPossibleDuplicate({ ...candidate, supplierId: null, description: "Outra" }, [
        recent({ supplierId: null, description: "Diferente" }),
      ]),
    ).toBe(false);
  });

  it("descrição igual com data diferente não conta", () => {
    expect(
      isPossibleDuplicate({ ...candidate, amountCents: 1, supplierId: null }, [
        recent({ amountCents: 2, supplierId: null, occurredOn: "2026-11-15" }),
      ]),
    ).toBe(false);
  });
});
