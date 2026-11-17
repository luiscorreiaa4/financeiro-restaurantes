"use client";

import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type ChartColumn = { header: string; numeric?: boolean };

/**
 * Bloco de gráfico com a alternativa em tabela (RF27.Obs2): o alternador "Gráfico | Tabela"
 * deixa os mesmos números em texto, para leitor de tela e para quem prefere ler os valores.
 * As células já chegam formatadas: este componente não faz conta.
 */
export function ChartFrame({
  title,
  chart,
  columns,
  rows,
}: {
  title: string;
  chart: ReactNode;
  columns: readonly ChartColumn[];
  rows: readonly { key: string; cells: readonly string[] }[];
}) {
  return (
    <Card role="region" aria-label={title} className="min-w-0">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="min-w-0">
        <Tabs defaultValue="chart">
          <TabsList aria-label={`Formato de ${title}`}>
            <TabsTrigger value="chart">Gráfico</TabsTrigger>
            <TabsTrigger value="table">Tabela</TabsTrigger>
          </TabsList>
          <TabsContent value="chart">{chart}</TabsContent>
          <TabsContent value="table">
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((column) => (
                    <TableHead key={column.header} className={column.numeric ? "text-right" : ""}>
                      {column.header}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.key}>
                    {row.cells.map((cell, index) => (
                      <TableCell
                        // biome-ignore lint/suspicious/noArrayIndexKey: a posição da célula é a identidade da coluna.
                        key={index}
                        className={columns[index]?.numeric ? "text-right" : ""}
                      >
                        {cell}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
