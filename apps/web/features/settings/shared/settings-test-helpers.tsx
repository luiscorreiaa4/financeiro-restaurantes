import type {
  PaymentMethodSettings,
  SalesChannelSettings,
  UnitSettings,
} from "@app/core/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import type { SettingsApi } from "./settings-api";
import type { SettingsScope } from "./use-settings";

export const TENANT = "0193a1b2-0000-7000-8000-0000000000aa";

export function uuid(n: number): string {
  return `0193a1b2-0000-7000-8000-${String(n).padStart(12, "0")}`;
}

export function paymentFixture(
  overrides: Partial<PaymentMethodSettings> = {},
): PaymentMethodSettings {
  return {
    id: uuid(1),
    name: "Crédito",
    type: "credit",
    feePercentBp: 320,
    feeFixedCents: 0,
    aliases: [],
    status: "active",
    isDefaultCard: false,
    protected: false,
    ...overrides,
  };
}

export function channelFixture(
  overrides: Partial<SalesChannelSettings> = {},
): SalesChannelSettings {
  return {
    id: uuid(2),
    name: "iFood",
    type: "app",
    feePercentBp: 2300,
    aliases: [],
    status: "active",
    protected: false,
    ...overrides,
  };
}

export function unitFixture(overrides: Partial<UnitSettings> = {}): UnitSettings {
  return {
    id: uuid(3),
    name: "Centro",
    aliases: [],
    cnpj: null,
    uf: "SP",
    city: "São Paulo",
    timezone: "America/Sao_Paulo",
    status: "active",
    defaultSalesChannelId: null,
    onlyUnitMemberCount: 0,
    ...overrides,
  };
}

const reject = () => Promise.reject(new Error("rota não preparada neste teste"));

/** API de configurações para teste: o que não for informado responde vazio ou recusa. */
export function fakeSettingsApi(overrides: Partial<SettingsApi> = {}): SettingsApi {
  return {
    listPaymentMethods: () => Promise.resolve([]),
    createPaymentMethod: reject,
    updatePaymentMethod: reject,
    listSalesChannels: () => Promise.resolve([]),
    createSalesChannel: reject,
    updateSalesChannel: reject,
    feePreview: reject,
    listUnits: () => Promise.resolve([]),
    createUnit: reject,
    updateUnit: reject,
    deactivateUnit: reject,
    reactivateUnit: reject,
    previewReapplication: reject,
    reapply: reject,
    latestReapplication: () => Promise.resolve(null),
    ...overrides,
  };
}

export function scopeOf(api: SettingsApi, canManage = true): SettingsScope {
  return { ctx: { tenantId: TENANT, unitId: "all" }, api, canManage };
}

export function renderWithQuery(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrap = (node: ReactNode) => (
    <QueryClientProvider client={client}>{node}</QueryClientProvider>
  );
  const result = render(wrap(ui));
  return { ...result, client, rerender: (next: ReactNode) => result.rerender(wrap(next)) };
}
