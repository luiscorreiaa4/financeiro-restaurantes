import { z } from "zod";

// O web não usa o loadEnv de @app/config: ele exige banco e WhatsApp, que o web nunca vê.
const webEnvSchema = z.object({
  API_URL: z.url(),
});

export type WebEnv = z.infer<typeof webEnvSchema>;

export function parseWebEnv(source: Record<string, string | undefined>): WebEnv {
  return webEnvSchema.parse({ API_URL: source.API_URL });
}
