import type { MetadataRoute } from "next";
import { APP_NAME, APP_SHORT_NAME, BACKGROUND_COLOR, ICONS, THEME_COLOR } from "@/lib/app-identity";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_SHORT_NAME,
    description: "Controle financeiro gerencial para restaurantes, pelo WhatsApp e pelo painel.",
    lang: "pt-BR",
    start_url: "/",
    scope: "/",
    id: "/",
    display: "standalone",
    background_color: BACKGROUND_COLOR,
    theme_color: THEME_COLOR,
    icons: ICONS.map((icon) => ({ ...icon })),
  };
}
