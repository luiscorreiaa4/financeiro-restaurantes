import { z } from "zod";

// O web não usa o loadEnv de @app/config: ele exige banco e WhatsApp, que o web nunca vê.
const webEnvSchema = z.object({
  API_URL: z.url(),
});

export type WebEnv = z.infer<typeof webEnvSchema>;

export function parseWebEnv(source: Record<string, string | undefined>): WebEnv {
  return webEnvSchema.parse({ API_URL: source.API_URL });
}

/** Telefone com DDI: dígitos e os separadores comuns, 10 a 15 dígitos (limite do E.164). */
const whatsappNumber = z
  .string()
  .regex(/^\+?[\d\s().-]+$/, "Use só dígitos, +, espaços, parênteses e hífen")
  .refine((value) => {
    const digits = value.replace(/\D/g, "").length;
    return digits >= 10 && digits <= 15;
  }, "O número precisa ter de 10 a 15 dígitos, com o DDI");

// Variáveis públicas (vão para o navegador). Sem número configurado, a tela de boas-vindas
// mostra um aviso em vez de um link quebrado (desenvolvimento e ambientes sem WhatsApp).
const publicEnvSchema = z.object({
  NEXT_PUBLIC_WHATSAPP_NUMBER: whatsappNumber.optional(),
});

export type PublicEnv = z.infer<typeof publicEnvSchema>;

export function parsePublicEnv(source: Record<string, string | undefined>): PublicEnv {
  const number = source.NEXT_PUBLIC_WHATSAPP_NUMBER?.trim();
  return publicEnvSchema.parse({ NEXT_PUBLIC_WHATSAPP_NUMBER: number ? number : undefined });
}
