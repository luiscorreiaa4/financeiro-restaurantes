"use client";

import { useSyncExternalStore } from "react";
import {
  getInstallSnapshot,
  getStandalone,
  type InstallMode,
  installMode,
  isIos,
  subscribeInstall,
  subscribeStandalone,
} from "./install-prompt";

const SERVER_SNAPSHOT = { hasPrompt: false, installed: false };
const noop = () => () => {};

/** Modo de instalação do aparelho. No servidor, "manual" (o item só some no cliente, se instalado). */
export function useInstallMode(): InstallMode {
  const { hasPrompt, installed } = useSyncExternalStore(
    subscribeInstall,
    getInstallSnapshot,
    () => SERVER_SNAPSHOT,
  );
  const standalone = useSyncExternalStore(subscribeStandalone, getStandalone, () => false);
  const ios = useSyncExternalStore(
    noop,
    () => isIos(navigator.userAgent, navigator.platform, navigator.maxTouchPoints),
    () => false,
  );
  return installMode({ standalone: standalone || installed, hasPrompt, ios });
}
