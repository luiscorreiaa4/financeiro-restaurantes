"use client";

import Link from "next/link";
import { InstallMenuItem } from "@/components/install-menu-item";
import { SignOutButton } from "@/features/auth/sign-out-button";

/**
 * Nome do usuário, "Meu perfil", ajuda para instalar o app (some se já instalado, DD-44) e saída.
 * O nome é texto, nunca HTML. No cabeçalho do celular não há espaço para o item: lá o
 * `showInstall` fica falso e o item mora no menu lateral.
 */
export function UserMenu({
  name,
  className,
  showInstall = true,
}: {
  name: string;
  className?: string;
  showInstall?: boolean;
}) {
  return (
    <div className={className ?? "flex flex-col gap-2"}>
      <span className="min-w-0 truncate text-sm font-medium">{name}</span>
      <Link href="/perfil" className="text-sm text-primary underline-offset-4 hover:underline">
        Meu perfil
      </Link>
      {showInstall && <InstallMenuItem />}
      <SignOutButton />
    </div>
  );
}
