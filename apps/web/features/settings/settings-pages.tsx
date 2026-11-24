"use client";

import Link from "next/link";
import type { FullMe } from "@/lib/api/me-contract";
import { PaymentMethodsScreen } from "./payment-methods/payment-methods-screen";
import { SalesChannelsScreen } from "./sales-channels/sales-channels-screen";
import { useSettingsScope } from "./shared/use-settings";

export function PaymentMethodsPage({ me }: { me: FullMe }) {
  return <PaymentMethodsScreen scope={useSettingsScope(me)} />;
}

export function SalesChannelsPage({ me }: { me: FullMe }) {
  return <SalesChannelsScreen scope={useSettingsScope(me)} />;
}

const CARDS = [
  {
    href: "/configuracoes/formas-de-pagamento",
    title: "Formas de pagamento",
    text: "Taxas da maquininha e apelidos.",
    action: "catalog:view",
  },
  {
    href: "/configuracoes/canais-de-venda",
    title: "Canais de venda",
    text: "Salão, delivery, aplicativos e comissões.",
    action: "catalog:view",
  },
  {
    href: "/configuracoes/unidades",
    title: "Unidades",
    text: "Restaurantes, canal padrão e fuso.",
    action: "catalog:view",
  },
  {
    href: "/configuracoes/primeiros-passos",
    title: "Primeiros passos",
    text: "Assistente de configuração inicial.",
    action: "catalog:manage",
  },
] as const;

/** Índice das configurações: só os cartões que a pessoa pode abrir (`allowedActions`). */
export function SettingsIndex({ me }: { me: FullMe }) {
  const allowed = me.context.allowedActions;
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Configurações</h1>
      <ul className="grid gap-3 sm:grid-cols-2">
        {CARDS.filter((card) => allowed.includes(card.action)).map((card) => (
          <li key={card.href}>
            <Link
              href={card.href}
              className="flex h-full flex-col gap-1 rounded-lg border p-4 hover:bg-muted"
            >
              <span className="font-medium">{card.title}</span>
              <span className="text-sm text-muted-foreground">{card.text}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
