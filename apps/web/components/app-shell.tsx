"use client";

import { MenuIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { AccountBanner } from "@/components/account-banner";
import { ContextSwitcher } from "@/components/context-switcher";
import { SessionKeeper } from "@/components/session-keeper";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { UserMenu } from "@/components/user-menu";
import type { FullMe } from "@/lib/api/me-contract";
import { visibleNavItems } from "@/lib/navigation";

const ACCESS_REMOVED_PARAM = "aviso=acesso-removido";

function NavLinks({
  label,
  me,
  onNavigate,
}: {
  label: string;
  me: FullMe;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="flex flex-col gap-1">
      {visibleNavItems(me.context.allowedActions).map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname?.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            onClick={onNavigate}
            className="rounded-md px-3 py-2 text-sm hover:bg-muted aria-[current=page]:bg-muted aria-[current=page]:font-medium"
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/** Avisa uma vez que o acesso anterior foi perdido (sem dizer o nome) e limpa o parâmetro da URL. */
function useAccessRemovedNotice(): boolean {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const params = window.location.search.replace(/^\?/, "").split("&");
    if (!params.includes(ACCESS_REMOVED_PARAM)) return;
    setShow(true);
    const rest = params.filter((p) => p !== "" && p !== ACCESS_REMOVED_PARAM).join("&");
    window.history.replaceState(
      null,
      "",
      window.location.pathname + (rest ? `?${rest}` : "") + window.location.hash,
    );
  }, []);
  return show;
}

/**
 * Casca do painel. A página só aparece quando o contexto veio do cookie: com outra origem, o
 * `SessionKeeper` grava o cookie e recarrega, e nenhuma consulta de tenant sai antes disso.
 */
export function AppShell({ children, me }: { children: ReactNode; me: FullMe }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const accessRemoved = useAccessRemovedNotice();
  const ready = me.contextSource === "cookie";

  return (
    <div className="flex min-h-svh flex-col md:flex-row">
      <SessionKeeper me={me} />
      <aside className="hidden w-56 shrink-0 border-r p-4 md:block">
        {ready && <ContextSwitcher me={me} />}
        <div className="mt-4">
          <NavLinks label="Principal" me={me} />
        </div>
        <UserMenu name={me.name} className="mt-4 flex flex-col gap-2" />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-2 border-b p-2 md:hidden">
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger render={<Button variant="outline" size="icon" aria-label="Abrir menu" />}>
              <MenuIcon />
            </SheetTrigger>
            <SheetContent side="left">
              <SheetTitle className="sr-only">Menu</SheetTitle>
              <div className="p-4">
                <NavLinks label="Menu" me={me} onNavigate={() => setMenuOpen(false)} />
              </div>
            </SheetContent>
          </Sheet>
          <div className="min-w-0 flex-1">
            {ready ? (
              <ContextSwitcher me={me} />
            ) : (
              <span className="text-sm font-medium">Finanças para restaurantes</span>
            )}
          </div>
          <UserMenu name={me.name} className="flex items-center gap-2" />
        </header>

        <AccountBanner status={me.context.accountStatus} userRole={me.context.role} />
        {accessRemoved && (
          <p role="status" className="border-b bg-muted px-4 py-2 text-sm">
            Você não tem mais acesso à empresa ou unidade anterior.
          </p>
        )}

        <main className="min-w-0 flex-1 p-4">
          {ready ? (
            children
          ) : (
            <p role="status" aria-busy="true">
              Carregando…
            </p>
          )}
        </main>
      </div>
    </div>
  );
}
