"use client";

import {
  type EntryListQuery,
  EXPORT_MAX_PENDING,
  type ExportContent,
  type ExportFormat,
} from "@app/core/contracts";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiError } from "@/lib/api/client";
import { formatBusinessDate } from "@/lib/format";
import { countAppliedFilters, toExportFilters } from "./export-filters";
import { type ExportsScope, useCreateExport } from "./use-exports";

const TOO_MANY_MESSAGE = `Você já tem ${EXPORT_MAX_PENDING} exportações em andamento. Espere uma terminar e tente de novo.`;
const FORBIDDEN_MESSAGE = "Você não tem permissão para exportar.";
const UNAVAILABLE_MESSAGE =
  "O serviço de exportação não está disponível agora. Tente de novo em instantes.";
const FAILED_MESSAGE = "A exportação não pôde ser criada. Tente de novo.";
const FALLBACK_MESSAGE = "Não foi possível pedir a exportação. Tente de novo.";

function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return FALLBACK_MESSAGE;
  if (error.status === 429) return TOO_MANY_MESSAGE;
  if (error.status === 403) return FORBIDDEN_MESSAGE;
  if (error.status === 503) return UNAVAILABLE_MESSAGE;
  return FALLBACK_MESSAGE;
}

function filtersLabel(count: number): string {
  if (count === 0) return "Nenhum filtro além do período";
  return count === 1 ? "1 filtro aplicado" : `${count} filtros aplicados`;
}

/**
 * Botão "Exportar" da lista de lançamentos e o diálogo do pedido (RF29). O pedido leva os filtros
 * da URL, sem ordenação. Quem decide o conteúdo COMPLETO é a permissão `export:full` (`canFull`);
 * a API confere de novo.
 */
export function ExportButton({
  scope,
  query,
  canFull,
}: {
  scope: ExportsScope;
  query: EntryListQuery;
  canFull: boolean;
}) {
  const filters = useMemo(() => toExportFilters(query), [query]);
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<ExportFormat>("xlsx");
  const [content, setContent] = useState<ExportContent>("entries");
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);
  const create = useCreateExport(scope);
  // Chave da tentativa (RF26.R3, `escrita-idempotente.md`): só troca depois de um envio que deu
  // certo. Ela vale para um pedido exato: se formato, conteúdo ou filtros mudaram, é outro pedido.
  const attempt = useRef<{ key: string; signature: string } | null>(null);
  // Trava síncrona: dois cliques no mesmo instante chegam antes de o React desabilitar o botão.
  const sending = useRef(false);

  const effectiveContent: ExportContent = canFull ? content : "entries";

  function openDialog() {
    setError(null);
    setQueued(false);
    setOpen(true);
  }

  async function send() {
    if (sending.current) return;
    sending.current = true;
    setError(null);
    const signature = JSON.stringify({ format, content: effectiveContent, filters });
    if (attempt.current === null || attempt.current.signature !== signature) {
      attempt.current = { key: crypto.randomUUID(), signature };
    }
    try {
      const item = await create.mutateAsync({
        format,
        content: effectiveContent,
        filters,
        clientRequestId: attempt.current.key,
      });
      attempt.current = null;
      if (item.status === "failed") {
        // Reenvio de um pedido que a API já marcou como falho: a chave foi usada, o próximo é novo.
        setError(FAILED_MESSAGE);
        return;
      }
      setOpen(false);
      setQueued(true);
    } catch (e) {
      // O 503 grava o pedido como falho com esta chave: reenviar devolveria o falho.
      if (e instanceof ApiError && e.status === 503) attempt.current = null;
      setError(errorMessage(e));
    } finally {
      sending.current = false;
    }
  }

  const filterCount = countAppliedFilters(filters);

  return (
    <>
      <Button variant="outline" size="sm" onClick={openDialog}>
        Exportar
      </Button>
      {queued && (
        <p role="status" className="basis-full text-sm">
          Exportação na fila. Acompanhe em{" "}
          <Link href="/exportacoes" className="underline">
            Exportações
          </Link>
        </p>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Exportar lançamentos</DialogTitle>
            <DialogDescription>
              A planilha usa os filtros da lista. Você pode sair da tela: avisamos quando ficar
              pronta.
            </DialogDescription>
          </DialogHeader>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">Formato</legend>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="export-format"
                className="size-4"
                checked={format === "xlsx"}
                onChange={() => setFormat("xlsx")}
              />
              Excel (XLSX)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="export-format"
                className="size-4"
                checked={format === "csv"}
                onChange={() => setFormat("csv")}
              />
              CSV
            </label>
          </fieldset>

          {canFull && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-medium">Conteúdo</legend>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="export-content"
                  className="size-4"
                  checked={content === "entries"}
                  onChange={() => setContent("entries")}
                />
                Lançamentos
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="export-content"
                  className="mt-0.5 size-4"
                  checked={content === "full"}
                  onChange={() => setContent("full")}
                />
                <span>
                  Completo
                  <span className="block text-muted-foreground">Inclui lixeira e histórico.</span>
                </span>
              </label>
            </fieldset>
          )}

          <div className="flex flex-col gap-1 rounded-lg border p-3 text-sm">
            <p>
              Período: {formatBusinessDate(filters.from)} a {formatBusinessDate(filters.to)}
            </p>
            <p>{filtersLabel(filterCount)}</p>
          </div>

          {error !== null && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button disabled={create.isPending} onClick={() => void send()}>
              Exportar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
