import type { ReactNode } from "react";
import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata = {
  title: "Finanças para restaurantes",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className="font-sans">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
