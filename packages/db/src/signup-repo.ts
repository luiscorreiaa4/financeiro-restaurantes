import {
  type CreateAccountError,
  type CreateCompanyError,
  err,
  type NewAccount,
  type NewCompany,
  ok,
  type Result,
  SIGNUP_DEFAULTS,
  type SignupInput,
} from "@app/core";
import { and, eq, isNull } from "drizzle-orm";
import { accounts, authAudit } from "../schema/auth";
import { paymentMethods, salesChannels } from "../schema/catalog";
import { taxSettings } from "../schema/tax";
import { memberships, tenants, units, users } from "../schema/tenants";
import type { Database, Transaction } from "./client";
import { createSignupStore } from "./signup-store";
import { uuidv7 } from "./uuid";

export interface SignupRepo {
  /**
   * Cria a conta inteira numa transação `app_auth`: consome o comprovante e grava empresa,
   * dono, cadastros padrão, unidade, vínculo, imposto (se houver regime) e auditoria. Unicidade
   * violada (23505) vira erro tipado pelo nome da restrição; qualquer outro erro desfaz tudo e
   * é relançado.
   */
  createAccount(
    account: NewAccount,
  ): Promise<Result<{ tenantId: string; userId: string }, CreateAccountError>>;
  /**
   * "Criar outra empresa" (F1b): a mesma gravação da empresa, na mesma forma de transação, para
   * o usuário da sessão, sem `users` nem `accounts` novos. Grava o celular do usuário quando
   * `phoneE164ToSet` vem preenchido (só se ele ainda não tiver um) e o vínculo de Dono com
   * `preferred_at = now`.
   */
  createCompany(company: NewCompany): Promise<Result<{ tenantId: string }, CreateCompanyError>>;
}

export interface SignupRepoOptions {
  /** Só para testes: roda depois do INSERT da unidade, para provar o rollback (CA08). */
  readonly afterUnitInsert?: (tx: Transaction) => Promise<void>;
}

const CONSTRAINT_ERRORS: Record<string, Exclude<CreateAccountError, "receipt_invalid">> = {
  tenants_cnpj_open_unique: "cnpj_taken",
  users_phone_e164_unique: "phone_taken",
  users_email_unique: "email_taken",
};

/** Acha o erro do Postgres, direto ou embrulhado pelo Drizzle (`cause`). */
function uniqueViolation(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== null && typeof current === "object"; depth++) {
    const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (candidate.code === "23505" && typeof candidate.constraint === "string") {
      return candidate.constraint;
    }
    current = candidate.cause;
  }
  return null;
}

/** Sinal interno para desfazer a transação quando o comprovante não vale. */
class ReceiptInvalid extends Error {}

/** O que a gravação da empresa precisa, venha do cadastro novo ou de "Criar outra empresa". */
interface CompanyRows {
  readonly input: SignupInput;
  readonly ownerId: string;
  readonly ids: {
    readonly tenantId: string;
    readonly unitId: string;
    readonly membershipId: string;
  };
  readonly now: Date;
  readonly trialEndsAt: Date;
  readonly signupDate: string;
  readonly legal: { readonly terms: string; readonly privacy: string; readonly dpa: string };
  /** `now` em "Criar outra empresa": a empresa nova vira a ativa no canal (DE-25). */
  readonly preferredAt: Date | null;
}

/**
 * Empresa, cadastros padrão, unidade, vínculo de Dono e imposto, sempre para o tenant criado
 * nesta mesma transação (as políticas de INSERT do `app_auth` são `WITH CHECK (true)`).
 */
async function insertCompany(
  tx: Transaction,
  rows: CompanyRows,
  afterUnitInsert: SignupRepoOptions["afterUnitInsert"],
): Promise<void> {
  const { input, ownerId, ids, now } = rows;
  await tx.insert(tenants).values({
    id: ids.tenantId,
    name: input.company.tradeName,
    plan: "trial",
    legalName: input.company.legalName,
    cnpj: input.company.cnpj,
    segment: input.company.segment,
    revenueRange: input.company.revenueRange,
    status: "active",
    trialStartedAt: now,
    trialEndsAt: rows.trialEndsAt,
    termsAcceptedAt: now,
    termsVersion: rows.legal.terms,
    privacyVersion: rows.legal.privacy,
    dpaVersion: rows.legal.dpa,
    termsAcceptedBy: ownerId,
    createdAt: now,
  });

  const channelIds = new Map<string, string>();
  await tx.insert(salesChannels).values(
    SIGNUP_DEFAULTS.salesChannels.map((channel) => {
      const id = uuidv7();
      channelIds.set(channel.name, id);
      return {
        id,
        tenantId: ids.tenantId,
        name: channel.name,
        type: channel.type,
        feePercentBp: channel.feePercentBp,
        createdAt: now,
      };
    }),
  );
  await tx.insert(paymentMethods).values(
    SIGNUP_DEFAULTS.paymentMethods.map((method) => ({
      id: uuidv7(),
      tenantId: ids.tenantId,
      name: method.name,
      type: method.type,
      feePercentBp: method.feePercentBp,
      feeFixedCents: method.feeFixedCents,
      isDefaultCard: method.isDefaultCard,
      createdAt: now,
    })),
  );

  await tx.insert(units).values({
    id: ids.unitId,
    tenantId: ids.tenantId,
    name: input.unit.name,
    timezone: input.unit.timezone,
    city: input.unit.city,
    uf: input.unit.uf,
    defaultSalesChannelId: channelIds.get(SIGNUP_DEFAULTS.defaultSalesChannelName) ?? null,
    createdAt: now,
  });
  await afterUnitInsert?.(tx);

  await tx.insert(memberships).values({
    id: ids.membershipId,
    tenantId: ids.tenantId,
    userId: ownerId,
    role: "owner",
    allUnits: true,
    defaultUnitId: ids.unitId,
    preferredAt: rows.preferredAt,
    status: "active",
    panelAccess: true,
    createdAt: now,
  });

  const regime = input.company.taxRegime;
  if (regime !== null && regime !== "not_sure") {
    await tx.insert(taxSettings).values({
      id: uuidv7(),
      tenantId: ids.tenantId,
      validFrom: rows.signupDate,
      enabled: false,
      regime,
      createdBy: ownerId,
      createdAt: now,
    });
  }
}

