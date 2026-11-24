import { describe, expect, it } from "vitest";
import { isProtectedCatalogName } from "./names";
import { type PaymentMethodInput, validatePaymentMethod } from "./payment-method";

const base: PaymentMethodInput = {
  name: "Crédito",
  type: "credit",
  feePercentBp: 320,
  feeFixedCents: 0,
  aliases: [],
  status: "active",
  isDefaultCard: false,
};
const code = (r: ReturnType<typeof validatePaymentMethod>) => (r.ok ? "ok" : r.error.code);

describe("validatePaymentMethod", () => {
  it("aceita forma válida e apara nome", () => {
    const r = validatePaymentMethod({ ...base, name: " Crédito " }, { existing: [] });
    expect(r.ok && r.value.name).toBe("Crédito");
  });
  it("recusa 120 % (RF08.CA05)", () => {
    expect(code(validatePaymentMethod({ ...base, feePercentBp: 12000 }, { existing: [] }))).toBe(
      "InvalidFeeRate",
    );
  });
  it("recusa taxa fixa negativa ou fracionada", () => {
    expect(code(validatePaymentMethod({ ...base, feeFixedCents: -1 }, { existing: [] }))).toBe(
      "InvalidAmount",
    );
    expect(code(validatePaymentMethod({ ...base, feeFixedCents: 1.5 }, { existing: [] }))).toBe(
      "InvalidAmount",
    );
  });
  it("centro/Centro colidem", () => {
    const existing = [{ id: "1", name: "crédito", aliases: [] }];
    expect(code(validatePaymentMethod(base, { existing }))).toBe("NameTaken");
  });
  it("apelido de outra forma colide com nome", () => {
    const existing = [{ id: "1", name: "Pix", aliases: [] }];
    expect(code(validatePaymentMethod({ ...base, aliases: ["pix"] }, { existing }))).toBe(
      "NameTaken",
    );
  });
  it("recusa 11 apelidos", () => {
    const aliases = Array.from({ length: 11 }, (_, i) => `a${i}x`);
    expect(code(validatePaymentMethod({ ...base, aliases }, { existing: [] }))).toBe(
      "AliasesTooMany",
    );
  });
  it("cartão padrão em PIX é recusado", () => {
    expect(
      code(validatePaymentMethod({ ...base, type: "pix", isDefaultCard: true }, { existing: [] })),
    ).toBe("DefaultCardType");
  });
  it("cartão padrão inativo é recusado", () => {
    expect(
      code(
        validatePaymentMethod(
          { ...base, isDefaultCard: true, status: "inactive" },
          { existing: [] },
        ),
      ),
    ).toBe("DefaultCardInactive");
  });
  it("débito e crédito podem ser cartão padrão", () => {
    expect(
      code(
        validatePaymentMethod({ ...base, type: "debit", isDefaultCard: true }, { existing: [] }),
      ),
    ).toBe("ok");
  });
  it("editar 'Não informada' é recusado", () => {
    expect(
      code(
        validatePaymentMethod(
          { ...base, name: "Não informada" },
          { existing: [], currentName: "Não informada" },
        ),
      ),
    ).toBe("SystemCatalogReadOnly");
  });
  it("criar com o nome protegido colide", () => {
    expect(code(validatePaymentMethod({ ...base, name: "nao informada" }, { existing: [] }))).toBe(
      "SystemCatalogReadOnly",
    );
  });
  it("própria forma não colide consigo", () => {
    const existing = [{ id: "1", name: "Crédito", aliases: [] }];
    expect(code(validatePaymentMethod(base, { existing, currentId: "1" }))).toBe("ok");
  });
});

describe("isProtectedCatalogName", () => {
  it("reconhece os cadastros do sistema por tipo", () => {
    expect(isProtectedCatalogName("payment_method", "Não informada")).toBe(true);
    expect(isProtectedCatalogName("payment_method", "nao informada")).toBe(true);
    expect(isProtectedCatalogName("sales_channel", "Não informado")).toBe(true);
    expect(isProtectedCatalogName("sales_channel", "Não informada")).toBe(false);
    expect(isProtectedCatalogName("payment_method", "Pix")).toBe(false);
  });
});
