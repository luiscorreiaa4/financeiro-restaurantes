import { RequireAction } from "@/components/require-action";
import { EntriesScreen } from "@/features/entries/entries-screen";
import { requireCurrentSession } from "@/lib/auth/session";
import { todayBusinessDate } from "@/lib/format";

// A API repete a checagem; aqui só evitamos mostrar a página a quem não tem a ação.
export default async function Page() {
  const me = await requireCurrentSession();
  return (
    <RequireAction me={me} action="entry:view">
      <EntriesScreen me={me} today={todayBusinessDate()} />
    </RequireAction>
  );
}
