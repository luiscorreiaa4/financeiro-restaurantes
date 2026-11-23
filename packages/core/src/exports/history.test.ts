import { describe, expect, it } from "vitest";
import type { VersionNames } from "../entry/version-diff";
import { toCsv } from "./csv";
import { type EntryVersionInput, HISTORY_EXPORT_COLUMNS, historyRows } from "./history";

const names: VersionNames = {
  categories: new Map([
    ["cat-1", { name: "Insumos", isSensitive: false }],
    ["cat-2", { name: "Salários", isSensitive: true }],
  ]),
  suppliers: new Map(),
  paymentMethods: new Map(),
  salesChannels: new Map(),
  units: new Map(),
};

function version(overrides: Partial<EntryVersionInput> = {}): EntryVersionInput {
  return {
    entryId: "e-1",
    version: 1,
    action: "create",
    channel: "whatsapp",
    changedBy: { id: "u-1", name: "Maria" },
    changedAt: "2026-10-01T02:30:00Z",
    before: null,
    after: { description: "Arroz", amountCents: 1050, categoryId: "cat-1" },
    ...overrides,
  };
}

describe("historyRows", () => {
  it("uma linha por campo alterado, com o antes e o depois legíveis", () => {
    const rows = historyRows(
      [
        version(),
        version({
          version: 2,
          action: "update",
          channel: "web",
          before: { description: "Arroz", amountCents: 1050, categoryId: "cat-1" },
          after: { description: "Arroz 5kg", amountCents: 1200, categoryId: "cat-1" },
        }),
      ],
      names,
    );
    expect(rows.filter((r) => r.version === 2)).toEqual([
      {
        entryId: "e-1",
        version: 2,
        changedAt: "2026-10-01T02:30:00Z",
        author: "Maria",
        channel: "Painel",
        field: "Descrição",
        before: "Arroz",
        after: "Arroz 5kg",
      },
      {
        entryId: "e-1",
        version: 2,
        changedAt: "2026-10-01T02:30:00Z",
        author: "Maria",
        channel: "Painel",
        field: "Valor bruto",
        before: "10,50",
        after: "12,00",
      },
    ]);
  });

  it("na criação o antes é vazio e os nomes do cadastro substituem os ids", () => {
    const rows = historyRows([version()], names);
    const category = rows.find((r) => r.field === "Categoria");
    expect(category).toMatchObject({ before: "", after: "Insumos" });
  });

  it("categoria que não está no cadastro sai como (removido), sem o id", () => {
    const rows = historyRows([version({ after: { categoryId: "cat-x" } })], names, {
      includeSensitive: true,
    });
    expect(rows.find((r) => r.field === "Categoria")?.after).toBe("(removido)");
    expect(JSON.stringify(rows)).not.toContain("cat-x");
  });

  it("snapshot ilegível vira uma linha (ilegível), sem nenhum valor", () => {
    const rows = historyRows(
      [version({ after: "texto solto com Salário R$ 5000", before: null })],
      names,
    );
    expect(rows).toEqual([
      {
        entryId: "e-1",
        version: 1,
        changedAt: "2026-10-01T02:30:00Z",
        author: "Maria",
        channel: "WhatsApp",
        field: "(ilegível)",
        before: "",
        after: "",
      },
    ]);
    expect(JSON.stringify(rows)).not.toContain("5000");
  });

  it("before ilegível também não vaza o conteúdo do after", () => {
    const rows = historyRows(
      [version({ version: 2, before: 42, after: { description: "Folha", categoryId: "cat-2" } })],
      names,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ field: "(ilegível)", before: "", after: "" });
    expect(JSON.stringify(rows)).not.toContain("Folha");
  });

  it("after nulo ou objeto vazio também é ilegível", () => {
    expect(historyRows([version({ after: null })], names)[0]?.field).toBe("(ilegível)");
    expect(historyRows([version({ after: {} })], names)[0]?.field).toBe("(ilegível)");
  });

  it("formata datas, taxa em pontos-base, tipo e sinais", () => {
    const rows = historyRows(
      [
        version({
          after: {
            type: "expense",
            occurredOn: "2026-10-05",
            feePercentBp: 250,
            flags: ["old_date"],
            quantity: 12.5,
          },
        }),
      ],
      names,
      { includeSensitive: true },
    );
    const by = Object.fromEntries(rows.map((r) => [r.field, r.after]));
    expect(by.Tipo).toBe("Despesa");
    expect(by.Data).toBe("05/10/2026");
    expect(by["Taxa (%)"]).toBe("2,50");
    expect(by["Sinais de revisão"]).toBe("Data antiga");
    expect(by.Quantidade).toBe("12,5");
  });

  it("versão sem mudança não gera linha", () => {
    const snap = { description: "Arroz", categoryId: "cat-1" };
    expect(historyRows([version({ version: 2, before: snap, after: snap })], names)).toEqual([]);
  });
});

