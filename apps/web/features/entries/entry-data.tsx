import type { EntryDetail } from "@app/core/contracts";
import type { ReactNode } from "react";
import { formatBusinessDate, formatCents } from "@/lib/format";
import { CHANNEL_LABELS, formatInstant, formatQuantity, TYPE_LABELS } from "./field-labels";
import { FlagBadges } from "./flag-badges";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-sm">{children}</dd>
    </div>
  );
}

/** Aba Dados, só leitura no F3a. Todo valor é o que a API devolveu; nada é calculado aqui. */
export function EntryData({ entry }: { entry: EntryDetail }) {
  const quantity = formatQuantity(entry.quantity, entry.quantityUnit);
  return (
    <div className="flex flex-col gap-3">
      {entry.deleted && (
        <p className="rounded-md border p-2 text-sm">
          Na lixeira desde {formatInstant(entry.deleted.at)}. Restaurável até{" "}
          {formatBusinessDate(entry.deleted.restorableUntil)}.
        </p>
      )}
      <FlagBadges flags={entry.flags} />
      <dl className="grid grid-cols-2 gap-3">
        <Row label="Tipo">{TYPE_LABELS[entry.type]}</Row>
        <Row label="Data">{formatBusinessDate(entry.occurredOn)}</Row>
        <Row label="Data de pagamento">{formatBusinessDate(entry.paidOn)}</Row>
        <Row label="Valor bruto">{formatCents(entry.amountCents)}</Row>
        {entry.type === "revenue" && (
          <>
            <Row label="Taxa">{formatCents(entry.feeCents)}</Row>
            <Row label="Valor líquido">{formatCents(entry.netCents)}</Row>
          </>
        )}
        <Row label="Categoria">{entry.category?.name ?? "—"}</Row>
        <Row label="Fornecedor">{entry.supplier?.name ?? "—"}</Row>
        <Row label="Forma de pagamento">{entry.paymentMethod?.name ?? "—"}</Row>
        {entry.type === "revenue" && (
          <>
            <Row label="Canal de venda">{entry.salesChannel?.name ?? "—"}</Row>
            <Row label="Pedidos">{entry.orders ?? "—"}</Row>
          </>
        )}
        {quantity !== "" && <Row label="Quantidade">{quantity}</Row>}
        <Row label="Unidade">{entry.unit.name}</Row>
        <Row label="Lançado por">{entry.createdBy.name}</Row>
        <Row label="Canal de origem">{CHANNEL_LABELS[entry.originChannel]}</Row>
        <Row label="Criado em">{formatInstant(entry.createdAt)}</Row>
      </dl>
    </div>
  );
}
