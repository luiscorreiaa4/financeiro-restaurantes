// Prova da D-F7 (F5, T2). Fora da suíte padrão: rode com
//   RUN_SPIKE=1 pnpm --filter @app/api exec vitest run export-libs.spike
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import writeXlsxFile from "write-excel-file/node";

const OUT_DIR = process.env.SPIKE_OUT_DIR ?? ".";

type Cell = Parameters<typeof writeXlsxFile>[0] extends infer S
  ? S extends ReadonlyArray<ReadonlyArray<infer C>>
    ? C
    : never
  : never;

function header(labels: string[]): Cell[] {
  return labels.map((value) => ({ value, fontWeight: "bold" }) as Cell);
}

describe("write-excel-file com 100 mil linhas", () => {
  it("gera duas abas em menos de 60 s e menos de 512 MB", async () => {
    const entries: Cell[][] = [header(["Data", "Descrição", "Valor", "Pedidos"])];
    for (let i = 0; i < 100_000; i++) {
      entries.push([
        { value: new Date(Date.UTC(2026, 9, 1 + (i % 28))), type: Date, format: "dd/mm/yyyy" },
        { value: i % 7 === 0 ? '=HYPERLINK("x")' : `Pão de açúcar ${i}`, type: String },
        { value: (i * 137) / 100 - 250, type: Number, format: '"R$" #,##0.00' },
        { value: i % 50, type: Number, format: "0" },
      ] as Cell[]);
    }
    const history: Cell[][] = [header(["Lançamento", "Versão", "Campo", "Antes", "Depois"])];
    for (let i = 0; i < 10_000; i++) {
      history.push([
        { value: `id-${i}`, type: String },
        { value: 1 + (i % 3), type: Number },
        { value: "Valor", type: String },
        { value: "10,00", type: String },
        { value: "12,50", type: String },
      ] as Cell[]);
    }

    let peak = process.memoryUsage().heapUsed;
    const timer = setInterval(() => {
      peak = Math.max(peak, process.memoryUsage().heapUsed);
    }, 50);
    const started = Date.now();
    const buffer = await writeXlsxFile([
      { data: entries, sheet: "Lançamentos" },
      { data: history, sheet: "Histórico" },
    ] as never).toBuffer();
    const seconds = (Date.now() - started) / 1000;
    clearInterval(timer);
    peak = Math.max(peak, process.memoryUsage().heapUsed);
    const megabytes = peak / 1024 / 1024;
    console.log(
      `xlsx: ${seconds.toFixed(1)} s, pico de heap ${megabytes.toFixed(0)} MB, ${buffer.length} bytes`,
    );

    expect(seconds).toBeLessThan(60);
    expect(megabytes).toBeLessThan(512);

    const files = unzipSync(new Uint8Array(buffer));
    expect(Object.keys(files)).toContain("xl/styles.xml");
    const styles = strFromU8(files["xl/styles.xml"] as Uint8Array);
    expect(styles).toContain("R$");
    writeFileSync(join(OUT_DIR, "prova.xlsx"), buffer);
  }, 120_000);

  it("grava o valor como número e a data como data (arquivo pequeno)", async () => {
    const buffer = await writeXlsxFile([
      [
        { value: new Date(Date.UTC(2026, 9, 5)), type: Date, format: "dd/mm/yyyy" },
        { value: 1234.56, type: Number, format: '"R$" #,##0.00' },
      ],
    ] as never).toBuffer();
    const files = unzipSync(new Uint8Array(buffer));
    const sheetName = Object.keys(files).find((k) => k.startsWith("xl/worksheets/sheet"));
    const sheet = strFromU8(files[sheetName as string] as Uint8Array);
    console.log(sheet);
    expect(sheet).toContain("<v>1234.56</v>");
    expect(sheet).not.toMatch(/<c [^>]*t="s"[^>]*><v>1234/);
  });
});

describe("fflate", () => {
  it("gera zip com duas entradas que o unzip lê de volta", () => {
    const zip = zipSync({
      "lancamentos.csv": strToU8("﻿a;b\r\n1;2\r\n"),
      "historico.csv": strToU8("﻿x;y\r\n"),
    });
    writeFileSync(join(OUT_DIR, "prova.zip"), zip);
    const back = unzipSync(zip);
    expect(Object.keys(back).sort()).toEqual(["historico.csv", "lancamentos.csv"]);
    // strFromU8 (TextDecoder) descarta o BOM: confira os bytes brutos.
    expect([...(back["lancamentos.csv"] as Uint8Array).slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  });
});
