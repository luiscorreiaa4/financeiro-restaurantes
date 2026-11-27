// Instalação do PWA (F7, DD-44, RNF10.R2). O `beforeinstallprompt` pode disparar ainda no
// `/login`, antes de a casca montar: por isso o evento mora numa variável de módulo, capturada na
// raiz (`providers.tsx`), e quem precisa dele lê o retrato depois.

export type InstallMode = "installed" | "prompt" | "ios" | "manual";
export type InstallOutcome = "accepted" | "dismissed" | "unavailable";
export type InstallSnapshot = { hasPrompt: boolean; installed: boolean };

// O evento não está no `lib.dom`; só o que usamos.
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/** Ordem de prioridade: já instalado, pedido do navegador, passos do iPhone, instrução manual. */
export function installMode(env: {
  standalone: boolean;
  hasPrompt: boolean;
  ios: boolean;
}): InstallMode {
  if (env.standalone) return "installed";
  if (env.hasPrompt) return "prompt";
  if (env.ios) return "ios";
  return "manual";
}

/** iPhone, iPad e iPod; o iPad novo se apresenta como `MacIntel` com várias entradas de toque. */
export function isIos(ua: string, platform: string, maxTouchPoints: number): boolean {
  return /iPhone|iPad|iPod/.test(ua) || (platform === "MacIntel" && maxTouchPoints > 1);
}

let deferred: BeforeInstallPromptEvent | null = null;
let snapshot: InstallSnapshot = { hasPrompt: false, installed: false };
const listeners = new Set<() => void>();

function publish(next: InstallSnapshot): void {
  if (next.hasPrompt === snapshot.hasPrompt && next.installed === snapshot.installed) return;
  snapshot = next;
  for (const listener of listeners) listener();
}

export function listenForInstallPrompt(target: Window): () => void {
  const onPrompt = (event: Event) => {
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    publish({ ...snapshot, hasPrompt: true });
  };
  const onInstalled = () => {
    deferred = null;
    publish({ hasPrompt: false, installed: true });
  };
  target.addEventListener("beforeinstallprompt", onPrompt);
  target.addEventListener("appinstalled", onInstalled);
  return () => {
    target.removeEventListener("beforeinstallprompt", onPrompt);
    target.removeEventListener("appinstalled", onInstalled);
  };
}

export function subscribeInstall(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function getInstallSnapshot(): InstallSnapshot {
  return snapshot;
}

/** Abre o pedido do navegador. O evento só vale uma vez: depois de usado, some. */
export async function promptInstall(): Promise<InstallOutcome> {
  const event = deferred;
  if (!event) return "unavailable";
  deferred = null;
  publish({ ...snapshot, hasPrompt: false });
  await event.prompt();
  const { outcome } = await event.userChoice;
  return outcome;
}

/** Tela cheia (instalado): `display-mode: standalone` ou `navigator.standalone` do Safari. */
export function getStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const media =
    typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)");
  const safari = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return (media ? media.matches : false) || safari;
}

export function subscribeStandalone(cb: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia("(display-mode: standalone)");
  media.addEventListener("change", cb);
  return () => media.removeEventListener("change", cb);
}
