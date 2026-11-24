import { describe, expect, it } from "vitest";
import { EnvError, loadEnv } from "./env";

const base = {
  APP_URL: "http://localhost:3000",
  API_URL: "http://localhost:4000",
  DATABASE_URL: "postgres://app:app@localhost:5432/app",
  DATABASE_ADMIN_URL: "postgres://postgres:postgres@localhost:5432/app",
};

describe("loadEnv", () => {
  it("aceita o mínimo em desenvolvimento e aplica padrões", () => {
    const env = loadEnv(base);
    expect(env.NODE_ENV).toBe("development");
    expect(env.PORT).toBe(4000);
    expect(env.TZ).toBe("America/Sao_Paulo");
    expect(env.AI_MODEL_DEFAULT).toBe("claude-haiku-5-5");
  });

  it("trata variável vazia como ausente", () => {
    const env = loadEnv({ ...base, ANTHROPIC_API_KEY: "" });
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("rejeita variável obrigatória faltando", () => {
    expect(() => loadEnv({ ...base, DATABASE_URL: undefined })).toThrow(EnvError);
  });

  it("exige segredos de integração em produção", () => {
    try {
      loadEnv({ ...base, NODE_ENV: "production" });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EnvError);
      const variables = (error as EnvError).issues.map((i) => i.variable);
      expect(variables).toContain("ANTHROPIC_API_KEY");
      expect(variables).toContain("WHATSAPP_APP_SECRET");
      expect(variables).toContain("DATABASE_INGEST_URL");
      expect(variables).toContain("DATABASE_AUTH_URL");
    }
  });

  it("a conexão de ingestão do webhook é opcional em desenvolvimento", () => {
    expect(loadEnv(base).DATABASE_INGEST_URL).toBeUndefined();
  });

  it("a conexão do papel de autenticação é opcional em desenvolvimento", () => {
    expect(loadEnv(base).DATABASE_AUTH_URL).toBeUndefined();
  });

  it("DEV_MAIL_DIR tem padrão .dev-mail e vazio vira o padrão", () => {
    expect(loadEnv(base).DEV_MAIL_DIR).toBe(".dev-mail");
    expect(loadEnv({ ...base, DEV_MAIL_DIR: "" }).DEV_MAIL_DIR).toBe(".dev-mail");
    expect(loadEnv({ ...base, DEV_MAIL_DIR: "/tmp/mail" }).DEV_MAIL_DIR).toBe("/tmp/mail");
  });

  it("o canal é o de desenvolvimento por padrão e só aceita dev ou whatsapp", () => {
    expect(loadEnv(base).CHANNEL_MODE).toBe("dev");
    expect(loadEnv({ ...base, CHANNEL_MODE: "whatsapp" }).CHANNEL_MODE).toBe("whatsapp");
    expect(() => loadEnv({ ...base, CHANNEL_MODE: "telegram" })).toThrow(EnvError);
  });

  it("o contato de suporte é opcional", () => {
    expect(loadEnv(base).SUPPORT_CONTACT).toBeUndefined();
    expect(loadEnv({ ...base, SUPPORT_CONTACT: "suporte@exemplo.com.br" }).SUPPORT_CONTACT).toBe(
      "suporte@exemplo.com.br",
    );
  });

  it("o número do produto é opcional", () => {
    expect(loadEnv(base).PRODUCT_WHATSAPP_NUMBER).toBeUndefined();
    expect(
      loadEnv({ ...base, PRODUCT_WHATSAPP_NUMBER: "" }).PRODUCT_WHATSAPP_NUMBER,
    ).toBeUndefined();
  });

  it("o número do produto aceita dígitos com ou sem + inicial, de 10 a 15", () => {
    expect(
      loadEnv({ ...base, PRODUCT_WHATSAPP_NUMBER: "5511999999999" }).PRODUCT_WHATSAPP_NUMBER,
    ).toBe("5511999999999");
    expect(
      loadEnv({ ...base, PRODUCT_WHATSAPP_NUMBER: "+5511999999999" }).PRODUCT_WHATSAPP_NUMBER,
    ).toBe("+5511999999999");
    expect(
      loadEnv({ ...base, PRODUCT_WHATSAPP_NUMBER: "1234567890" }).PRODUCT_WHATSAPP_NUMBER,
    ).toBe("1234567890");
  });

  it("o número do produto recusa formato inválido", () => {
    for (const value of [
      "55 11 99999-9999",
      "+55abc",
      "123456789",
      "1234567890123456",
      "++5511999999999",
    ]) {
      expect(() => loadEnv({ ...base, PRODUCT_WHATSAPP_NUMBER: value })).toThrow(EnvError);
    }
  });

  it("não vaza valores na mensagem de erro", () => {
    const secret = "valor-secreto-123";
    try {
      loadEnv({ ...base, PORT: secret });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain(secret);
    }
  });
});
