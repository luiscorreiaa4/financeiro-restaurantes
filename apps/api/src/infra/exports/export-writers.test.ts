import { ENTRY_EXPORT_COLUMNS, type ExportColumn } from "@app/core";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  type ExportSheet,
  exportContentType,
  exportFileName,
  writeCsv,
  writeXlsx,
  zipFiles,
} from "./export-writers";

interface Row {
  day: string;
  at: string;
  text: string;
  cents: number;
  qty: number | null;
}
const columns: readonly ExportColumn<Row>[] = [
  { key: "day", label: "Dia", type: "date", value: (r) => r.day },
  { key: "at", label: "Criado", type: "datetime", value: (r) => r.at },
  { key: "text", label: "Descrição", type: "text", value: (r) => r.text },
  { key: "cents", label: "Valor", type: "money", value: (r) => r.cents },
  { key: "qty", label: "Qtd", type: "decimal", value: (r) => r.qty },
];
const sheet = (rows: Row[]): ExportSheet<Row> => ({ name: "Lançamentos", columns, rows });
const base: Row = {
  day: "2026-10-05",
  at: "2026-10-05T01:30:00.000Z",
  text: "Arroz",
  cents: 123456,
  qty: 2.5,
};

async function sheetXml(rows: Row[]) {
  const files = unzipSync(await writeXlsx([sheet(rows)]));
  const name = Object.keys(files).find((k) => k.startsWith("xl/worksheets/sheet")) as string;
  return {
    files,
    xml: strFromU8(files[name] as Uint8Array),
    styles: strFromU8(files["xl/styles.xml"] as Uint8Array),
  };
}

describe("writeXlsx", () => {
  it("grava dinheiro como número com formato de moeda, sem texto", async () => {
    const { xml, styles } = await sheetXml([base]);
    expect(xml).toContain("<v>1234.56</v>");
    expect(xml).not.toMatch(/<c [^>]*t="s"[^>]*><v>1234/);
    expect(styles).toContain("R$");
    expect(styles).toContain("#,##0.00");
  });

  it("converte centavos negativos e pequenos sem ruído de ponto flutuante", async () => {
    const { xml } = await sheetXml([
      { ...base, cents: -123456 },
      { ...base, cents: 5 },
    ]);
    expect(xml).toContain("<v>-1234.56</v>");
    expect(xml).toContain("<v>0.05</v>");
  });

  it("grava a data de negócio como data UTC, não como texto", async () => {
    const { xml, styles } = await sheetXml([base]);
    // 2026-10-05 = serial 46300 no Excel
    expect(xml).toContain("<v>46300</v>");
    expect(styles).toContain("dd/mm/yyyy");
    expect(xml).not.toContain("05/10/2026");
  });

  it("grava o instante no horário de São Paulo (01:30Z = 22:30 do dia anterior)", async () => {
    const { xml, styles } = await sheetXml([base]);
    expect(styles).toContain("dd/mm/yyyy hh:mm");
    // 2026-10-04 22:30 => 46299 + 22:30/24
    const value = Number(/<v>(46299\.[0-9]+)<\/v>/.exec(xml)?.[1]);
    expect(value).toBeCloseTo(46299 + 22.5 / 24, 5);
  });

  it("neutraliza fórmula só no texto: =HYPERLINK vira apóstrofo, número não", async () => {
    const { files, xml } = await sheetXml([{ ...base, text: '=HYPERLINK("x")', cents: -123456 }]);
    const strings = strFromU8(files["xl/sharedStrings.xml"] as Uint8Array);
    expect(strings).toMatch(/'=HYPERLINK\((&quot;|")x(&quot;|")\)/);
    expect(strings).not.toMatch(/>=HYPERLINK/);
    expect(strings).not.toContain("'-1234");
    expect(xml).toContain("<v>-1234.56</v>");
  });

  it("deixa célula nula vazia e gera duas abas", async () => {
    const buffer = await writeXlsx([
      sheet([{ ...base, qty: null }]),
      { name: "Histórico", columns: ENTRY_EXPORT_COLUMNS.slice(0, 1), rows: [] },
    ]);
    const files = unzipSync(buffer);
    const workbook = strFromU8(files["xl/workbook.xml"] as Uint8Array);
    expect(workbook).toContain("Lançamentos");
    expect(workbook).toContain("Histórico");
  });
});

describe("writeCsv", () => {
  it("começa com BOM, usa ; e neutraliza fórmula entre aspas", () => {
    const bytes = writeCsv(sheet([{ ...base, text: '=HYPERLINK("x")', cents: -123456 }]));
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
    expect(text).toContain(`"'=HYPERLINK(""x"")"`);
    expect(text).toContain(";-1234,56;");
    expect(text).toContain("04/10/2026 22:30");
    expect(text).toContain("\r\n");
  });
});

describe("zipFiles", () => {
  it("tem as duas entradas", () => {
    const zip = zipFiles({ "a.csv": writeCsv(sheet([base])), "b.csv": writeCsv(sheet([])) });
    expect(Object.keys(unzipSync(zip)).sort()).toEqual(["a.csv", "b.csv"]);
  });
});

describe("exportFileName e exportContentType", () => {
  const filters = { from: "2026-10-01", to: "2026-10-31" } as never;
  it("nomeia pelo período", () => {
    expect(exportFileName("entries", "xlsx", filters)).toBe(
      "lancamentos_2026-10-01_2026-10-31.xlsx",
    );
    expect(exportFileName("entries", "csv", filters)).toBe("lancamentos_2026-10-01_2026-10-31.csv");
    expect(exportFileName("full", "xlsx", filters)).toBe(
      "lancamentos-completo_2026-10-01_2026-10-31.xlsx",
    );
    expect(exportFileName("full", "csv", filters)).toBe(
      "lancamentos-completo_2026-10-01_2026-10-31.zip",
    );
  });
  it("devolve o tipo de conteúdo", () => {
    expect(exportContentType("xlsx")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(exportContentType("csv")).toBe("text/csv; charset=utf-8");
    expect(exportContentType("zip")).toBe("application/zip");
  });
});
