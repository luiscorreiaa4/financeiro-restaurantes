import { describe, expect, it } from "vitest";
import {
  feePreviewSchema,
  feeReapplicationInputSchema,
  feeReapplicationPreviewInputSchema,
  feeReapplicationPreviewSchema,
  feeReapplicationSchema,
  paymentMethodInputSchema,
  paymentMethodPatchSchema,
  paymentMethodSettingsSchema,
  restrictedUnitsSchema,
  salesChannelInputSchema,
  salesChannelPatchSchema,
  salesChannelSettingsSchema,
  unitInputSchema,
  unitPatchSchema,
  unitSettingsSchema,
} from "./settings";

const ID = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const pmInput = {
  name: "Crédito Visa",
  type: "credit",
  feePercentBp: 350,
  feeFixedCents: 0,
  aliases: ["visa"],
  status: "active",
  isDefaultCard: false,
};
const pmSettings = { ...pmInput, id: ID, protected: false };
const scInput = { name: "iFood", type: "app", feePercentBp: 1200, aliases: [], status: "active" };
const unit = {
  name: "Centro",
  aliases: ["loja 1"],
  cnpj: null,
  uf: "SP",
  city: "São Paulo",
  timezone: "America/Sao_Paulo",
  status: "active",
  defaultSalesChannelId: null,
};
const range = { targetKind: "payment_method", targetId: ID, from: "2026-11-01", to: "2026-11-30" };

