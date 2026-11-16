import { PageGuard } from "@/components/page-guard";
import { TrashScreen } from "@/features/entries/trash-screen";
import { todayBusinessDate } from "@/lib/format";

// A API repete a checagem; aqui só evitamos mostrar a página a quem não pode restaurar.
export default function Page() {
  return (
    <PageGuard action="entry:restore">
      {(me) => <TrashScreen me={me} today={todayBusinessDate()} />}
    </PageGuard>
  );
}
