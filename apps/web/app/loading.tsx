export default function Loading() {
  return (
    <main className="p-4" aria-busy="true">
      <div className="h-6 w-40 animate-pulse rounded bg-muted" />
      <span className="sr-only">Carregando…</span>
    </main>
  );
}
