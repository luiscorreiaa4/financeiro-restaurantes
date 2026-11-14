"use client";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError } from "@/lib/api/client";
import { EntryData } from "./entry-data";
import { EntryHistory } from "./entry-history";
import { EntrySource } from "./entry-source";
import { useEntryDetail } from "./use-entries";

/**
 * Drawer do lançamento (RF25), aberto pelo `?entry=<id>` da URL. Id inexistente, de outra
 * empresa ou fora do que o papel vê dá a mesma resposta: "Lançamento não encontrado".
 */
export function EntryDrawer({ entryId, onClose }: { entryId: string | null; onClose(): void }) {
  const detail = useEntryDetail(entryId);
  const notFound =
    detail.error instanceof ApiError &&
    (detail.error.status === 404 || detail.error.status === 400);

  return (
    <Sheet open={entryId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full gap-3 overflow-y-auto p-4 data-[side=right]:sm:max-w-lg"
      >
        <SheetHeader className="flex-row items-start justify-between gap-2 p-0">
          <div className="flex min-w-0 flex-col">
            <SheetTitle className="break-words">
              {detail.data?.description ?? "Lançamento"}
            </SheetTitle>
            <SheetDescription>Dados, origem e histórico do lançamento.</SheetDescription>
          </div>
          <SheetClose render={<Button variant="outline" size="sm" />}>Fechar</SheetClose>
        </SheetHeader>

        {entryId === null ? null : detail.isPending ? (
          <div role="status" className="flex flex-col gap-2">
            <span className="sr-only">Carregando o lançamento…</span>
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : notFound ? (
          <p className="text-sm">Lançamento não encontrado</p>
        ) : detail.isError ? (
          <div role="alert" className="flex flex-col items-start gap-2">
            <p className="text-sm">Não foi possível carregar o lançamento.</p>
            <Button variant="outline" onClick={() => void detail.refetch()}>
              Tentar de novo
            </Button>
          </div>
        ) : (
          <Tabs defaultValue="data">
            <TabsList>
              <TabsTrigger value="data">Dados</TabsTrigger>
              <TabsTrigger value="source">Origem</TabsTrigger>
              <TabsTrigger value="history">Histórico</TabsTrigger>
            </TabsList>
            <TabsContent value="data">
              <EntryData entry={detail.data} />
            </TabsContent>
            {/* A origem só é buscada quando a aba abre (o painel inativo não é montado). */}
            <TabsContent value="source">
              <EntrySource entryId={entryId} />
            </TabsContent>
            <TabsContent value="history">
              <EntryHistory versions={detail.data.versions} />
            </TabsContent>
          </Tabs>
        )}
      </SheetContent>
    </Sheet>
  );
}
