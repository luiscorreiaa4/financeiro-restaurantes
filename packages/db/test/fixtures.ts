import type pg from "pg";
import { uuidv7 } from "../src/uuid";

export interface TenantFixture {
  tenantId: string;
  unitId: string;
  userId: string;
  phone: string;
  categoryId: string;
  supplierId: string;
  paymentMethodId: string;
  salesChannelId: string;
  inboundMessageId: string;
  waMessageId: string;
  entryId: string;
  /** Chave de acesso de 44 dígitos da nota fiscal do fixture (única por tenant). */
  accessKey: string;
}

/** Todas as tabelas do schema public, em ordem alfabética. Tabela nova entra aqui e em `insertsFor`. */
export const TABLES = [
  "accounts",
  "ai_usage",
  "audit_log",
  "auth_audit",
  "categories",
  "entries",
  "entry_versions",
  "fiscal_documents",
  "inbound_messages",
  "membership_units",
  "memberships",
  "outbound_messages",
  "payment_methods",
  "pending_questions",
  "sales_channels",
  "sessions",
  "signup_verifications",
  "suppliers",
  "tax_rules",
  "tax_settings",
  "tenants",
  "units",
  "users",
  "verifications",
  "whatsapp_opt_ins",
  "whatsapp_status_events",
] as const;

/**
 * Tabelas sem `tenant_id`, lidas por todos e gravadas só pelo administrador (migrations e seed).
 * O meta-teste de isolamento não as trata por tenant: tem um teste próprio de somente leitura.
 */
export const GLOBAL_TABLES = ["tax_rules"] as const;

/**
 * Tabelas de autenticação (Better Auth): sem `tenant_id`, só o papel `app_auth` acessa. O
 * meta-teste de isolamento não as trata por tenant; `auth-migration.int.test.ts` as cobre.
 */
export const AUTH_TABLES = [
  "sessions",
  "accounts",
  "verifications",
  "auth_audit",
  "signup_verifications",
] as const;

let phoneCounter = 0;

