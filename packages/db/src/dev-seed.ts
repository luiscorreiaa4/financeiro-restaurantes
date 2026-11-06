import { eq } from "drizzle-orm";
import {
  memberships,
  membershipUnits,
  paymentMethods,
  salesChannels,
  tenants,
  units,
  users,
} from "../schema";
import type { Database } from "./client";

export class DevSeedInProductionError extends Error {
  constructor() {
    super("O seed de desenvolvimento não roda com NODE_ENV=production");
    this.name = "DevSeedInProductionError";
  }
}

/** Telefones do seed, em E.164 canônico. O chat aceita também a forma sem o 9º dígito. */
export const DEV_PHONES = {
  owner: "+5511987650001",
  manager: "+5511987650002",
  staff: "+5511987650003",
  /** Está em dois restaurantes; o vínculo com o Demo é o mais antigo. */
  twoRestaurants: "+5511987650004",
  /** Teve o acesso ao Demo retirado. */
  deactivated: "+5511987650005",
} as const;

const DEMO = "0190a000-0000-7000-8000-000000000001";
const DEMO_2 = "0190a000-0000-7000-8000-000000000002";

const id = (n: number) => `0190a000-0000-7000-8000-${String(n).padStart(12, "0")}`;

/**
 * Dados fixos para conversar pelo `pnpm dev:chat`: dois restaurantes e usuários que exercitam
 * papéis, dois restaurantes, acesso desativado e o 9º dígito. Idempotente (ids fixos) e só para
 * desenvolvimento. Usa o papel administrativo, que não é sujeito a RLS.
 */
export async function seedDevData(db: Database, nodeEnv: string): Promise<void> {
  if (nodeEnv === "production") throw new DevSeedInProductionError();

  await db
    .insert(tenants)
    .values([
      { id: DEMO, name: "Restaurante Demo" },
      { id: DEMO_2, name: "Restaurante Demo 2" },
    ])
    .onConflictDoNothing();

  await db
    .insert(units)
    .values([
      { id: id(11), tenantId: DEMO, name: "Matriz", aliases: ["centro"], city: "Maceió", uf: "AL" },
      { id: id(13), tenantId: DEMO, name: "Praia", aliases: ["litoral"], city: "Maceió", uf: "AL" },
      { id: id(12), tenantId: DEMO_2, name: "Filial", city: "Recife", uf: "PE" },
    ])
    .onConflictDoNothing();

  await db
    .insert(users)
    .values([
      { id: id(21), name: "Dono Demo", phoneE164: DEV_PHONES.owner },
      { id: id(22), name: "Gerente Demo", phoneE164: DEV_PHONES.manager },
      { id: id(23), name: "Atendente Demo", phoneE164: DEV_PHONES.staff },
      { id: id(24), name: "Dona dos Dois", phoneE164: DEV_PHONES.twoRestaurants },
      { id: id(25), name: "Ex-funcionário", phoneE164: DEV_PHONES.deactivated },
    ])
    .onConflictDoNothing();

  // [PROVISÓRIO – P07] formas de pagamento e canais padrão, com taxas de exemplo para o chat.
  const defaults = (tenant: string, base: number) => ({
    payments: [
      { name: "Dinheiro", type: "cash", feePercentBp: 0 },
      { name: "Pix", type: "pix", feePercentBp: 0 },
      { name: "Débito", type: "debit", feePercentBp: 150 },
      { name: "Crédito", type: "credit", feePercentBp: 320, isDefaultCard: true },
      { name: "Voucher", type: "voucher", feePercentBp: 0 },
      { name: "Não informada", type: "other", feePercentBp: 0 },
    ].map((method, index) => ({ id: id(base + index), tenantId: tenant, ...method })),
    channels: [
      { name: "Salão", type: "dine_in", feePercentBp: 0 },
      { name: "Delivery próprio", type: "own_delivery", feePercentBp: 0 },
      { name: "iFood", type: "app", feePercentBp: 2300 },
      { name: "Retirada", type: "pickup", feePercentBp: 0 },
      { name: "Não informado", type: "other", feePercentBp: 0 },
    ].map((channel, index) => ({ id: id(base + 10 + index), tenantId: tenant, ...channel })),
  });
  for (const [tenant, base] of [
    [DEMO, 100],
    [DEMO_2, 200],
  ] as const) {
    const { payments, channels } = defaults(tenant, base);
    await db.insert(paymentMethods).values(payments).onConflictDoNothing();
    await db.insert(salesChannels).values(channels).onConflictDoNothing();
    // Canal padrão da receita de cada unidade: o Salão (RF04.R6).
    await db
      .update(units)
      .set({ defaultSalesChannelId: id(base + 10) })
      .where(eq(units.tenantId, tenant));
  }

  const earlier = new Date("2026-01-01T12:00:00Z");
  const later = new Date("2026-06-01T12:00:00Z");
  // Dono e "dona dos dois" têm TODAS as unidades; gerente e atendente, uma lista (RF05.R5).
  await db
    .insert(memberships)
    .values([
      {
        id: id(31),
        tenantId: DEMO,
        userId: id(21),
        role: "owner",
        allUnits: true,
        defaultUnitId: id(11),
        panelAccess: true,
        createdAt: earlier,
      },
      {
        id: id(32),
        tenantId: DEMO,
        userId: id(22),
        role: "manager",
        defaultUnitId: id(11),
        panelAccess: true,
        createdAt: earlier,
      },
      {
        id: id(33),
        tenantId: DEMO,
        userId: id(23),
        role: "staff",
        defaultUnitId: id(11),
        createdAt: earlier,
      },
      {
        id: id(34),
        tenantId: DEMO,
        userId: id(24),
        role: "owner",
        allUnits: true,
        defaultUnitId: id(11),
        panelAccess: true,
        createdAt: earlier,
      },
      {
        id: id(35),
        tenantId: DEMO_2,
        userId: id(24),
        role: "owner",
        allUnits: true,
        panelAccess: true,
        createdAt: later,
      },
      {
        id: id(36),
        tenantId: DEMO,
        userId: id(25),
        role: "staff",
        status: "deactivated",
        defaultUnitId: id(11),
        createdAt: earlier,
        deactivatedAt: later,
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(membershipUnits)
    .values([
      { id: id(41), tenantId: DEMO, membershipId: id(32), unitId: id(11) },
      { id: id(42), tenantId: DEMO, membershipId: id(32), unitId: id(13) },
      { id: id(43), tenantId: DEMO, membershipId: id(33), unitId: id(11) },
      { id: id(44), tenantId: DEMO, membershipId: id(36), unitId: id(11) },
    ])
    .onConflictDoNothing();
}
