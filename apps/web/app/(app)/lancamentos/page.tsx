import { PageGuard } from "@/components/page-guard";
import { EntriesScreen } from "@/features/entries/entries-screen";
import { todayBusinessDate } from "@/lib/format";

// A API repete a checagem; aqui só evitamos mostrar a página a quem não tem a ação.
export default function Page() {
  return (
    <PageGuard action="entry:view">
      {(me) => <EntriesScreen me={me} today={todayBusinessDate()} />}
    </PageGuard>
  );
}
