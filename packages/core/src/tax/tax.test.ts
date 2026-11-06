import { describe, expect, it } from "vitest";
import {
  estimateTax,
  TAX_DISCLAIMER,
  type TaxRule,
  type TaxSettingsPeriod,
  validateTaxSettings,
} from "./tax";

/**
 * Regras de EXEMPLO só para os testes. Os valores e fórmulas reais dependem de P16 e P17
 * `[PROVISÓRIO]` (Matheus): a estrutura é a que importa aqui.
 */
const MEI_RULE: TaxRule = {
  regime: "mei",
  validFrom: "2020-01-01",
  validTo: null,
  components: [{ label: "DAS-MEI", formula: { kind: "fixed_monthly", amountCents: 7_190 } }],
};

const SIMPLES_RULE: TaxRule = {
  regime: "simples_nacional",
  validFrom: "2020-01-01",
  validTo: null,
  components: [
    {
      label: "DAS",
      formula: {
        kind: "simples_brackets",
        brackets: [
          { upToCents: 18_000_000, nominalBp: 400, deductionCents: 0 },
          { upToCents: 36_000_000, nominalBp: 730, deductionCents: 594_000 },
        ],
      },
    },
  ],
};

const PRESUMIDO_RULE: TaxRule = {
  regime: "lucro_presumido",
  validFrom: "2020-01-01",
  validTo: null,
  components: [
    { label: "PIS", formula: { kind: "percent_of_revenue", rateBp: 65 } },
    { label: "COFINS", formula: { kind: "percent_of_revenue", rateBp: 300 } },
    { label: "ISS", formula: { kind: "percent_of_revenue", rateBp: 200 } },
    { label: "IRPJ", formula: { kind: "presumed_profit", presumptionBp: 800, rateBp: 1500 } },
    { label: "CSLL", formula: { kind: "presumed_profit", presumptionBp: 1200, rateBp: 900 } },
  ],
};

const REAL_RULE: TaxRule = {
  regime: "lucro_real",
  validFrom: "2020-01-01",
  validTo: null,
  components: [
    { label: "PIS/COFINS não cumulativo", formula: { kind: "revenue_minus_credits", rateBp: 925 } },
  ],
};

const RULES = [MEI_RULE, SIMPLES_RULE, PRESUMIDO_RULE, REAL_RULE];

function settings(overrides: Partial<TaxSettingsPeriod> = {}): readonly TaxSettingsPeriod[] {
  return [
    {
      validFrom: "2026-01-01",
      regime: "simples_nacional",
      params: { rbt12Cents: 24_000_000 },
      ...overrides,
    },
  ];
}

const input = (over: Partial<Parameters<typeof estimateTax>[0]> = {}) => ({
  enabled: true,
  month: "2026-11",
  revenueCents: 2_000_000,
  settings: settings(),
  rules: RULES,
  ...over,
});

describe("estimateTax: opção e aviso (RF39.R1, R7, CA01)", () => {
  it("com a opção desligada nada é calculado nem devolvido", () => {
    expect(estimateTax(input({ enabled: false }))).toEqual({ ok: true, value: null });
  });

  it("todo valor devolvido traz o aviso de estimativa", () => {
    const result = estimateTax(input());
    expect(result).toMatchObject({ ok: true, value: { disclaimer: TAX_DISCLAIMER } });
    expect(TAX_DISCLAIMER).toBe("Estimativa gerencial. Não substitui a apuração do contador.");
  });
});

describe("estimateTax: fórmulas por regime, em centavos (RF39.R5, CA02)", () => {
  it("MEI: valor fixo mensal", () => {
    const result = estimateTax(input({ settings: settings({ regime: "mei", params: {} }) }));
    expect(result).toMatchObject({ ok: true, value: { regime: "mei", totalCents: 7_190 } });
  });

  it("Simples: alíquota efetiva pela faixa da receita dos 12 meses anteriores", () => {
    // RBT12 R$ 240.000 cai na 2ª faixa: (240.000 × 7,30% − 5.940) / 240.000 = 4,825%.
    // Receita do mês R$ 20.000 → R$ 965,00.
    const result = estimateTax(input());
    expect(result).toMatchObject({
      ok: true,
      value: { regime: "simples_nacional", totalCents: 96_500 },
    });
  });

  it("Simples: faixa mais baixa sem parcela a deduzir", () => {
    const result = estimateTax(
      input({ settings: settings({ params: { rbt12Cents: 10_000_000 } }) }),
    );
    // 4% de R$ 20.000 = R$ 800,00.
    expect(result).toMatchObject({ ok: true, value: { totalCents: 80_000 } });
  });

  it("Simples: sem a receita dos 12 meses, pede o parâmetro", () => {
    const result = estimateTax(input({ settings: settings({ params: {} }) }));
    expect(result).toEqual({
      ok: false,
      error: { code: "TaxParamMissing", param: "rbt12Cents" },
    });
  });

  it("Simples: receita acima da última faixa não tem regra", () => {
    const result = estimateTax(
      input({ settings: settings({ params: { rbt12Cents: 99_000_000 } }) }),
    );
    expect(result).toMatchObject({ ok: false, error: { code: "TaxRuleNotFound" } });
  });

  it("Presumido: soma os componentes, com o detalhamento de cada um", () => {
    const result = estimateTax(
      input({
        revenueCents: 10_000_000,
        settings: settings({ regime: "lucro_presumido", params: {} }),
      }),
    );
    expect(result).toMatchObject({ ok: true, value: { totalCents: 793_000 } });
    if (result.ok && result.value) {
      expect(result.value.components).toEqual([
        { label: "PIS", amountCents: 65_000 },
        { label: "COFINS", amountCents: 300_000 },
        { label: "ISS", amountCents: 200_000 },
        { label: "IRPJ", amountCents: 120_000 },
        { label: "CSLL", amountCents: 108_000 },
      ]);
    }
  });

  it("Real: desconta os créditos informados e nunca fica negativo", () => {
    const real = (creditsCents: number) =>
      estimateTax(
        input({
          revenueCents: 10_000_000,
          settings: settings({ regime: "lucro_real", params: { creditsCents } }),
        }),
      );
    // 9,25% de R$ 100.000 = R$ 9.250; com R$ 3.000 de créditos → R$ 6.250.
    expect(real(300_000)).toMatchObject({ ok: true, value: { totalCents: 625_000 } });
    expect(real(5_000_000)).toMatchObject({ ok: true, value: { totalCents: 0 } });
  });

  it("arredonda meio-para-cima, sem ponto flutuante (RF08.CA02)", () => {
    const rule: TaxRule = {
      regime: "lucro_presumido",
      validFrom: "2020-01-01",
      validTo: null,
      components: [{ label: "X", formula: { kind: "percent_of_revenue", rateBp: 325 } }],
    };
    const result = estimateTax(
      input({
        revenueCents: 1_010,
        rules: [rule],
        settings: settings({ regime: "lucro_presumido", params: {} }),
      }),
    );
    // 32,825 centavos → 33.
    expect(result).toMatchObject({ ok: true, value: { totalCents: 33 } });
  });
});

