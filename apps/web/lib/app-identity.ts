// Identidade provisória do app (D-F8, pendência F0-1): nome, cores e ícones do PWA.
// Para trocar a identidade, edite este arquivo e `assets/icon.svg` e rode
// `pnpm --filter @app/web exec node scripts/generate-icons.mjs`.
// `public/offline.html` é estático e repete o nome e as cores; mantenha em sincronia.

export const APP_NAME = "Finanças para restaurantes";
export const APP_SHORT_NAME = "Finanças";
export const THEME_COLOR = "#ffffff";
export const BACKGROUND_COLOR = "#ffffff";
export const ICON_BG = "#171717";
export const ICON_FG = "#ffffff";

export const ICONS: readonly {
  src: string;
  sizes: string;
  type: "image/png";
  purpose: "any" | "maskable";
}[] = [
  { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  {
    src: "/icons/icon-maskable-512.png",
    sizes: "512x512",
    type: "image/png",
    purpose: "maskable",
  },
];