/** Cria um tenant completo, com uma linha em cada tabela, usando o papel admin. */
export async function createTenant(admin: pg.Pool, name = "Restaurante"): Promise<TenantFixture> {
  const f: TenantFixture = {
    tenantId: uuidv7(),
    unitId: uuidv7(),
    userId: uuidv7(),
    phone: `+5511${String(900000000 + ++phoneCounter + Math.floor(Math.random() * 1e6))}`,
    categoryId: uuidv7(),
    supplierId: uuidv7(),
    paymentMethodId: uuidv7(),
    salesChannelId: uuidv7(),
    inboundMessageId: uuidv7(),
    waMessageId: `wamid.${uuidv7()}`,
    entryId: uuidv7(),
    accessKey: String(Math.floor(Math.random() * 1e15)).padStart(44, "1"),
  };
  const run = (sql: string, params: unknown[]) => admin.query(sql, params);

  await run("insert into tenants (id, name) values ($1, $2)", [f.tenantId, name]);
  await run("insert into units (id, tenant_id, name) values ($1, $2, 'Matriz')", [
    f.unitId,
    f.tenantId,
  ]);
  await run("insert into users (id, name, phone_e164) values ($1, 'Dono', $2)", [
    f.userId,
    f.phone,
  ]);
  await run(
    "insert into memberships (id, tenant_id, user_id, role, all_units) values ($1, $2, $3, 'owner', true)",
    [uuidv7(), f.tenantId, f.userId],
  );
  // Um gerente com lista de unidades de acesso (`membership_units`).
  const managerId = uuidv7();
  const managerMembershipId = uuidv7();
  await run("insert into users (id, name, phone_e164) values ($1, 'Gerente', $2)", [
    managerId,
    `+5521${String(900000000 + phoneCounter + Math.floor(Math.random() * 1e6))}`,
  ]);
  await run(
    `insert into memberships (id, tenant_id, user_id, role, default_unit_id)
     values ($1, $2, $3, 'manager', $4)`,
    [managerMembershipId, f.tenantId, managerId, f.unitId],
  );
  await run(
    "insert into membership_units (id, tenant_id, membership_id, unit_id) values ($1, $2, $3, $4)",
    [uuidv7(), f.tenantId, managerMembershipId, f.unitId],
  );
  await run(
    `insert into categories (id, tenant_id, name, kind, dre_group)
     values ($1, $2, 'Categoria própria', 'expense', 'outras')`,
    [f.categoryId, f.tenantId],
  );
  await run("insert into suppliers (id, tenant_id, name) values ($1, $2, 'Fornecedor')", [
    f.supplierId,
    f.tenantId,
  ]);
  await run("insert into payment_methods (id, tenant_id, name) values ($1, $2, 'Pix')", [
    f.paymentMethodId,
    f.tenantId,
  ]);
  await run("insert into sales_channels (id, tenant_id, name) values ($1, $2, 'Salão')", [
    f.salesChannelId,
    f.tenantId,
  ]);
  await run(
    `insert into inbound_messages (id, tenant_id, user_id, wa_message_id, type, text, raw, status)
     values ($1, $2, $3, $4, 'text', 'gastei 100 no mercado', '{}', 'processed')`,
    [f.inboundMessageId, f.tenantId, f.userId, f.waMessageId],
  );
  await run(
    `insert into entries (id, tenant_id, unit_id, type, occurred_on, paid_on, description, amount_cents,
       net_cents, category_id, inbound_message_id, created_by)
     values ($1, $2, $3, 'expense', '2026-10-27', '2026-10-27', 'Mercado', 10000, 10000, $4, $5, $6)`,
    [f.entryId, f.tenantId, f.unitId, f.categoryId, f.inboundMessageId, f.userId],
  );
  await run(
    `insert into entry_versions (id, tenant_id, entry_id, version, action, after, changed_by, channel)
     values ($1, $2, $3, 1, 'create', '{}', $4, 'whatsapp')`,
    [uuidv7(), f.tenantId, f.entryId, f.userId],
  );
  await run(
    `insert into fiscal_documents (id, tenant_id, access_key, inbound_message_id, source, created_by)
     values ($1, $2, $3, $4, 'ai_reading', $5)`,
    [uuidv7(), f.tenantId, f.accessKey, f.inboundMessageId, f.userId],
  );
  await run(
    `insert into pending_questions (id, tenant_id, user_id, inbound_message_id, draft, question, expires_at)
     values ($1, $2, $3, $4, '{}', 'Qual foi o valor?', now() + interval '1 day')`,
    [uuidv7(), f.tenantId, f.userId, f.inboundMessageId],
  );
  await run(
    `insert into ai_usage (id, tenant_id, inbound_message_id, provider, model)
     values ($1, $2, $3, 'anthropic', 'claude-haiku-5-5')`,
    [uuidv7(), f.tenantId, f.inboundMessageId],
  );
  await run(
    "insert into audit_log (id, tenant_id, actor_id, action) values ($1, $2, $3, 'teste')",
    [uuidv7(), f.tenantId, f.userId],
  );
  await run(
    `insert into whatsapp_status_events (id, tenant_id, wa_message_id, status, raw)
     values ($1, $2, $3, 'delivered', '{}')`,
    [uuidv7(), f.tenantId, `wamid.out.${uuidv7()}`],
  );
  await run(
    `insert into outbound_messages (id, tenant_id, inbound_message_id, wa_message_id, to_wa_id, purpose, text)
     values ($1, $2, $3, $4, $5, 'confirmation', 'Registrado')`,
    [uuidv7(), f.tenantId, f.inboundMessageId, `dev.out.${uuidv7()}`, f.phone.replace("+", "")],
  );
  await run(
    `insert into whatsapp_opt_ins (id, tenant_id, user_id, source, inbound_message_id)
     values ($1, $2, $3, 'first_message', $4)`,
    [uuidv7(), f.tenantId, f.userId, f.inboundMessageId],
  );
  await run(
    `insert into tax_settings (id, tenant_id, valid_from, enabled, regime, params, created_by)
     values ($1, $2, '2026-01-01', true, 'simples_nacional', '{"rbt12Cents": 24000000}', $3)`,
    [uuidv7(), f.tenantId, f.userId],
  );
  await run(
    `insert into sessions (id, user_id, token, expires_at)
     values ($1, $2, $3, now() + interval '1 day')`,
    [uuidv7(), f.userId, `token.${uuidv7()}`],
  );
  await run(
    `insert into accounts (id, account_id, provider_id, user_id, password)
     values ($1, $2::text, 'credential', $2::uuid, 'salt:hash')`,
    [uuidv7(), f.userId],
  );
  await run(
    "insert into verifications (id, identifier, value, expires_at) values ($1, $2, 'hash', now() + interval '5 minutes')",
    [uuidv7(), `otp-${uuidv7()}`],
  );
  await run(
    "insert into auth_audit (id, user_id, email_hash, event) values ($1, $2, 'h', 'login')",
    [uuidv7(), f.userId],
  );
  await run(
    `insert into signup_verifications (id, email, kind, code_hash, ip, expires_at)
     values ($1, $2, 'code', 'hash', '127.0.0.1', now() + interval '10 minutes')`,
    [uuidv7(), `cadastro.${uuidv7()}@exemplo.com`],
  );
  // Regra de EXEMPLO (global): os valores reais dependem de P16 e P17 [PROVISÓRIO].
  await run(
    `insert into tax_rules (id, regime, valid_from, components)
     values ($1, 'mei', '2020-01-01', '[{"label":"DAS-MEI","formula":{"kind":"fixed_monthly","amountCents":7190}}]')
     on conflict (regime, valid_from) do nothing`,
    [uuidv7()],
  );
  return f;
}

