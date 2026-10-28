import { z } from "zod";

// Variáveis vazias no .env (ex.: "ANTHROPIC_API_KEY=") contam como ausentes.
const emptyToUndefined = (value: unknown) => (value === "" ? undefined : value);
const optionalString = z.preprocess(emptyToUndefined, z.string().min(1).optional());

const baseSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_URL: z.url(),
  API_URL: z.url(),
  PORT: z.coerce.number().int().positive().default(4000),
  TZ: z.string().min(1).default("America/Sao_Paulo"),

  DATABASE_URL: z.string().min(1),
  DATABASE_ADMIN_URL: z.string().min(1),
  // Papel `app_ingest`: o webhook grava a mensagem antes de ela ter tenant.
  DATABASE_INGEST_URL: optionalString,

  AUTH_SECRET: optionalString,

  // `dev`: respostas gravadas no banco e mostradas pelo chat de terminal (`pnpm dev:chat`).
  // `whatsapp`: envio real pela Cloud API (E10). Os adaptadores `Dev*` não sobem em produção.
  CHANNEL_MODE: z.enum(["dev", "whatsapp"]).default("dev"),
  // Contato de suporte citado nas mensagens de ajuda (a saída para humano da política da Meta).
  SUPPORT_CONTACT: optionalString,

  WHATSAPP_PHONE_NUMBER_ID: optionalString,
  WHATSAPP_BUSINESS_ACCOUNT_ID: optionalString,
  WHATSAPP_ACCESS_TOKEN: optionalString,
  WHATSAPP_APP_SECRET: optionalString,
  WHATSAPP_VERIFY_TOKEN: optionalString,

  ANTHROPIC_API_KEY: optionalString,
  AI_MODEL_DEFAULT: z.string().min(1).default("claude-haiku-5-5"),
  AI_MODEL_ADVANCED: z.string().min(1).default("claude-sonnet-5-5"),
  OPENAI_API_KEY: optionalString,
  TRANSCRIPTION_MODEL: z.string().min(1).default("gpt-4o-transcribe"),

  S3_ENDPOINT: optionalString,
  S3_REGION: z.string().min(1).default("sa-east-1"),
  S3_BUCKET: optionalString,
  S3_ACCESS_KEY_ID: optionalString,
  S3_SECRET_ACCESS_KEY: optionalString,

  SENTRY_DSN: optionalString,
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

// Em produção os segredos de integração são obrigatórios; em dev podem faltar
// até a conta correspondente existir.
const requiredInProduction = [
  "DATABASE_INGEST_URL",
  "AUTH_SECRET",
  "WHATSAPP_PHONE_NUMBER_ID",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_APP_SECRET",
  "WHATSAPP_VERIFY_TOKEN",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "S3_ENDPOINT",
  "S3_BUCKET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
] as const;

export const envSchema = baseSchema.superRefine((env, ctx) => {
  if (env.NODE_ENV !== "production") return;
  for (const key of requiredInProduction) {
    if (env[key] === undefined) {
      ctx.addIssue({ code: "custom", path: [key], message: "obrigatória em produção" });
    }
  }
});

export type Env = z.infer<typeof envSchema>;

export class EnvError extends Error {
  readonly issues: readonly { variable: string; message: string }[];

  constructor(issues: readonly { variable: string; message: string }[]) {
    // Só nomes de variáveis e motivos: nunca os valores, que podem ser segredos.
    super(
      `Variáveis de ambiente inválidas:\n${issues.map((i) => `- ${i.variable}: ${i.message}`).join("\n")}`,
    );
    this.name = "EnvError";
    this.issues = issues;
  }
}

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (result.success) return result.data;
  throw new EnvError(
    result.error.issues.map((issue) => ({
      variable: issue.path.join(".") || "(raiz)",
      message: issue.message,
    })),
  );
}
