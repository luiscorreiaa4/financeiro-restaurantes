"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { FullMe } from "@/lib/api/me-contract";
import {
  type ExportsScope,
  isExportPending,
  useDownloadExport,
  useExports,
  useExportsScope,
} from "./use-exports";

type Notice = { id: string; kind: "ready" | "failed" };

function ReadyNotice({
  id,
  scope,
  navigate,
  onClose,
}: {
  id: string;
  scope: ExportsScope;
  navigate?: (url: string) => void;
  onClose: () => void;
}) {
  const download = useDownloadExport(scope, navigate);
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-3 border-b bg-muted px-4 py-2 text-sm"
    >
      <p>Sua exportação está pronta.</p>
      <Button
        size="sm"
        disabled={download.isPending}
        onClick={() => download.mutate(id, { onSuccess: onClose })}
      >
        Baixar
      </Button>
      {download.isError && (
        <span role="alert" className="text-destructive">
          Não foi possível baixar agora. Tente pela tela Exportações.
        </span>
      )}
      <Button size="sm" variant="ghost" onClick={onClose}>
        Fechar
      </Button>
    </div>
  );
}

function FailedNotice({ onClose }: { onClose: () => void }) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-3 border-b bg-muted px-4 py-2 text-sm"
    >
      <p>A exportação falhou.</p>
      <Link href="/exportacoes" className="underline">
        Ver exportações
      </Link>
      <Button size="sm" variant="ghost" onClick={onClose}>
        Fechar
      </Button>
    </div>
  );
}

/**
 * Avisa, em qualquer página, quando um pedido de exportação que estava na fila ou sendo gerado
 * termina (RF29.R4). A consulta só se repete enquanto houver pedido pendente. Quem carrega a página
 * com um pedido que já estava pronto não é avisado: o aviso é da transição, não do estado.
 */
export function ExportNotice({
  scope,
  navigate,
}: {
  scope: ExportsScope;
  navigate?: (url: string) => void;
}) {
  const exports = useExports(scope, { poll: true });
  // Ids que estavam na fila ou gerando na leitura anterior.
  const pending = useRef<ReadonlySet<string>>(new Set());
  // Ids já anunciados e fechados: o mesmo pedido não volta.
  const announced = useRef<Set<string>>(new Set());
  const [notices, setNotices] = useState<Notice[]>([]);
  const data = exports.data;

  useEffect(() => {
    if (!data) return;
    const next = new Set<string>();
    const fresh: Notice[] = [];
    for (const item of data.items) {
      if (isExportPending(item)) {
        next.add(item.id);
      } else if (
        pending.current.has(item.id) &&
        !announced.current.has(item.id) &&
        (item.status === "ready" || item.status === "failed")
      ) {
        announced.current.add(item.id);
        fresh.push({ id: item.id, kind: item.status });
      }
    }
    pending.current = next;
    if (fresh.length > 0) setNotices((current) => [...current, ...fresh]);
  }, [data]);

  function close(id: string) {
    setNotices((current) => current.filter((notice) => notice.id !== id));
  }

  return (
    <>
      {notices.map((notice) =>
        notice.kind === "ready" ? (
          <ReadyNotice
            key={notice.id}
            id={notice.id}
            scope={scope}
            navigate={navigate}
            onClose={() => close(notice.id)}
          />
        ) : (
          <FailedNotice key={notice.id} onClose={() => close(notice.id)} />
        ),
      )}
    </>
  );
}

/** Aviso da casca: só com sessão completa e `export:data` (a casca decide). */
export function ExportNotifier({ me }: { me: FullMe }) {
  const scope = useExportsScope(me);
  return <ExportNotice scope={scope} />;
}
