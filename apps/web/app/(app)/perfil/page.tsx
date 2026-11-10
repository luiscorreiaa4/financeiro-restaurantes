import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { cookies } from "next/headers";
import { Suspense } from "react";
import { PROFILE_KEY, profileSchema } from "@/features/profile/profile-client";
import { ProfileView } from "@/features/profile/profile-view";
import { createApiClient } from "@/lib/api/client";
import { apiUrl } from "@/lib/auth/session";
import { getQueryClient } from "@/lib/query/get-query-client";

export const metadata = { title: "Meu perfil | Finanças para restaurantes" };

// Dado de usuário: lido no servidor (sem cache, repassando o cookie) e hidratado no navegador.
async function ProfileData() {
  const cookieHeader = (await cookies()).toString();
  const api = createApiClient({
    baseUrl: apiUrl(),
    fetch: (input, init) =>
      fetch(input, { ...init, headers: { cookie: cookieHeader }, cache: "no-store" }),
  });
  const qc = getQueryClient();
  // prefetchQuery não lança: se a API falhar, nada é hidratado e o useQuery refaz a busca no navegador.
  await qc.prefetchQuery({
    queryKey: PROFILE_KEY,
    queryFn: () => api.get("/api/profile", profileSchema),
  });
  return (
    <HydrationBoundary state={dehydrate(qc)}>
      <ProfileView />
    </HydrationBoundary>
  );
}

export default function ProfilePage() {
  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Meu perfil</h1>
      <Suspense
        fallback={
          <p aria-busy="true" className="text-sm text-muted-foreground">
            Carregando…
          </p>
        }
      >
        <ProfileData />
      </Suspense>
    </section>
  );
}
