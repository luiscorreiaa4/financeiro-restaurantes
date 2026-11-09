import { Welcome } from "@/features/signup/welcome";
import { parsePublicEnv } from "@/lib/env";

export const metadata = { title: "Boas-vindas | Finanças para restaurantes" };

export default function WelcomePage() {
  // Referência literal: o Next embute a variável pública no build.
  const { NEXT_PUBLIC_WHATSAPP_NUMBER } = parsePublicEnv({
    NEXT_PUBLIC_WHATSAPP_NUMBER: process.env.NEXT_PUBLIC_WHATSAPP_NUMBER,
  });
  return <Welcome whatsappNumber={NEXT_PUBLIC_WHATSAPP_NUMBER} />;
}
