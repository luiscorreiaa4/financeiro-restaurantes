"use client";

import { useSearchParams } from "next/navigation";
import type { FullMe } from "@/lib/api/me-contract";
import { MembersScreen } from "./members-screen";
import { useMembersScope } from "./use-members";

export function MembersPage({ me, whatsappNumber }: { me: FullMe; whatsappNumber?: string }) {
  const startNew = useSearchParams().get("novo") === "1";
  return (
    <MembersScreen
      scope={useMembersScope(me)}
      whatsappNumber={whatsappNumber}
      startNew={startNew}
    />
  );
}
