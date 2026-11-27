import { beforeEach, describe, expect, it, vi } from "vitest";

type Mod = typeof import("./install-prompt");

// O módulo guarda o evento em variável de módulo: cada teste começa com uma cópia nova.
async function load(): Promise<Mod> {
  vi.resetModules();
  return import("./install-prompt");
}

function promptEvent(outcome: "accepted" | "dismissed" = "accepted") {
  const event = new Event("beforeinstallprompt", { cancelable: true }) as Event & {
    prompt: ReturnType<typeof vi.fn>;
    userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
  };
  event.prompt = vi.fn(async () => {});
  event.userChoice = Promise.resolve({ outcome });
  return event;
}

describe("installMode", () => {
  it.each([
    [{ standalone: true, hasPrompt: true, ios: true }, "installed"],
    [{ standalone: false, hasPrompt: true, ios: true }, "prompt"],
    [{ standalone: false, hasPrompt: false, ios: true }, "ios"],
    [{ standalone: false, hasPrompt: false, ios: false }, "manual"],
  ] as const)("%j vira %s", async (env, expected) => {
    const { installMode } = await load();
    expect(installMode(env)).toBe(expected);
  });
});

describe("isIos", () => {
  it("reconhece iPhone pelo user agent", async () => {
    const { isIos } = await load();
    expect(isIos("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", "iPhone", 5)).toBe(true);
  });

  it("reconhece iPad que se apresenta como MacIntel com toque", async () => {
    const { isIos } = await load();
    expect(isIos("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 5)).toBe(true);
  });

  it("não confunde Mac de mesa nem Android com iOS", async () => {
    const { isIos } = await load();
    expect(isIos("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "MacIntel", 0)).toBe(false);
    expect(isIos("Mozilla/5.0 (Linux; Android 14; Pixel 7)", "Linux armv81", 5)).toBe(false);
  });
});

describe("pedido de instalação", () => {
  let mod: Mod;
  beforeEach(async () => {
    mod = await load();
  });

  it("evento capturado antes do assinante continua disponível", () => {
    const stop = mod.listenForInstallPrompt(window);
    const event = promptEvent();
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);

    const seen = vi.fn();
    const unsubscribe = mod.subscribeInstall(seen);
    expect(mod.getInstallSnapshot()).toEqual({ hasPrompt: true, installed: false });
    unsubscribe();
    stop();
  });

  it("o assinante é avisado quando o evento chega", () => {
    const stop = mod.listenForInstallPrompt(window);
    const seen = vi.fn();
    const unsubscribe = mod.subscribeInstall(seen);
    window.dispatchEvent(promptEvent());
    expect(seen).toHaveBeenCalledTimes(1);
    unsubscribe();
    stop();
  });

  it("o retrato é estável entre leituras sem mudança", () => {
    expect(mod.getInstallSnapshot()).toBe(mod.getInstallSnapshot());
  });

  it("appinstalled zera o prompt", () => {
    const stop = mod.listenForInstallPrompt(window);
    window.dispatchEvent(promptEvent());
    window.dispatchEvent(new Event("appinstalled"));
    expect(mod.getInstallSnapshot()).toEqual({ hasPrompt: false, installed: true });
    stop();
  });

  it("promptInstall sem evento devolve unavailable", async () => {
    expect(await mod.promptInstall()).toBe("unavailable");
  });

  it("promptInstall abre o pedido, devolve a escolha e gasta o evento", async () => {
    const stop = mod.listenForInstallPrompt(window);
    const event = promptEvent("accepted");
    window.dispatchEvent(event);
    expect(await mod.promptInstall()).toBe("accepted");
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(mod.getInstallSnapshot().hasPrompt).toBe(false);
    expect(await mod.promptInstall()).toBe("unavailable");
    stop();
  });

  it("recusa no pedido devolve dismissed", async () => {
    const stop = mod.listenForInstallPrompt(window);
    window.dispatchEvent(promptEvent("dismissed"));
    expect(await mod.promptInstall()).toBe("dismissed");
    stop();
  });

  it("depois de parar de ouvir, o evento não é mais capturado", () => {
    const stop = mod.listenForInstallPrompt(window);
    stop();
    const event = promptEvent();
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(mod.getInstallSnapshot().hasPrompt).toBe(false);
  });
});
