// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(join(__dirname, "..", "public", "sw.js"), "utf8");
const ORIGIN = "https://painel.exemplo.com";

type Handler = (event: Record<string, unknown>) => void;

function setup(options: {
  fetchImpl?: (url: string, init?: unknown) => Promise<unknown>;
  existing?: string[];
  emptyCache?: boolean;
}) {
  const handlers: Record<string, Handler> = {};
  const puts: string[] = [];
  const opened: string[] = [];
  const deleted: string[] = [];
  const offlinePage = { marker: "offline" };
  const cache = {
    put: async (url: string) => {
      puts.push(url);
    },
  };
  const caches = {
    open: async (name: string) => {
      opened.push(name);
      return cache;
    },
    match: async (url: string) =>
      url === "/offline.html" && !options.emptyCache ? offlinePage : undefined,
    keys: async () => options.existing ?? [],
    delete: async (name: string) => {
      deleted.push(name);
      return true;
    },
  };
  const state = { skipWaiting: 0, claim: 0 };
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, handler: Handler) => {
      handlers[type] = handler;
    },
    skipWaiting: async () => {
      state.skipWaiting += 1;
    },
    clients: {
      claim: async () => {
        state.claim += 1;
      },
    },
  };
  const fetchFn = options.fetchImpl ?? (async () => ({ ok: true, redirected: false }));
  vm.runInNewContext(SOURCE, { self, caches, fetch: fetchFn, URL, Promise, Response, console });
  return { handlers, puts, opened, deleted, offlinePage, state };
}

function fetchEvent(url: string, init: { mode?: string; method?: string } = {}) {
  const calls: Promise<unknown>[] = [];
  const event = {
    request: { url, mode: init.mode ?? "navigate", method: init.method ?? "GET" },
    respondWith: (p: Promise<unknown>) => {
      calls.push(p);
    },
  };
  return { event, calls };
}

async function lifecycle(handler: Handler): Promise<void> {
  let pending: Promise<unknown> = Promise.resolve();
  handler({
    waitUntil: (p: Promise<unknown>) => {
      pending = p;
    },
  });
  await pending;
}

const offline = () => Promise.reject(new TypeError("offline"));

describe("service worker", () => {
  it("navegação GET da mesma origem sem rede devolve a tela de aviso", async () => {
    const { handlers, offlinePage } = setup({ fetchImpl: offline });
    const { event, calls } = fetchEvent(`${ORIGIN}/lancamentos`);
    handlers.fetch?.(event);
    expect(calls).toHaveLength(1);
    expect(await calls[0]).toBe(offlinePage);
  });

  it("sem rede e sem a tela de aviso no cache, devolve erro de rede e não undefined", async () => {
    const { handlers } = setup({ fetchImpl: offline, emptyCache: true });
    const { event, calls } = fetchEvent(`${ORIGIN}/lancamentos`);
    handlers.fetch?.(event);
    const response = (await calls[0]) as Response;
    expect(response).toBeInstanceOf(Response);
    expect(response.type).toBe("error");
  });

  it("com rede, devolve a resposta da rede sem mexer nela", async () => {
    const net = { ok: true, marker: "net" };
    const { handlers } = setup({ fetchImpl: async () => net });
    const { event, calls } = fetchEvent(`${ORIGIN}/lancamentos`);
    handlers.fetch?.(event);
    expect(await calls[0]).toBe(net);
  });

  it("/api/ não passa pelo service worker, mesmo em navegação", () => {
    const { handlers } = setup({ fetchImpl: offline });
    for (const path of ["/api/exports/x", "/api/me"]) {
      const { event, calls } = fetchEvent(`${ORIGIN}${path}`);
      handlers.fetch?.(event);
      expect(calls, path).toHaveLength(0);
    }
  });

  it("requisição que não é navegação não passa pelo service worker", () => {
    const { handlers } = setup({ fetchImpl: offline });
    const { event, calls } = fetchEvent(`${ORIGIN}/lancamentos`, { mode: "cors" });
    handlers.fetch?.(event);
    expect(calls).toHaveLength(0);
  });

  it("POST de navegação não passa pelo service worker", () => {
    const { handlers } = setup({ fetchImpl: offline });
    const { event, calls } = fetchEvent(`${ORIGIN}/lancamentos`, { method: "POST" });
    handlers.fetch?.(event);
    expect(calls).toHaveLength(0);
  });

  it("outra origem não passa pelo service worker", () => {
    const { handlers } = setup({ fetchImpl: offline });
    const { event, calls } = fetchEvent("https://outro.com/lancamentos");
    handlers.fetch?.(event);
    expect(calls).toHaveLength(0);
  });

  it("install com resposta redirecionada rejeita e não grava nada", async () => {
    const { handlers, puts } = setup({
      fetchImpl: async () => ({ ok: true, redirected: true }),
    });
    await expect(lifecycle(handlers.install as Handler)).rejects.toBeDefined();
    expect(puts).toEqual([]);
  });

  it("install com resposta não ok rejeita", async () => {
    const { handlers, puts } = setup({ fetchImpl: async () => ({ ok: false, redirected: false }) });
    await expect(lifecycle(handlers.install as Handler)).rejects.toBeDefined();
    expect(puts).toEqual([]);
  });

  it("install busca na rede ignorando o cache HTTP (tela de aviso nunca fica velha)", async () => {
    const inits: unknown[] = [];
    const { handlers } = setup({
      fetchImpl: async (_url, init) => {
        inits.push(init);
        return { ok: true, redirected: false };
      },
    });
    await lifecycle(handlers.install as Handler);
    expect(inits).toEqual([{ cache: "reload" }, { cache: "reload" }]);
  });

  it("install ok grava só as duas URLs fixas e assume o controle", async () => {
    const { handlers, puts, opened, state } = setup({});
    await lifecycle(handlers.install as Handler);
    expect(puts.sort()).toEqual(["/icons/icon-192.png", "/offline.html"]);
    expect(opened).toEqual(["fr-offline-1"]);
    expect(state.skipWaiting).toBe(1);
  });

  it("nenhum cache.put acontece durante o fetch", async () => {
    const { handlers, puts } = setup({});
    const { event, calls } = fetchEvent(`${ORIGIN}/lancamentos`);
    handlers.fetch?.(event);
    await calls[0];
    expect(puts).toEqual([]);
  });

  it("activate apaga fr-offline-* antigos, mantém o atual e outros caches", async () => {
    const { handlers, deleted, state } = setup({
      existing: ["fr-offline-0", "fr-offline-1", "outro-cache"],
    });
    await lifecycle(handlers.activate as Handler);
    expect(deleted).toEqual(["fr-offline-0"]);
    expect(state.claim).toBe(1);
  });
});
