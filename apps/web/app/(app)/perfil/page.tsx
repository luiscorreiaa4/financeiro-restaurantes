import { ProfileView } from "@/features/profile/profile-view";

export const metadata = { title: "Meu perfil | Finanças para restaurantes" };

// Dado de usuário: lido no navegador (TanStack Query), nunca em cache de servidor.
export default function ProfilePage() {
  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Meu perfil</h1>
      <ProfileView />
    </section>
  );
}