describe("contrato de configurações", () => {
  it("aceita forma de pagamento válida e recusa campo extra", () => {
    expect(paymentMethodInputSchema.safeParse(pmInput).success).toBe(true);
    expect(paymentMethodSettingsSchema.safeParse(pmSettings).success).toBe(true);
    expect(paymentMethodInputSchema.safeParse({ ...pmInput, extra: 1 }).success).toBe(false);
    expect(paymentMethodSettingsSchema.safeParse({ ...pmSettings, extra: 1 }).success).toBe(false);
  });

  it("recusa taxa acima de 10000 bp, fracionária e taxa fixa negativa", () => {
    expect(paymentMethodInputSchema.safeParse({ ...pmInput, feePercentBp: 10000 }).success).toBe(
      true,
    );
    expect(paymentMethodInputSchema.safeParse({ ...pmInput, feePercentBp: 10001 }).success).toBe(
      false,
    );
    expect(paymentMethodInputSchema.safeParse({ ...pmInput, feePercentBp: 1.5 }).success).toBe(
      false,
    );
    expect(paymentMethodInputSchema.safeParse({ ...pmInput, feeFixedCents: -1 }).success).toBe(
      false,
    );
    expect(paymentMethodPatchSchema.safeParse({ feePercentBp: 10001 }).success).toBe(false);
    expect(paymentMethodPatchSchema.safeParse({ feePercentBp: 10 }).success).toBe(true);
  });

  it("limita nome e apelidos", () => {
    expect(paymentMethodInputSchema.safeParse({ ...pmInput, name: "a" }).success).toBe(false);
    expect(paymentMethodInputSchema.safeParse({ ...pmInput, name: "a".repeat(41) }).success).toBe(
      false,
    );
    const eleven = Array.from({ length: 11 }, (_, i) => `a${i}`);
    expect(paymentMethodInputSchema.safeParse({ ...pmInput, aliases: eleven }).success).toBe(false);
  });

  it("canal de venda não tem taxa fixa nem cartão padrão", () => {
    expect(salesChannelInputSchema.safeParse(scInput).success).toBe(true);
    expect(salesChannelInputSchema.safeParse({ ...scInput, feeFixedCents: 0 }).success).toBe(false);
    expect(salesChannelInputSchema.safeParse({ ...scInput, isDefaultCard: true }).success).toBe(
      false,
    );
    expect(
      salesChannelSettingsSchema.safeParse({ ...scInput, id: ID, protected: true }).success,
    ).toBe(true);
    expect(salesChannelPatchSchema.safeParse({ feePercentBp: 10001 }).success).toBe(false);
  });

  it("unidade: limites e campo extra", () => {
    expect(unitInputSchema.safeParse(unit).success).toBe(true);
    expect(unitInputSchema.safeParse({ ...unit, extra: 1 }).success).toBe(false);
    expect(unitInputSchema.safeParse({ ...unit, name: "a" }).success).toBe(false);
    expect(
      unitInputSchema.safeParse({ ...unit, aliases: ["a", "b", "c", "d", "e", "f"] }).success,
    ).toBe(false);
    expect(unitInputSchema.safeParse({ ...unit, aliases: ["a".repeat(31)] }).success).toBe(false);
    expect(unitPatchSchema.safeParse({ name: "Novo" }).success).toBe(true);
    expect(unitSettingsSchema.safeParse({ ...unit, id: ID, onlyUnitMemberCount: 0 }).success).toBe(
      true,
    );
  });

  it("unidade antiga sem cidade e UF: a saída aceita nulo, a entrada e o patch não", () => {
    const legacy = { ...unit, id: ID, onlyUnitMemberCount: 0, city: null, uf: null };
    expect(unitSettingsSchema.safeParse(legacy).success).toBe(true);
    expect(unitInputSchema.safeParse({ ...unit, city: null }).success).toBe(false);
    expect(unitInputSchema.safeParse({ ...unit, uf: null }).success).toBe(false);
    expect(unitPatchSchema.safeParse({ city: null }).success).toBe(false);
    expect(unitPatchSchema.safeParse({ uf: null }).success).toBe(false);
  });

  it("prévia de taxa", () => {
    expect(
      feePreviewSchema.safeParse({ grossCents: 10000, feeCents: 350, netCents: 9650 }).success,
    ).toBe(true);
    expect(
      feePreviewSchema.safeParse({ grossCents: 9999, feeCents: 350, netCents: 9650 }).success,
    ).toBe(false);
  });

  it("prévia de reaplicação aceita delta negativo e recusa from > to", () => {
    expect(feeReapplicationPreviewInputSchema.safeParse(range).success).toBe(true);
    expect(
      feeReapplicationPreviewInputSchema.safeParse({ ...range, from: "2026-12-01" }).success,
    ).toBe(false);
    expect(feeReapplicationPreviewInputSchema.safeParse({ ...range, extra: 1 }).success).toBe(
      false,
    );
    expect(
      feeReapplicationPreviewSchema.safeParse({
        matched: 3,
        deltaNetCents: -1500,
        feePercentBp: 350,
        feeFixedCents: 0,
      }).success,
    ).toBe(true);
  });

  it("confirmação de reaplicação exige clientRequestId e período válido", () => {
    expect(feeReapplicationInputSchema.safeParse({ ...range, clientRequestId: ID }).success).toBe(
      true,
    );
    expect(feeReapplicationInputSchema.safeParse(range).success).toBe(false);
    expect(
      feeReapplicationInputSchema.safeParse({ ...range, from: "2026-12-01", clientRequestId: ID })
        .success,
    ).toBe(false);
  });

  it("reaplicação registrada", () => {
    const run = {
      id: ID,
      targetKind: "sales_channel",
      targetId: ID,
      from: "2026-11-01",
      to: "2026-11-30",
      status: "failed",
      errorCode: "generation_failed",
      matched: 3,
      updated: 1,
      skipped: 2,
      createdAt: "2026-11-23T10:00:00-03:00",
      finishedAt: null,
    };
    expect(feeReapplicationSchema.safeParse(run).success).toBe(true);
    expect(feeReapplicationSchema.safeParse({ ...run, status: "other" }).success).toBe(false);
    expect(feeReapplicationSchema.safeParse({ ...run, errorCode: null }).success).toBe(true);
  });

  it("unidades restritas", () => {
    expect(
      restrictedUnitsSchema.safeParse({ units: [{ id: ID, name: "Centro", tenantName: "Bar" }] })
        .success,
    ).toBe(true);
    expect(restrictedUnitsSchema.safeParse({ units: [], extra: 1 }).success).toBe(false);
  });
});

describe("apelidos de forma e canal", () => {
  it("recusa apelido com mais de 40 caracteres", () => {
    const body = {
      name: "Crédito",
      type: "credit",
      feePercentBp: 320,
      feeFixedCents: 0,
      aliases: ["x".repeat(41)],
      status: "active",
      isDefaultCard: false,
    };
    expect(paymentMethodInputSchema.safeParse(body).success).toBe(false);
  });
});