describe("estimateTax: vigência das regras (RF39.R4, CA03)", () => {
  const OLD: TaxRule = {
    regime: "lucro_presumido",
    validFrom: "2020-01-01",
    validTo: "2026-12-31",
    components: [{ label: "Imposto", formula: { kind: "percent_of_revenue", rateBp: 500 } }],
  };
  const NEW: TaxRule = {
    regime: "lucro_presumido",
    validFrom: "2027-01-01",
    validTo: null,
    components: [{ label: "Imposto", formula: { kind: "percent_of_revenue", rateBp: 700 } }],
  };
  const presumido = settings({ regime: "lucro_presumido", params: {}, validFrom: "2020-01-01" });

  it("dezembro de 2026 usa a regra antiga, janeiro de 2027 a nova", () => {
    const december = estimateTax(
      input({ month: "2026-12", revenueCents: 100_000, rules: [OLD, NEW], settings: presumido }),
    );
    const january = estimateTax(
      input({ month: "2027-01", revenueCents: 100_000, rules: [OLD, NEW], settings: presumido }),
    );
    expect(december).toMatchObject({ ok: true, value: { totalCents: 5_000 } });
    expect(january).toMatchObject({ ok: true, value: { totalCents: 7_000 } });
  });

  it("sem regra vigente no mês, devolve erro tipado", () => {
    const result = estimateTax(
      input({
        month: "2019-06",
        rules: [OLD],
        settings: settings({ regime: "lucro_presumido", params: {}, validFrom: "2018-01-01" }),
      }),
    );
    expect(result).toMatchObject({
      ok: false,
      error: { code: "TaxRuleNotFound", regime: "lucro_presumido", month: "2019-06" },
    });
  });
});

describe("estimateTax: troca de regime com data de início (RF39.R2)", () => {
  const history: readonly TaxSettingsPeriod[] = [
    { validFrom: "2026-01-01", regime: "mei", params: {} },
    { validFrom: "2027-01-01", regime: "simples_nacional", params: { rbt12Cents: 10_000_000 } },
  ];

  it("meses anteriores continuam com o regime que valia", () => {
    const december = estimateTax(input({ month: "2026-12", settings: history }));
    const january = estimateTax(input({ month: "2027-01", settings: history }));
    expect(december).toMatchObject({ ok: true, value: { regime: "mei" } });
    expect(january).toMatchObject({ ok: true, value: { regime: "simples_nacional" } });
  });

  it("antes do primeiro regime informado, não há estimativa", () => {
    const result = estimateTax(input({ month: "2025-12", settings: history }));
    expect(result).toEqual({ ok: true, value: null });
  });
});

describe("validateTaxSettings (RF39.R1, R2)", () => {
  it("ativar exige regime definido; 'não sei' não permite ativar", () => {
    expect(validateTaxSettings({ enabled: true, regime: null })).toEqual({
      ok: false,
      error: { code: "TaxSettingsInvalid", reason: "regime_required" },
    });
    expect(validateTaxSettings({ enabled: true, regime: "not_sure" })).toEqual({
      ok: false,
      error: { code: "TaxSettingsInvalid", reason: "regime_required" },
    });
  });

  it("desligada, aceita qualquer regime (inclusive 'não sei')", () => {
    expect(validateTaxSettings({ enabled: false, regime: "not_sure" }).ok).toBe(true);
    expect(validateTaxSettings({ enabled: true, regime: "mei" }).ok).toBe(true);
  });
});
