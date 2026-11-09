"use client";

import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";
import { buttonVariants } from "@/components/ui/button";
import { TOUCH } from "./form-fields";

/** Link direto para a conversa: `https://wa.me/<só dígitos, com DDI>`. */
export function buildWhatsappLink(number: string): string {
  return `https://wa.me/${number.replace(/\D/g, "")}`;
}

type Props = {
  /** Número do WhatsApp do produto (`NEXT_PUBLIC_WHATSAPP_NUMBER`, já validado). */
  whatsappNumber: string | undefined;
};

/**
 * Tela final do cadastro e de "Criar outra empresa" (RF01.Obs3): número do WhatsApp do produto,
 * link direto e QR Code gerado no navegador (sem serviço externo).
 */
export function Welcome({ whatsappNumber }: Props) {
  const link = whatsappNumber ? buildWhatsappLink(whatsappNumber) : null;
  return (
    <section className="flex w-full max-w-md flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Tudo pronto!</h1>
        <p className="text-muted-foreground">
          Mande a primeira mensagem para o nosso WhatsApp. É por ele que você vai lançar receitas e
          despesas, por texto, áudio ou foto da nota.
        </p>
      </div>

      {link && whatsappNumber ? (
        <div className="flex flex-col items-center gap-4 rounded-lg border p-4">
          <p className="text-lg font-medium">{whatsappNumber}</p>
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ className: `${TOUCH} w-full` })}
          >
            Abrir o WhatsApp
          </a>
          <figure className="flex flex-col items-center gap-2">
            {/* O próprio QR traz o fundo branco e a margem (precisa de contraste para a câmera ler). */}
            <div role="img" aria-label="QR Code para abrir o WhatsApp">
              <QRCodeSVG value={link} size={200} marginSize={4} aria-hidden="true" />
            </div>
            <figcaption className="text-sm text-muted-foreground">
              No computador, aponte a câmera do celular para o código.
            </figcaption>
          </figure>
        </div>
      ) : (
        <p className="rounded-lg border p-4 text-sm">
          O número do WhatsApp ainda não foi configurado. Fale com o suporte para receber o número e
          mandar a primeira mensagem.
        </p>
      )}

      <Link
        href="/"
        className={buttonVariants({ variant: "outline", className: `${TOUCH} w-full` })}
      >
        Ir para o painel
      </Link>
    </section>
  );
}
