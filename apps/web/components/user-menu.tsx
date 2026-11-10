import Link from "next/link";
import { SignOutButton } from "@/features/auth/sign-out-button";

/** Nome do usuário, acesso a "Meu perfil" e saída. O nome é texto, nunca HTML. */
export function UserMenu({ name, className }: { name: string; className?: string }) {
  return (
    <div className={className ?? "flex flex-col gap-2"}>
      <span className="min-w-0 truncate text-sm font-medium">{name}</span>
      <Link href="/perfil" className="text-sm text-primary underline-offset-4 hover:underline">
        Meu perfil
      </Link>
      <SignOutButton />
    </div>
  );
}
