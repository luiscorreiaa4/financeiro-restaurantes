"use client";

import { timestampToBR } from "@app/core";
import { EXPORT_MAX_ROWS, type ExportErrorCode, type ExportItem } from "@app/core/contracts";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiError } from "@/lib/api/client";
import type { FullMe } from "@/lib/api/me-contract";
import { formatBusinessDate } from "@/lib/format";
import { useIsClient } from "@/lib/use-is-client";
import { type ExportsScope, useDownloadExport, useExports, useExportsScope } from "./use-exports";

export const EMPTY_MESSAGE =
  "Nenhuma exportação nos últimos 7 dias. Exporte pela lista de Lançamentos.";

const ERROR_TEXT: Record<ExportErrorCode, string> = {
  forbidden: "Você perdeu a permissão para exportar.",
  too_many_rows: `O período tem mais de ${EXPORT_MAX_ROWS / 1000} mil linhas. Reduza o período ou use filtros.`,
  generation_failed: "Não foi possível gerar o arquivo. Tente de novo.",
};

const NUMBER = new Intl.NumberFormat("pt-BR");

/** Texto da situação (RF29.R4); pronta que já não está disponível (7 dias) é "Expirada". */
export function statusLabel(item: ExportItem): string {
  if (item.status === "failed") return "Falhou";
  if (item.status === "ready") return item.available ? "Pronta" : "Expirada";
  return item.status === "generating" ? "Gerando" : "Na fila";
}

function periodOf(item: ExportItem): string {
  return `${formatBusinessDate(item.filters.from)} a ${formatBusinessDate(item.filters.to)}`;
}

function rowsOf(item: ExportItem): string {
  return item.rowCount === null ? "—" : NUMBER.format(item.rowCount);
}

function downloadError(error: unknown): string {
  if (error instanceof ApiError && error.status === 410) return "O arquivo expirou.";
  return "Não foi possível baixar agora. Tente de novo.";
}

function DownloadButton({ item, scope, navigate }: Row) {
  const download = useDownloadExport(scope, navigate);
  if (!item.available) return null;
  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        size="sm"
        variant="outline"
        disabled={download.isPending}
        onClick={() => download.mutate(item.id)}
      >
        Baixar
      </Button>
      {download.isError && (
        <p role="alert" className="text-xs text-destructive">
          {downloadError(download.error)}
        </p>
      )}
    </div>
  );
}

type Row = { item: ExportItem; scope: ExportsScope; navigate?: (url: string) => void };

function Failure({ item }: { item: ExportItem }) {
  if (item.status !== "failed" || item.errorCode === null) return null;
  return <span className="block text-xs text-muted-foreground">{ERROR_TEXT[item.errorCode]}</span>;
}

function ExportsTable({ items, scope, navigate }: { items: ExportItem[] } & Omit<Row, "item">) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Pedido em</TableHead>
          <TableHead>Formato</TableHead>
          <TableHead>Conteúdo</TableHead>
          <TableHead>Período</TableHead>
          <TableHead className="text-right">Linhas</TableHead>
          <TableHead>Situação</TableHead>
          <TableHead>
            <span className="sr-only">Ação</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {items.map((item) => (
          <TableRow key={item.id}>
            <TableCell>{timestampToBR(item.createdAt)}</TableCell>
            <TableCell>{item.format === "xlsx" ? "XLSX" : "CSV"}</TableCell>
            <TableCell>{item.content === "full" ? "Completo" : "Lançamentos"}</TableCell>
            <TableCell>{periodOf(item)}</TableCell>
            <TableCell className="text-right">{rowsOf(item)}</TableCell>
            <TableCell>
              {statusLabel(item)}
              <Failure item={item} />
            </TableCell>
            <TableCell>
              <DownloadButton item={item} scope={scope} navigate={navigate} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ExportCard({ item, scope, navigate }: Row) {
  return (
    <li className="flex flex-col gap-1 rounded-lg border p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{statusLabel(item)}</span>
        <span className="text-muted-foreground">{timestampToBR(item.createdAt)}</span>
      </div>
      <p>
        {item.format === "xlsx" ? "XLSX" : "CSV"} ·{" "}
        {item.content === "full" ? "Completo" : "Lançamentos"} · {rowsOf(item)} linhas
      </p>
      <p className="text-muted-foreground">{periodOf(item)}</p>
      <Failure item={item} />
      <DownloadButton item={item} scope={scope} navigate={navigate} />
    </li>
  );
}

/** Lista dos pedidos dos últimos 7 dias, com a situação e o botão Baixar (RF29, Pesquisa). */
export function ExportsView({
  scope,
  navigate,
}: {
  scope: ExportsScope;
  /** Só os testes trocam a navegação até o link de download. */
  navigate?: (url: string) => void;
}) {
  const exports = useExports(scope, { poll: true });
  // O aviso da casca pode ter buscado a lista antes da hidratação: o servidor mostra o esqueleto, e o
  // cliente tem de começar igual (depois do primeiro efeito já mostra os dados).
  const isClient = useIsClient();
  const items = exports.data?.items ?? [];

  return (
    <section className="flex min-w-0 flex-col gap-4">
      <h1 className="text-2xl font-semibold">Exportações</h1>
      {exports.isPending || !isClient ? (
        <div role="status" className="flex flex-col gap-2">
          <span className="sr-only">Carregando exportações…</span>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : exports.isError ? (
        <div role="alert" className="flex flex-col items-start gap-2 rounded-lg border p-4">
          <p className="text-sm">Não foi possível carregar as exportações.</p>
          <Button variant="outline" onClick={() => void exports.refetch()}>
            Tentar de novo
          </Button>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border p-6 text-center text-sm text-muted-foreground">
          <p>{EMPTY_MESSAGE}</p>
          <Link href="/lancamentos" className="underline">
            Lançamentos
          </Link>
        </div>
      ) : (
        <>
          <div className="hidden md:block">
            <ExportsTable items={items} scope={scope} navigate={navigate} />
          </div>
          <ul className="flex flex-col gap-2 md:hidden">
            {items.map((item) => (
              <ExportCard key={item.id} item={item} scope={scope} navigate={navigate} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** Página `/exportacoes`: liga a lista à API do navegador e ao contexto ativo. */
export function ExportsScreen({ me }: { me: FullMe }) {
  const scope = useExportsScope(me);
  return <ExportsView scope={scope} />;
}