describe("HISTORY_EXPORT_COLUMNS", () => {
  it("rótulos em português e CSV neutralizado", () => {
    expect(HISTORY_EXPORT_COLUMNS.map((c) => c.label)).toEqual([
      "Lançamento",
      "Versão",
      "Data e hora",
      "Autor",
      "Canal",
      "Campo",
      "Antes",
      "Depois",
    ]);
    const rows = historyRows(
      [version({ after: { description: "=1+1", categoryId: "cat-1" } })],
      names,
    );
    const csv = toCsv(HISTORY_EXPORT_COLUMNS, rows);
    expect(csv).toContain(";Descrição;;'=1+1\r\n");
    expect(csv).toContain(";30/09/2026 23:30;Maria;WhatsApp;");
  });
});

describe("historyRows: categoria sensível (falha fechado)", () => {
  const payroll = version({
    after: { description: "Folha de pagamento", amountCents: 500000, categoryId: "cat-2" },
  });

  it("sem includeSensitive, versão em categoria sensível vira uma linha (restrito) sem valores", () => {
    const rows = historyRows([payroll], names);
    expect(rows).toEqual([
      {
        entryId: "e-1",
        version: 1,
        changedAt: "2026-10-01T02:30:00Z",
        author: "Maria",
        channel: "WhatsApp",
        field: "(restrito)",
        before: "",
        after: "",
      },
    ]);
    const text = JSON.stringify(rows);
    for (const leaked of ["Salários", "Salário", "5000", "Folha", "Descrição", "Valor bruto"]) {
      expect(text).not.toContain(leaked);
    }
  });

  it("o antes em categoria sensível também restringe a versão", () => {
    const rows = historyRows(
      [
        version({
          version: 2,
          before: { description: "Folha", categoryId: "cat-2" },
          after: { description: "Folha", categoryId: "cat-1" },
        }),
      ],
      names,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ field: "(restrito)", before: "", after: "" });
  });

  it("com includeSensitive: true mantém o conteúdo", () => {
    const rows = historyRows([payroll], names, { includeSensitive: true });
    expect(rows.find((r) => r.field === "Categoria")?.after).toBe("Salários");
    expect(rows.find((r) => r.field === "Valor bruto")?.after).toBe("5000,00");
    expect(rows.some((r) => r.field === "(restrito)")).toBe(false);
  });

  it("categoria preenchida fora do mapa de nomes é restrita sem o flag", () => {
    const rows = historyRows(
      [version({ after: { description: "X", categoryId: "cat-x" } })],
      names,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ field: "(restrito)", before: "", after: "" });
  });

  it("retrato sem categoryId é restrito sem o flag", () => {
    const rows = historyRows([version({ after: { description: "X" } })], names);
    expect(rows[0]?.field).toBe("(restrito)");
  });

  it("snapshot ilegível continua (ilegível), com ou sem o flag", () => {
    expect(historyRows([version({ after: "lixo" })], names)[0]?.field).toBe("(ilegível)");
    expect(
      historyRows([version({ after: "lixo" })], names, { includeSensitive: true })[0]?.field,
    ).toBe("(ilegível)");
  });

  it("versão não sensível sem o flag é igual à de hoje", () => {
    const v = version();
    expect(historyRows([v], names)).toEqual(historyRows([v], names, { includeSensitive: true }));
    expect(historyRows([v], names).find((r) => r.field === "Descrição")?.after).toBe("Arroz");
  });

  it("categoria nula (sem categoria) não é sensível", () => {
    const rows = historyRows([version({ after: { description: "Y", categoryId: null } })], names);
    expect(rows.find((r) => r.field === "Descrição")?.after).toBe("Y");
  });
});