/**
 * Um INSERT válido por tabela, para o tenant `f`, que deve ser recusado quando feito por
 * outro tenant. Toda tabela nova precisa de uma entrada aqui (o teste de isolamento exige).
 */
export function insertsFor(f: TenantFixture): Record<string, { sql: string; params: unknown[] }> {
  const id = () => uuidv7();
  return {
    tenants: { sql: "insert into tenants (id, name) values ($1, 'X')", params: [id()] },
    units: {
      sql: "insert into units (id, tenant_id, name) values ($1, $2, 'Filial')",
      params: [id(), f.tenantId],
    },
    users: {
      sql: "insert into users (id, name, phone_e164) values ($1, 'Intruso', '+5511999990000')",
      params: [id()],
    },
    memberships: {
      sql: "insert into memberships (id, tenant_id, user_id, role) values ($1, $2, $3, 'staff')",
      params: [id(), f.tenantId, f.userId],
    },
    membership_units: {
      sql: `insert into membership_units (id, tenant_id, membership_id, unit_id)
            values ($1, $2, (select id from memberships where tenant_id = $2 limit 1), $3)`,
      params: [id(), f.tenantId, f.unitId],
    },
    categories: {
      sql: "insert into categories (id, tenant_id, name, kind, dre_group) values ($1, $2, 'Intrusa', 'expense', 'outras')",
      params: [id(), f.tenantId],
    },
    suppliers: {
      sql: "insert into suppliers (id, tenant_id, name) values ($1, $2, 'Intruso')",
      params: [id(), f.tenantId],
    },
    payment_methods: {
      sql: "insert into payment_methods (id, tenant_id, name) values ($1, $2, 'Intruso')",
      params: [id(), f.tenantId],
    },
    sales_channels: {
      sql: "insert into sales_channels (id, tenant_id, name) values ($1, $2, 'Intruso')",
      params: [id(), f.tenantId],
    },
    inbound_messages: {
      sql: "insert into inbound_messages (id, tenant_id, wa_message_id, type, raw) values ($1, $2, $3, 'text', '{}')",
      params: [id(), f.tenantId, `wamid.${id()}`],
    },
    entries: {
      sql: `insert into entries (id, tenant_id, unit_id, type, occurred_on, paid_on, description, amount_cents, net_cents, created_by)
            values ($1, $2, $3, 'expense', '2026-10-27', '2026-10-27', 'Intruso', 100, 100, $4)`,
      params: [id(), f.tenantId, f.unitId, f.userId],
    },
    entry_versions: {
      sql: `insert into entry_versions (id, tenant_id, entry_id, version, action, after, changed_by, channel)
            values ($1, $2, $3, 99, 'update', '{}', $4, 'web')`,
      params: [id(), f.tenantId, f.entryId, f.userId],
    },
    pending_questions: {
      sql: `insert into pending_questions (id, tenant_id, user_id, inbound_message_id, draft, question, expires_at)
            values ($1, $2, $3, $4, '{}', 'Intrusa?', now())`,
      params: [id(), f.tenantId, f.userId, f.inboundMessageId],
    },
    ai_usage: {
      sql: "insert into ai_usage (id, tenant_id, provider, model) values ($1, $2, 'anthropic', 'x')",
      params: [id(), f.tenantId],
    },
    audit_log: {
      sql: "insert into audit_log (id, tenant_id, action) values ($1, $2, 'intruso')",
      params: [id(), f.tenantId],
    },
    whatsapp_status_events: {
      sql: "insert into whatsapp_status_events (id, tenant_id, wa_message_id, status, raw) values ($1, $2, $3, 'sent', '{}')",
      params: [id(), f.tenantId, `wamid.out.${id()}`],
    },
    outbound_messages: {
      sql: "insert into outbound_messages (id, tenant_id, wa_message_id, to_wa_id, purpose, text) values ($1, $2, $3, '5511900000000', 'notice', 'Intruso')",
      params: [id(), f.tenantId, `dev.out.${id()}`],
    },
    tax_settings: {
      sql: `insert into tax_settings (id, tenant_id, valid_from, enabled, regime, params, created_by)
            values ($1, $2, '2027-01-01', false, 'mei', '{}', $3)`,
      params: [id(), f.tenantId, f.userId],
    },
    sessions: {
      sql: `insert into sessions (id, user_id, token, expires_at)
            values ($1, $2, $3, now() + interval '1 day')`,
      params: [id(), f.userId, `token.${id()}`],
    },
    accounts: {
      sql: "insert into accounts (id, account_id, provider_id, user_id) values ($1, 'x', 'credential', $2)",
      params: [id(), f.userId],
    },
    verifications: {
      sql: "insert into verifications (id, identifier, value, expires_at) values ($1, 'x', 'h', now())",
      params: [id()],
    },
    auth_audit: {
      sql: "insert into auth_audit (id, event) values ($1, 'login')",
      params: [id()],
    },
    signup_verifications: {
      sql: "insert into signup_verifications (id, email, kind, expires_at) values ($1, 'x@x.com', 'notice', now())",
      params: [id()],
    },
    tax_rules: {
      sql: `insert into tax_rules (id, regime, valid_from, components)
            values ($1, 'mei', '2031-01-01', '[]')`,
      params: [id()],
    },
    fiscal_documents: {
      sql: `insert into fiscal_documents (id, tenant_id, access_key, inbound_message_id, source, created_by)
            values ($1, $2, '35261012345678000190650010000001231000001235', $3, 'ai_reading', $4)`,
      params: [id(), f.tenantId, f.inboundMessageId, f.userId],
    },
    whatsapp_opt_ins: {
      sql: `insert into whatsapp_opt_ins (id, tenant_id, user_id, source, inbound_message_id)
            values ($1, $2, $3, 'first_message', $4)`,
      params: [id(), f.tenantId, f.userId, f.inboundMessageId],
    },
  };
}
