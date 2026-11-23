import type { EntryFilters, EntryListQuery } from "@app/core/contracts";

/**
 * Filtros da exportação (RF29.R2): os da lista, sem `sort`, `dir`, `cursor` nem `limit`. O contrato
 * da exportação é estrito, então um campo de ordenação no corpo é recusado pela API.
 */
export function toExportFilters(query: EntryListQuery): EntryFilters {
  const filters: EntryFilters = { from: query.from, to: query.to };
  if (query.type !== undefined) filters.type = query.type;
  if (query.unitIds !== undefined) filters.unitIds = query.unitIds;
  if (query.categoryIds !== undefined) filters.categoryIds = query.categoryIds;
  if (query.supplierId !== undefined) filters.supplierId = query.supplierId;
  if (query.paymentMethodId !== undefined) filters.paymentMethodId = query.paymentMethodId;
  if (query.salesChannelId !== undefined) filters.salesChannelId = query.salesChannelId;
  if (query.createdBy !== undefined) filters.createdBy = query.createdBy;
  if (query.originChannel !== undefined) filters.originChannel = query.originChannel;
  if (query.flags !== undefined) filters.flags = query.flags;
  if (query.q !== undefined) filters.q = query.q;
  return filters;
}

/** Quantos filtros, além do período, estão aplicados (um por campo preenchido). */
export function countAppliedFilters(filters: EntryFilters): number {
  const { from: _from, to: _to, ...rest } = filters;
  return Object.values(rest).filter((value) => value !== undefined).length;
}
