"use client";

import { MenuIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { UserMenu } from "@/components/user-menu";
import { NAV_ITEMS } from "@/lib/navigation";

function NavLinks({ label, onNavigate }: { label: string; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label={label} className="flex flex-col gap-1">
      {NAV_ITEMS.map((item) => {
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

export function AppShell({ children, userName }: { children: ReactNode; userName: string }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="flex min-h-svh flex-col md:flex-row">
      <aside className="hidden w-56 shrink-0 border-r p-4 md:block">
        <NavLinks label="Principal" />
        <UserMenu name={userName} className="mt-4 flex flex-col gap-2" />
      </aside>

      <header className="flex items-center gap-2 border-b p-2 md:hidden">
        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetTrigger render={<Button variant="outline" size="icon" aria-label="Abrir menu" />}>
            <MenuIcon />
          </SheetTrigger>
          <SheetContent side="left">
            <SheetTitle className="sr-only">Menu</SheetTitle>
            <div className="p-4">
              <NavLinks label="Menu" onNavigate={() => setMenuOpen(false)} />
            </div>
          </SheetContent>
        </Sheet>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          Finanças para restaurantes
        </span>
        <UserMenu name={userName} className="flex items-center gap-2" />
      </header>

      <main className="min-w-0 flex-1 p-4">{children}</main>
    </div>
  );
}
