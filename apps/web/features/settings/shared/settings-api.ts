import {
  type FeePreview,
  type FeeReapplication,
  type FeeReapplicationPreview,
  type FeeReapplicationPreviewInput,
  feePreviewSchema,
  feeReapplicationPreviewSchema,
  feeReapplicationSchema,
  type PaymentMethodInput,
  type PaymentMethodPatch,
  type PaymentMethodSettings,
  paymentMethodSettingsSchema,
  type SalesChannelPatch,
  type SalesChannelSettings,
  type SalesChannelSettingsInput,
  salesChannelSettingsSchema,
  type UnitPatch,
  type UnitSettings,
  type UnitSettingsInput,
  unitSettingsSchema,
} from "@app/core/contracts";
import { z } from "zod";
import type { ApiClient } from "@/lib/api/client";

const paymentListSchema = z.object({ items: z.array(paymentMethodSettingsSchema) });
const channelListSchema = z.object({ items: z.array(salesChannelSettingsSchema) });
const unitListSchema = z.object({ items: z.array(unitSettingsSchema) });
const latestReapplicationSchema = z.object({ item: feeReapplicationSchema.nullable() });

export type CatalogFilters = { type?: string; status?: string };

function query(filters: CatalogFilters): string {
  const params = new URLSearchParams();
  if (filters.type) params.set("type", filters.type);
  if (filters.status) params.set("status", filters.status);
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

export type SettingsApi = {
  listPaymentMethods(filters?: CatalogFilters): Promise<PaymentMethodSettings[]>;
  createPaymentMethod(body: PaymentMethodInput): Promise<PaymentMethodSettings>;
  updatePaymentMethod(id: string, body: PaymentMethodPatch): Promise<PaymentMethodSettings>;
  listSalesChannels(filters?: CatalogFilters): Promise<SalesChannelSettings[]>;
  createSalesChannel(body: SalesChannelSettingsInput): Promise<SalesChannelSettings>;
  updateSalesChannel(id: string, body: SalesChannelPatch): Promise<SalesChannelSettings>;
  /** Líquido de uma venda de R$ 100,00: a conta é do servidor (`computeFee`), a tela só mostra. */
  feePreview(feePercentBp: number, feeFixedCents: number): Promise<FeePreview>;
  listUnits(): Promise<UnitSettings[]>;
  createUnit(body: UnitSettingsInput): Promise<UnitSettings>;
  updateUnit(id: string, body: UnitPatch): Promise<UnitSettings>;
  deactivateUnit(id: string): Promise<UnitSettings>;
  reactivateUnit(id: string): Promise<UnitSettings>;
  previewReapplication(body: FeeReapplicationPreviewInput): Promise<FeeReapplicationPreview>;
  reapply(
    body: FeeReapplicationPreviewInput & { clientRequestId: string },
  ): Promise<FeeReapplication>;
  latestReapplication(targetKind: string, targetId: string): Promise<FeeReapplication | null>;
};

/** Configurações (`/api/settings/*`). Toda resposta é validada contra o contrato (`@app/core`). */
export function settingsApi(client: ApiClient): SettingsApi {
  const id = encodeURIComponent;
  return {
    listPaymentMethods: async (filters = {}) =>
      (await client.get(`/api/settings/payment-methods${query(filters)}`, paymentListSchema)).items,
    createPaymentMethod: (body) =>
      client.post("/api/settings/payment-methods", body, paymentMethodSettingsSchema),
    updatePaymentMethod: (pid, body) =>
      client.patch(`/api/settings/payment-methods/${id(pid)}`, body, paymentMethodSettingsSchema),
    listSalesChannels: async (filters = {}) =>
      (await client.get(`/api/settings/sales-channels${query(filters)}`, channelListSchema)).items,
    createSalesChannel: (body) =>
      client.post("/api/settings/sales-channels", body, salesChannelSettingsSchema),
    updateSalesChannel: (cid, body) =>
      client.patch(`/api/settings/sales-channels/${id(cid)}`, body, salesChannelSettingsSchema),
    feePreview: (feePercentBp, feeFixedCents) =>
      client.get(
        `/api/settings/fee-preview?feePercentBp=${feePercentBp}&feeFixedCents=${feeFixedCents}`,
        feePreviewSchema,
      ),
    listUnits: async () => (await client.get("/api/settings/units", unitListSchema)).items,
    createUnit: (body) => client.post("/api/settings/units", body, unitSettingsSchema),
    updateUnit: (uid, body) =>
      client.patch(`/api/settings/units/${id(uid)}`, body, unitSettingsSchema),
    deactivateUnit: (uid) =>
      client.post(`/api/settings/units/${id(uid)}/deactivate`, {}, unitSettingsSchema),
    reactivateUnit: (uid) =>
      client.post(`/api/settings/units/${id(uid)}/reactivate`, {}, unitSettingsSchema),
    previewReapplication: (body) =>
      client.post("/api/settings/fee-reapplications/preview", body, feeReapplicationPreviewSchema),
    reapply: (body) =>
      client.post("/api/settings/fee-reapplications", body, feeReapplicationSchema),
    latestReapplication: async (targetKind, targetId) =>
      (
        await client.get(
          `/api/settings/fee-reapplications?targetKind=${targetKind}&targetId=${id(targetId)}`,
          latestReapplicationSchema,
        )
      ).item,
  };
}
