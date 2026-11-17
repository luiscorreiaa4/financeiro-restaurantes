import type { EntryOptions } from "@app/core/contracts";
import { describe, expect, it } from "vitest";
import {
  buildCreateBody,
  categoriesFor,
  createLocalErrors,
  initialCreateValues,
  keepForNext,
} from "./create-form-values";
import { CATEGORY, OPTIONS, UNIT } from "./entries-test-helpers";

const REVENUE_CATEGORY = "0193a1b2-0000-7000-8000-0000000000c1";
const CHANNEL = "0193a1b2-0000-7000-8000-0000000000c2";
const OTHER_UNIT = "0193a1b2-0000-7000-8000-0000000000c3";
const KEY = "0193a1b2-0000-4000-8000-0000000000ee";

const options: EntryOptions = {
  ...OPTIONS,
  categories: [
    { id: CATEGORY, name: "Insumos", kind: "expense", parentId: null, requiresQuantity: true },
    {
      id: "0193a1b2-0000-7000-8000-0000000000c4",
      name: "Antiga",
      kind: "expense",
      parentId: null,
      requiresQuantity: false,
      active: false,
    },
    {
      id: REVENUE_CATEGORY,
      name: "Vendas",
      kind: "revenue",
      parentId: null,
      requiresQuantity: false,
    },
  ],
  salesChannels: [{ id: CHANNEL, name: "Salão", active: true }],
  units: [
    {
      id: UNIT,
      name: "Matriz",
      active: true,
      defaultSalesChannelId: CHANNEL,
      timezone: "America/Sao_Paulo",
    },
    {
      id: OTHER_UNIT,
      name: "Filial",
      active: false,
      defaultSalesChannelId: null,
      timezone: "America/Manaus",
    },
  ],
};

describe("valores do formulário de lançamento manual", () => {
  it("categorias só ativas e compatíveis com o tipo", () => {
    expect(categoriesFor(options, "expense").map((c) => c.name)).toEqual(["Insumos"]);
    expect(categoriesFor(options, "revenue").map((c) => c.name)).toEqual(["Vendas"]);
  });

  it("começa com tipo despesa, data de hoje, pagamento igual à competência e a unidade do seletor", () => {
    const values = initialCreateValues(options, { unitId: UNIT, today: "2026-11-16" });
    expect(values).toMatchObject({
      type: "expense",
      occurredOn: "2026-11-16",
      paidOn: "2026-11-16",
      unitId: UNIT,
      amountCents: null,
      description: "",
      supplier: { kind: "none" },
    });
  });

  it("com 'todas as unidades' a unidade começa vazia, e com uma só ativa já vem escolhida", () => {
    expect(initialCreateValues(options, { unitId: "all", today: "2026-11-16" }).unitId).toBe(UNIT);
    const two: EntryOptions = {
      ...options,
      units: [
        { id: UNIT, name: "Matriz", active: true },
        { id: OTHER_UNIT, name: "Filial", active: true },
      ],
    };
    expect(initialCreateValues(two, { unitId: "all", today: "2026-11-16" }).unitId).toBe("");
  });

  it("monta o corpo com centavos inteiros, só o que o tipo permite e a chave da tentativa", () => {
    const values = {
      ...initialCreateValues(options, { unitId: UNIT, today: "2026-11-16" }),
      type: "revenue" as const,
      amountCents: 12345,
      description: " Almoço ",
      categoryId: REVENUE_CATEGORY,
      salesChannelId: CHANNEL,
      orders: "12",
      supplier: { kind: "new" as const, name: "Padaria" },
    };
    expect(buildCreateBody(values, KEY)).toEqual({
      clientRequestId: KEY,
      type: "revenue",
      occurredOn: "2026-11-16",
      paidOn: "2026-11-16",
      description: "Almoço",
      amountCents: 12345,
      categoryId: REVENUE_CATEGORY,
      unitId: UNIT,
      supplier: { name: "Padaria" },
      paymentMethodId: null,
      salesChannelId: CHANNEL,
      orders: 12,
      quantity: null,
      quantityUnit: null,
    });
    const expense = buildCreateBody({ ...values, type: "expense", categoryId: CATEGORY }, KEY);
    expect(expense.salesChannelId).toBeNull();
    expect(expense.orders).toBeNull();
  });

  it("sem valor, o erro é 'Informe o valor.' (RF26.CA01) e os obrigatórios são cobrados", () => {
    const values = initialCreateValues(options, { unitId: "all", today: "2026-11-16" });
    const errors = createLocalErrors({ ...values, unitId: "" }, options);
    expect(errors.amountCents).toBe("Informe o valor.");
    expect(errors.description).toBe("Informe a descrição.");
    expect(errors.categoryId).toBe("Escolha a categoria.");
    expect(errors.unitId).toBe("Escolha a unidade.");
  });

  it("categoria que exige quantidade cobra quantidade e unidade de medida; receita cobra o canal", () => {
    const base = initialCreateValues(options, { unitId: UNIT, today: "2026-11-16" });
    const withCategory = { ...base, amountCents: 100, description: "x", categoryId: CATEGORY };
    expect(createLocalErrors(withCategory, options).quantity).toBe(
      "Informe a quantidade e a unidade de medida.",
    );
    const revenue = { ...withCategory, type: "revenue" as const, categoryId: REVENUE_CATEGORY };
    expect(createLocalErrors(revenue, options).salesChannelId).toBe("Escolha o canal de venda.");
  });

  it("'Salvar e lançar outro' mantém tipo, competência e unidade, e o pagamento volta a acompanhar a competência", () => {
    const filled = {
      ...initialCreateValues(options, { unitId: UNIT, today: "2026-11-16" }),
      type: "revenue" as const,
      occurredOn: "2026-11-10",
      paidOn: "2026-11-20",
      amountCents: 500,
      description: "Venda",
      categoryId: REVENUE_CATEGORY,
      salesChannelId: CHANNEL,
      orders: "3",
    };
    expect(keepForNext(filled, options)).toEqual({
      ...initialCreateValues(options, { unitId: UNIT, today: "2026-11-10" }),
      type: "revenue",
      occurredOn: "2026-11-10",
      paidOn: "2026-11-10",
      salesChannelId: CHANNEL,
    });
  });
});
