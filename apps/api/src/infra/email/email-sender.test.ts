import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { passwordChangedText, passwordResetLinkText } from "./email-texts";
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

describe("aviso de troca de senha (RF03.Obs1)", () => {
  const at = new Date("2026-11-09T15:30:00.000Z");

  it("memory: guarda o aviso em sentNotices, separado de sent", async () => {
    const sender = createMemoryEmailSender();
    await sender.sendSecurityNotice({ to: "a@b.com", kind: "password-changed", at });
    expect(sender.sentNotices).toEqual([{ to: "a@b.com", kind: "password-changed", at }]);
    expect(sender.sent).toEqual([]);
  });

  it("file: grava JSON com kind e o texto do aviso", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mail-"));
    dirs.push(dir);
    await createFileEmailSender(dir).sendSecurityNotice({
      to: "a@b.com",
      kind: "password-changed",
      at,
    });
    const files = await readdir(dir);
    expect(files).toHaveLength(1);
    const body = JSON.parse(await readFile(join(dir, files[0] as string), "utf8"));
    expect(body).toEqual({
      to: "a@b.com",
      kind: "password-changed",
      text: passwordChangedText(at),
    });
  });

  it("o texto traz data e hora em America/Sao_Paulo e a orientação de procurar o suporte", () => {
    const text = passwordChangedText(at);
    expect(text).toContain("09/11/2026 12:30");
    expect(text).toContain("suporte");
  });

  it("a virada de dia respeita o fuso de São Paulo", () => {
    expect(passwordChangedText(new Date("2026-11-10T02:15:00.000Z"))).toContain("09/11/2026 23:15");
  });

  it("o texto não contém senha nem código", () => {
    const text = passwordChangedText(at).toLowerCase();
    expect(text).not.toMatch(/\d{6}/);
    expect(text).not.toContain("código:");
    expect(text).not.toContain("senha:");
  });
});

describe("e-mail do link de recuperação (RF03, DD-27)", () => {
  const url = "https://painel.exemplo/redefinir-senha#token=abc123";

  it("memory: guarda o link em sentLinks, separado de sent e sentNotices", async () => {
    const sender = createMemoryEmailSender();
    await sender.sendPasswordResetLink({ to: "a@b.com", url });
    expect(sender.sentLinks).toEqual([{ to: "a@b.com", url }]);
    expect(sender.sent).toEqual([]);
    expect(sender.sentNotices).toEqual([]);
  });

  it("file: grava JSON com to, url e o texto em português, sem código", async () => {
    const dir = await mkdtemp(join(tmpdir(), "mail-"));
    dirs.push(dir);
    await createFileEmailSender(dir).sendPasswordResetLink({ to: "a@b.com", url });
    const files = await readdir(dir);
    expect(files).toHaveLength(1);
    const body = JSON.parse(await readFile(join(dir, files[0] as string), "utf8"));
    expect(body).toEqual({ to: "a@b.com", url, text: passwordResetLinkText(url) });
    expect(body).not.toHaveProperty("code");
  });

  it("o texto traz o link, os 30 minutos e a orientação de ignorar se não foi a pessoa", () => {
    const text = passwordResetLinkText(url);
    expect(text).toContain(url);
    expect(text).toContain("30 minutos");
    expect(text.toLowerCase()).toContain("ignore");
  });
});
