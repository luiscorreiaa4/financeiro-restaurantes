"use client";

import { QueryErrorResetBoundary } from "@tanstack/react-query";
import { Component, type ErrorInfo, type ReactNode, Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

type Props = { title: string; onReset(): void; children: ReactNode };
type State = { failed: boolean };

/**
 * Fronteira de erro de um bloco do dashboard (RF27.Obs3): a falha de um bloco não derruba os
 * vizinhos. Componente próprio, sem dependência nova. Nunca mostra a mensagem da exceção.
 */
class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(_error: Error, _info: ErrorInfo): void {
    // Sem log de conteúdo: nenhum valor nem nome de dado do tenant sai daqui (RNF11).
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="flex flex-col items-start gap-2 rounded-lg border p-4 text-sm">
        <p>Não foi possível carregar “{this.props.title}”.</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            this.props.onReset();
            this.setState({ failed: false });
          }}
        >
          Tentar de novo
        </Button>
      </div>
    );
  }
}

/** Carregamento e falha só do bloco: `Suspense` com esqueleto dentro da fronteira de erro. */
export function BlockBoundary({ title, children }: { title: string; children: ReactNode }) {
  return (
    <QueryErrorResetBoundary>
      {({ reset }) => (
        <ErrorBoundary title={title} onReset={reset}>
          <Suspense
            fallback={
              <div aria-busy="true">
                <Skeleton className="h-32 w-full" />
                <span className="sr-only">Carregando {title}…</span>
              </div>
            }
          >
            {children}
          </Suspense>
        </ErrorBoundary>
      )}
    </QueryErrorResetBoundary>
  );
}
