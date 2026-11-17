import { afterEach, describe, expect, it, vi } from "vitest";
import { parseFilters, serializeFilters, toSearchParams } from "./url-filters";

const TODAY = "2026-11-13";
const UNIT_A = "0193a1b2-0000-7000-8000-00000000000a";
const UNIT_B = "0193a1b2-0000-7000-8000-00000000000b";
const CATEGORY = "0193a1b2-0000-7000-8000-00000000000c";
const SUPPLIER = "0193a1b2-0000-7000-8000-00000000000d";
const METHOD = "0193a1b2-0000-7000-8000-00000000000e";
const CHANNEL = "0193a1b2-0000-7000-8000-00000000000f";
const AUTHOR = "0193a1b2-0000-7000-8000-000000000010";

function parse(search: string) {
  return parseFilters(new URLSearchParams(search), TODAY);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("filtros da lista de lançamentos na URL (RF22.Obs1)", () => {
  it("sem parâmetros, cai no mês corrente com a ordem padrão", () => {
    expect(parse("")).toEqual({
      from: "2026-11-01",
      to: "2026-11-30",
      sort: "created_at",
      dir: "desc",
      limit: 50,
    });
  });

  it("lê todos os filtros e a ordenação", () => {
    const query = parse(
      `from=2026-10-01&to=2026-10-31&type=expense&unitIds=${UNIT_A}&unitIds=${UNIT_B}` +
        `&categoryIds=${CATEGORY}&supplierId=${SUPPLIER}&paymentMethodId=${METHOD}` +
        `&salesChannelId=${CHANNEL}&createdBy=${AUTHOR}&originChannel=whatsapp` +
        "&flags=possible_duplicate&flags=old_date&q=450%2C00&sort=amount&dir=asc",
    );
    expect(query).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
      type: "expense",
      unitIds: [UNIT_A, UNIT_B],
      categoryIds: [CATEGORY],
      supplierId: SUPPLIER,
      paymentMethodId: METHOD,
      salesChannelId: CHANNEL,
      createdBy: AUTHOR,
      originChannel: "whatsapp",
      flags: ["possible_duplicate", "old_date"],
      q: "450,00",
      sort: "amount",
      dir: "asc",
      limit: 50,
    });
  });

  it("ida e volta é estável para todos os filtros", () => {
    const search =
      // A ordem das chaves é a que o serializador escreve (valor único, depois listas).
      `from=2026-10-01&to=2026-10-31&type=revenue&supplierId=${SUPPLIER}` +
      `&paymentMethodId=${METHOD}&salesChannelId=${CHANNEL}&createdBy=${AUTHOR}` +
      `&originChannel=web&unitIds=${UNIT_A}&unitIds=${UNIT_B}&categoryIds=${CATEGORY}` +
      "&flags=category_to_review&q=mercado+central&sort=paid_on&dir=asc";
    const once = serializeFilters(parse(search));
    expect(once).toBe(search);
    expect(serializeFilters(parse(once))).toBe(once);
  });

  it("omite a ordenação padrão e nunca escreve cursor nem limite", () => {
    const text = serializeFilters({
      from: "2026-11-01",
      to: "2026-11-30",
      sort: "created_at",
      dir: "desc",
      cursor: "abc",
      limit: 50,
    });
    expect(text).toBe("from=2026-11-01&to=2026-11-30");
  });

  it("ignora parâmetro desconhecido", () => {
    expect(parse("from=2026-10-01&to=2026-10-31&utm_source=x&entry=123")).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
      sort: "created_at",
      dir: "desc",
      limit: 50,
    });
  });

  it("ignora só o parâmetro malformado e mantém os válidos", () => {
    const query = parse(
      `from=2026-10-01&to=2026-10-31&type=xyz&unitIds=nao-e-uuid&sort=foo&dir=up&categoryIds=${CATEGORY}`,
    );
    expect(query).toEqual({
      from: "2026-10-01",
      to: "2026-10-31",
      categoryIds: [CATEGORY],
      sort: "created_at",
      dir: "desc",
      limit: 50,
    });
  });

  it("período inválido, invertido, incompleto ou longo demais volta ao mês corrente", () => {
    const month = { from: "2026-11-01", to: "2026-11-30" };
    expect(parse("from=2026-02-30&to=2026-03-10")).toMatchObject(month);
    expect(parse("from=2026-10-31&to=2026-10-01")).toMatchObject(month);
    expect(parse("from=2026-10-01")).toMatchObject(month);
    expect(parse("from=2024-01-01&to=2026-06-01")).toMatchObject(month);
    // O resto da URL continua valendo.
    expect(parse("from=banana&to=2026-10-01&type=revenue")).toMatchObject({
      ...month,
      type: "revenue",
    });
  });

  it("cursor e limite vindos da URL são ignorados", () => {
    const query = parse("from=2026-10-01&to=2026-10-31&cursor=abc&limit=3");
    expect(query.cursor).toBeUndefined();
    expect(query.limit).toBe(50);
  });

  it("busca vazia ou só com espaços não vira filtro", () => {
    expect(parse("from=2026-10-01&to=2026-10-31&q=").q).toBeUndefined();
    expect(parse("from=2026-10-01&to=2026-10-31&q=+++").q).toBeUndefined();
  });

  it("as datas nunca passam por Date (RNF13.R4)", () => {
    const spy = vi.spyOn(globalThis, "Date");
    serializeFilters(parse("from=2026-10-01&to=2026-10-31"));
    parse("");
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("parâmetros da chamada à API", () => {
  it("leva cursor e limite, que a URL da tela não leva", () => {
    const params = toSearchParams({
      from: "2026-10-01",
      to: "2026-10-31",
      unitIds: [UNIT_A, UNIT_B],
      cursor: "abc",
      limit: 20,
    });
    expect(params.toString()).toBe(
      `from=2026-10-01&to=2026-10-31&unitIds=${UNIT_A}&unitIds=${UNIT_B}&cursor=abc&limit=20`,
    );
  });
});
