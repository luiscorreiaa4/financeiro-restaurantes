"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import type { FullMe } from "@/lib/api/me-contract";
import { useSettingsScope } from "../shared/use-settings";
import { type SuppliersPeriod, SuppliersScreen } from "./suppliers-screen";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function SuppliersWithUrl({ me }: { me: FullMe }) {
  const scope = useSettingsScope(me);
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const from = search.get("from");
  const to = search.get("to");
  const period: SuppliersPeriod = {
    ...(from && DATE.test(from) ? { from } : {}),
    ...(to && DATE.test(to) ? { to } : {}),
  };
  function change(next: SuppliersPeriod) {
    const params = new URLSearchParams();
    if (next.from && DATE.test(next.from)) params.set("from", next.from);
    if (next.to && DATE.test(next.to)) params.set("to", next.to);
    const text = params.toString();
    router.replace(text === "" ? pathname : `${pathname}?${text}`);
  }
  return <SuppliersScreen scope={scope} period={period} onPeriodChange={change} />;
}

/** O período mora na URL (`from` e `to`); sem ele o servidor usa o mês corrente. */
export function SuppliersPage({ me }: { me: FullMe }) {
  return (
    <Suspense fallback={<p role="status">Carregando…</p>}>
      <SuppliersWithUrl me={me} />
    </Suspense>
  );
}
