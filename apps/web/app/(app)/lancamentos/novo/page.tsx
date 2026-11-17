import { PageGuard } from "@/components/page-guard";
import { EntryCreateScreen } from "@/features/entries/entry-create-screen";
import { todayBusinessDate } from "@/lib/format";

// A API repete a checagem; aqui só evitamos mostrar a página a quem não pode lançar.
export default function Page() {
  return (
    <PageGuard action="entry:create">
      {(me) => <EntryCreateScreen me={me} today={todayBusinessDate()} />}
    </PageGuard>
  );
}
