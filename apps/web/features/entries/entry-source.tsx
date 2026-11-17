"use client";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CHANNEL_LABELS, formatInstant } from "./field-labels";
import { useEntrySource } from "./use-entries";

function Quote({ label, text }: { label: string; text: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-xs text-muted-foreground">{label}</h3>
      {/* Texto do usuário: sempre como texto, nunca como HTML (RF25.R1, CA03). */}
      <p className="whitespace-pre-wrap break-words rounded-md border p-2 text-sm">{text}</p>
    </div>
  );
}

/**
 * Aba Origem (RF25): de onde o lançamento veio. No F3a mostra texto, transcrição e chave de
 * acesso; o áudio e a imagem ficam para a E10 (pendência F3-1).
 */
export function EntrySource({
  entryId,
  created,
}: {
  entryId: string;
  /** Quem criou e quando (do detalhe): a origem do lançamento do painel é a criação (RF25.Obs3). */
  created?: { by: string; at: string };
}) {
  const source = useEntrySource(entryId);

  if (source.isPending) {
    return (
      <div role="status">
        <span className="sr-only">Carregando a origem…</span>
        <Skeleton className="h-16 w-full" />
      </div>
    );
  }
  if (source.isError) {
    return (
      <div role="alert" className="flex flex-col items-start gap-2">
        <p className="text-sm">Não foi possível carregar a origem.</p>
        <Button variant="outline" onClick={() => void source.refetch()}>
          Tentar de novo
        </Button>
      </div>
    );
  }

  const { data } = source;
  const sent = [data.sentBy?.name, data.sentAt ? formatInstant(data.sentAt) : null].filter(Boolean);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        Canal: {CHANNEL_LABELS[data.channel]}
        {sent.length > 0 && ` · ${sent.join(" · ")}`}
      </p>
      {data.restricted ? (
        <p className="rounded-md border p-2 text-sm">Contém informação restrita</p>
      ) : (
        <>
          {data.kind === "none" &&
            (data.channel === "web" && created !== undefined ? (
              <p className="text-sm">
                Lançado manualmente no painel por {created.by} em {formatInstant(created.at)}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                Este lançamento não veio de uma mensagem.
              </p>
            ))}
          {data.text !== null && <Quote label="Texto original" text={data.text} />}
          {data.transcription !== null && <Quote label="Transcrição" text={data.transcription} />}
          {data.accessKey !== null && (
            <div className="flex flex-col gap-1">
              <h3 className="text-xs text-muted-foreground">Chave de acesso da nota</h3>
              <p className="break-all font-mono text-sm">{data.accessKey}</p>
            </div>
          )}
          {(data.kind === "audio" || data.kind === "image") && !data.mediaAvailable && (
            <p className="text-sm text-muted-foreground">
              Áudio e imagem ficam disponíveis em breve.
            </p>
          )}
        </>
      )}
    </div>
  );
}
