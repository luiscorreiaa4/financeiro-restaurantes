// Gera os PNG do PWA a partir de assets/icon.svg com o Chromium do Playwright.
// Uso: pnpm --filter @app/web exec node scripts/generate-icons.mjs
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "public", "icons");
const svg = readFileSync(path.join(root, "assets", "icon.svg"), "utf8");
// Mesmo valor de ICON_BG em lib/app-identity.ts (o script é .mjs e não importa o .ts).
const ICON_BG = "#171717";

const full = (size) => `<!doctype html><html><body style="margin:0;background:${ICON_BG}">
<div style="width:${size}px;height:${size}px;display:flex">${svg.replace(
  "<svg ",
  '<svg style="width:100%;height:100%" ',
)}</div></body></html>`;

// Maskable: o desenho ocupa 80% e fica centralizado sobre o fundo sólido.
const maskable = (size) => `<!doctype html><html><body style="margin:0;background:${ICON_BG}">
<div style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center">
<div style="width:80%;height:80%;display:flex">${svg.replace(
  "<svg ",
  '<svg style="width:100%;height:100%" ',
)}</div></div></body></html>`;

const targets = [
  { file: "icon-192.png", size: 192, html: full },
  { file: "icon-512.png", size: 512, html: full },
  { file: "icon-maskable-512.png", size: 512, html: maskable },
  { file: "apple-touch-icon.png", size: 180, html: full },
  { file: "favicon-32.png", size: 32, html: full },
];

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const t of targets) {
    await page.setViewportSize({ width: t.size, height: t.size });
    await page.setContent(t.html(t.size));
    await page.screenshot({ path: path.join(outDir, t.file) });
    console.log("gerado", t.file);
  }
} finally {
  await browser.close();
}
