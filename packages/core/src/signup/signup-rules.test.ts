import { describe, expect, it } from "vitest";
import { timezoneForUf } from "./signup-defaults";
import { validateSignupInput } from "./signup-rules";

const base = () => ({
  owner: { name: "Maria D'Ávila-Silva", email: "maria@exemplo.com", phone: "(82) 99658-5647" },
  company: { tradeName: "  Bar do Zé ", segment: "bar" },
  unit: { name: "Centro", city: "Maceió", uf: "AL" },
  terms: { accepted: true },
});
const run = (
  patch: (r: ReturnType<typeof base>) => unknown,
  mode: "new_user" | "existing_user" = "new_user",
) => validateSignupInput(patch(base()), mode);
const errs = (res: ReturnType<typeof validateSignupInput>): Record<string, string> =>
  res.ok ? {} : (res.error as Record<string, string>);

describe("validateSignupInput", () => {
  it("accepts a minimal valid input", () => {
    const res = validateSignupInput(base(), "new_user");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.company.tradeName).toBe("Bar do Zé");
      expect(res.value.company.cnpj).toBeNull();
      expect(res.value.owner.password).toBeNull();
      expect(res.value.unit.timezone).toBe("America/Maceio");
    }
  });
  it("rejects cnpj 11.222.333/0001-00", () => {
    const res = run((r) => ({ ...r, company: { ...r.company, cnpj: "11.222.333/0001-00" } }));
    expect(errs(res)["company.cnpj"]).toBe("cnpj_invalid");
  });
  it("rejects 00.000.000/0000-00", () => {
    const res = run((r) => ({ ...r, company: { ...r.company, cnpj: "00.000.000/0000-00" } }));
    expect(errs(res)["company.cnpj"]).toBe("cnpj_invalid");
  });
  it("empty cnpj becomes null", () => {
    const res = run((r) => ({ ...r, company: { ...r.company, cnpj: "  " } }));
    expect(res.ok && res.value.company.cnpj).toBeNull();
  });
  it("accepts alphanumeric cnpj in lowercase and stores it uppercase without punctuation", () => {
    const res = run((r) => ({ ...r, company: { ...r.company, cnpj: "12.abc.345/01de-35" } }));
    expect(res.ok && res.value.company.cnpj).toBe("12ABC34501DE35");
  });
  it("accepts formatted cnpj and stores digits only", () => {
    const res = run((r) => ({ ...r, company: { ...r.company, cnpj: "11.222.333/0001-81" } }));
    expect(res.ok && res.value.company.cnpj).toBe("11222333000181");
  });
  it("normalizes 82 9658-5647 to +5582996585647", () => {
    const res = run((r) => ({ ...r, owner: { ...r.owner, phone: "82 9658-5647" } }));
    expect(res.ok && res.value.owner.phoneE164).toBe("+5582996585647");
  });
  it("rejects invalid phone", () => {
    const res = run((r) => ({ ...r, owner: { ...r.owner, phone: "123" } }));
    expect(errs(res)["owner.phone"]).toBe("phone_invalid");
  });
  it("rejects password 12345678", () => {
    const res = run((r) => ({ ...r, owner: { ...r.owner, password: "12345678" } }));
    expect(errs(res)["owner.password"]).toBe("password_weak");
  });
  it("rejects password equal to email", () => {
    const res = run((r) => ({
      ...r,
      owner: { ...r.owner, email: "maria1@exemplo.com", password: "maria1@exemplo.com" },
    }));
    expect(errs(res)["owner.password"]).toBe("password_weak");
  });
  it("accepts missing password", () => {
    expect(run((r) => r).ok).toBe(true);
    const res = run((r) => ({ ...r, owner: { ...r.owner, password: "" } }));
    expect(res.ok && res.value.owner.password).toBeNull();
  });
  it("accepts a good password", () => {
    const res = run((r) => ({ ...r, owner: { ...r.owner, password: "senha1234" } }));
    expect(res.ok && res.value.owner.password).toBe("senha1234");
  });
  it("requires accepted terms", () => {
    expect(errs(run((r) => ({ ...r, terms: { accepted: false } }))).terms).toBe("terms_required");
    expect(errs(run((r) => ({ ...r, terms: undefined }))).terms).toBe("terms_required");
  });
  it("trims trade name and enforces 2..100", () => {
    const bad = (v: string) =>
      errs(run((r) => ({ ...r, company: { ...r.company, tradeName: v } })))["company.tradeName"];
    expect(bad(" a ")).toBe("trade_name_invalid");
    expect(bad("x".repeat(101))).toBe("trade_name_invalid");
  });
  it("owner name allows apostrophe and hyphen, rejects digits", () => {
    expect(run((r) => r).ok).toBe(true);
    const res = run((r) => ({ ...r, owner: { ...r.owner, name: "Maria 2" } }));
    expect(errs(res)["owner.name"]).toBe("owner_name_invalid");
  });
  it("rejects unknown enums; accepts not_sure", () => {
    const c = (patch: object) => run((r) => ({ ...r, company: { ...r.company, ...patch } }));
    expect(errs(c({ segment: "x" }))["company.segment"]).toBe("segment_invalid");
    expect(errs(c({ taxRegime: "x" }))["company.taxRegime"]).toBe("tax_regime_invalid");
    expect(errs(c({ revenueRange: "x" }))["company.revenueRange"]).toBe("revenue_range_invalid");
    const res = c({ taxRegime: "not_sure" });
    expect(res.ok && res.value.company.taxRegime).toBe("not_sure");
  });
  it("validates unit name, city and uf", () => {
    const res = run((r) => ({ ...r, unit: { name: "A", city: "", uf: "ZZ" } }));
    expect(errs(res)).toMatchObject({
      "unit.name": "unit_name_invalid",
      "unit.city": "city_required",
      "unit.uf": "uf_invalid",
    });
  });
  it("com a lista oficial, recusa município fora dela e grava a grafia oficial (DD-29)", () => {
    const cities = ["Maceió", "Marechal Deodoro"];
    const withCity = (city: string) =>
      validateSignupInput({ ...base(), unit: { name: "Centro", city, uf: "AL" } }, "new_user", {
        cities,
      });
    expect(errs(withCity("Cidade Inventada"))["unit.city"]).toBe("city_invalid");
    expect(errs(withCity(""))["unit.city"]).toBe("city_required");
    const ok = withCity("  maceio ");
    expect(ok.ok && ok.value.unit.city).toBe("Maceió");
  });
  it("sem a lista oficial, só exige município preenchido", () => {
    const res = run((r) => ({ ...r, unit: { ...r.unit, city: "Qualquer" } }));
    expect(res.ok && res.value.unit.city).toBe("Qualquer");
  });
  it("existing_user mode ignores owner name and password", () => {
    const res = run((r) => ({ ...r, owner: { name: "123", password: "1" } }), "existing_user");
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.value.owner).toEqual({ name: null, phoneE164: null, password: null });
  });
  it("existing_user mode validates optional phone", () => {
    const good = run((r) => ({ ...r, owner: { phone: "82 9658-5647" } }), "existing_user");
    expect(good.ok && good.value.owner.phoneE164).toBe("+5582996585647");
    const bad = run((r) => ({ ...r, owner: { phone: "1" } }), "existing_user");
    expect(errs(bad)["owner.phone"]).toBe("phone_invalid");
  });
  it("non-object input fails", () => {
    expect(validateSignupInput(null, "new_user").ok).toBe(false);
  });
});

describe("timezoneForUf", () => {
  it("maps known UFs and falls back", () => {
    expect(timezoneForUf("AM")).toBe("America/Manaus");
    expect(timezoneForUf("AC")).toBe("America/Rio_Branco");
    expect(timezoneForUf("SP")).toBe("America/Sao_Paulo");
    expect(timezoneForUf("??")).toBe("America/Sao_Paulo");
  });
});
