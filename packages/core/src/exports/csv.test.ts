import { describe, expect, it } from "vitest";
import type { ExportColumn } from "./columns";
import { toCsv } from "./csv";

interface Row {
  text: string | null;
  cents: number | null;
  day: string;
  at: string;
  n: number;
  q: number;
}

const columns: readonly ExportColumn<Row>[] = [
  { key: "text", label: "Descrição", type: "text", value: (r) => r.text },
  { key: "cents", label: "Valor", type: "money", value: (r) => r.cents },
  { key: "day", label: "Dia", type: "date", value: (r) => r.day },
  { key: "at", label: "Criado em", type: "datetime", value: (r) => r.at },
  { key: "n", label: "Pedidos", type: "int", value: (r) => r.n },
  { key: "q", label: "Quantidade", type: "decimal", value: (r) => r.q },
];

const base: Row = {
  text: "Arroz",
  cents: 1050,
  day: "2026-10-05",
  at: "2026-10-01T02:30:00Z",
  n: 3,
  q: 12.5,
};

describe("toCsv", () => {
  it("começa com BOM, separa por ponto e vírgula e termina linhas com CRLF", () => {
    const csv = toCsv(columns, [base]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toBe(
      "﻿Descrição;Valor;Dia;Criado em;Pedidos;Quantidade\r\n" +
        "Arroz;10,50;05/10/2026;30/09/2026 23:30;3;12,5\r\n",
    );
  });

  it("só o cabeçalho quando não há linhas", () => {
    expect(toCsv(columns, [])).toBe("﻿Descrição;Valor;Dia;Criado em;Pedidos;Quantidade\r\n");
  });

  it("mantém acentos intactos (CA02)", () => {
    expect(toCsv(columns, [{ ...base, text: "Pão de açúcar" }])).toContain("\r\nPão de açúcar;");
  });

  it("põe entre aspas o campo com ponto e vírgula, aspas ou quebra de linha, dobrando as aspas", () => {
    const csv = toCsv(columns, [
      { ...base, text: "a;b" },
      { ...base, text: 'diz "oi"' },
      { ...base, text: "linha1\nlinha2" },
    ]);
    expect(csv).toContain('\r\n"a;b";');
    expect(csv).toContain('\r\n"diz ""oi""";');
    expect(csv).toContain('\r\n"linha1\nlinha2";');
  });

  it("neutraliza fórmula só em coluna de texto", () => {
    const csv = toCsv(columns, [{ ...base, text: '=HYPERLINK("x")', cents: -123456 }]);
    expect(csv).toContain(`\r\n"'=HYPERLINK(""x"")";-1234,56;`);
    expect(csv).not.toContain("'-1234,56");
  });

  it("valor nulo vira célula vazia", () => {
    expect(toCsv(columns, [{ ...base, text: null, cents: null }])).toContain("\r\n;;05/10/2026;");
  });
});