/** 23505 conhecido vira o erro tipado; o resto não é tratado aqui. */
function mapUniqueViolation(error: unknown): Exclude<CreateAccountError, "receipt_invalid"> | null {
  const constraint = uniqueViolation(error);
  return (constraint === null ? undefined : CONSTRAINT_ERRORS[constraint]) ?? null;
}

/**
 * Gravação do autocadastro (F1b, RF01.Obs2). O papel `app_auth` só tem INSERT nas tabelas de
 * cliente (sem SELECT nem RETURNING): todos os IDs vêm da aplicação, e o vínculo é criado só
 * para o tenant criado nesta mesma transação.
 */
export function createSignupRepo(db: Database, options: SignupRepoOptions = {}): SignupRepo {
  const receipts = createSignupStore(db);
  return {
    async createAccount(account) {
      const { input, ids, now } = account;
      try {
        await db.transaction(async (tx) => {
          // Primeiro o comprovante: pedidos paralelos com o mesmo comprovante se enfileiram na
          // trava da linha e só um passa (Foco 3).
          const consumed = await receipts.consumeReceipt(
            { email: account.email, receiptHash: account.receiptHash, now },
            tx,
          );
          if (!consumed) throw new ReceiptInvalid();

          // `users` antes de `tenants`: `terms_accepted_by` aponta para o dono, e o app_auth
          // não tem UPDATE em `tenants` para preencher depois.
          await tx.insert(users).values({
            id: ids.userId,
            name: input.owner.name ?? "",
            email: account.email,
            phoneE164: input.owner.phoneE164,
            emailVerified: true,
            createdAt: now,
            updatedAt: now,
          });
          if (account.passwordHash !== null) {
            await tx.insert(accounts).values({
              id: uuidv7(),
              accountId: ids.userId,
              providerId: "credential",
              userId: ids.userId,
              password: account.passwordHash,
              createdAt: now,
              updatedAt: now,
            });
          }
          await insertCompany(
            tx,
            {
              input,
              ownerId: ids.userId,
              ids,
              now,
              trialEndsAt: account.trialEndsAt,
              signupDate: account.signupDate,
              legal: account.legal,
              preferredAt: null,
            },
            options.afterUnitInsert,
          );

          await tx.insert(authAudit).values({
            id: uuidv7(),
            userId: ids.userId,
            emailHash: account.emailHash,
            event: "signup_completed",
            ip: account.ip ?? null,
            userAgent: account.userAgent ?? null,
            createdAt: now,
          });
        });
      } catch (error) {
        if (error instanceof ReceiptInvalid) return err("receipt_invalid");
        const mapped = mapUniqueViolation(error);
        if (mapped !== null) return err(mapped);
        throw error;
      }
      return ok({ tenantId: ids.tenantId, userId: ids.userId });
    },

    async createCompany(company) {
      const { userId, ids, now } = company;
      try {
        await db.transaction(async (tx) => {
          if (company.phoneE164ToSet !== null) {
            // Só preenche celular vazio, nunca troca o de quem já tem (o `app_auth` tem UPDATE
            // em `users` desde a 0011). Celular de outro usuário viola `users_phone_e164_unique`.
            await tx
              .update(users)
              .set({ phoneE164: company.phoneE164ToSet, updatedAt: now })
              .where(and(eq(users.id, userId), isNull(users.phoneE164)));
          }
          await insertCompany(
            tx,
            {
              input: company.input,
              ownerId: userId,
              ids,
              now,
              trialEndsAt: company.trialEndsAt,
              signupDate: company.signupDate,
              legal: company.legal,
              preferredAt: now,
            },
            options.afterUnitInsert,
          );
          await tx.insert(authAudit).values({
            id: uuidv7(),
            userId,
            emailHash: company.emailHash,
            event: "company_created",
            ip: company.ip ?? null,
            userAgent: company.userAgent ?? null,
            createdAt: now,
          });
        });
      } catch (error) {
        const mapped = mapUniqueViolation(error);
        if (mapped === "cnpj_taken" || mapped === "phone_taken") return err(mapped);
        throw error;
      }
      return ok({ tenantId: ids.tenantId });
    },
  };
}
