import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFileEmailSender } from "./file-email-sender";
import { createMemoryEmailSender } from "./memory-email-sender";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe("EmailSender", () => {
  it("memory: registra o envio em sent", async () => {
    const sender = createMemoryEmailSender();
    await sender.sendAccessCode({ to: "a@b.com", code: "123456", purpose: "sign-in" });
    expect(sender.sent).toEqual([{ to: "a@b.com", code: "123456", purpose: "sign-in" }]);
  });

  it("file: cria um arquivo .json na pasta com to, code e purpose", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mail-"));
    dirs.push(dir);
    await createFileEmailSender(dir).sendAccessCode({
      to: "a@b.com",
      code: "654321",
      purpose: "email-verification",
    });
    const files = await readdir(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.json$/);
    const body = JSON.parse(await readFile(join(dir, files[0] as string), "utf8"));
    expect(body).toEqual({ to: "a@b.com", code: "654321", purpose: "email-verification" });
  });

  it("memory: aviso de conta existente fica com o link de login, sem código", async () => {
    const sender = createMemoryEmailSender();
    await sender.sendAccessCode({
      to: "a@b.com",
      purpose: "account-exists",
      loginUrl: "https://painel.exemplo/login",
    });
    expect(sender.sent).toEqual([
      { to: "a@b.com", purpose: "account-exists", loginUrl: "https://painel.exemplo/login" },
    ]);
  });

  it("file: aviso de conta existente grava o texto em português com o link de login", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mail-"));
    dirs.push(dir);
    await createFileEmailSender(dir).sendAccessCode({
      to: "a@b.com",
      purpose: "account-exists",
      loginUrl: "https://painel.exemplo/login",
    });
    const files = await readdir(dir);
    const body = JSON.parse(await readFile(join(dir, files[0] as string), "utf8"));
    expect(body).toEqual({
      to: "a@b.com",
      purpose: "account-exists",
      loginUrl: "https://painel.exemplo/login",
      text: "Você já tem conta. Entre em https://painel.exemplo/login. Para abrir outra empresa, entre e use 'Criar outra empresa'. Se não conseguir entrar, fale com o suporte.",
    });
    expect(body).not.toHaveProperty("code");
  });

  it("file: cria a pasta se não existir", async () => {
    const base = await mkdtemp(join(tmpdir(), "mail-"));
    dirs.push(base);
    const dir = join(base, "novo", "sub");
    await createFileEmailSender(dir).sendAccessCode({
      to: "a@b.com",
      code: "111111",
      purpose: "forget-password",
    });
    expect(await readdir(dir)).toHaveLength(1);
  });
});
