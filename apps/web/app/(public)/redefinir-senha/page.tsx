import { ResetPasswordForm } from "@/features/auth/reset-password-form";

// O link do e-mail traz o token no fragmento (#token=...); sem Referer, por segurança.
export const metadata = {
  title: "Nova senha | Finanças para restaurantes",
  referrer: "no-referrer" as const,
};

export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 p-4">
      <h1 className="text-2xl font-semibold">Nova senha</h1>
      <ResetPasswordForm />
    </main>
  );
}
