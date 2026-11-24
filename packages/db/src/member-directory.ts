import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { memberships, users } from "../schema";
import type { Database } from "./client";
import { uuidv7 } from "./uuid";

/**
 * Usuários globais para o cadastro de colaboradores (F6b, RF05). Roda com o papel `app_auth`,
 * que enxerga `users` e `memberships` de todas as empresas. Por isso nada aqui devolve nome nem
 * dado de outra empresa: só ids e o e-mail do usuário.
 */
export interface MemberDirectory {
  /** Candidatos com e sem o 9º dígito (`normalizeBrazilianPhone`). */
  findUserByPhone(
    candidates: readonly string[],
  ): Promise<{ id: string; email: string | null } | null>;
  findUserIdByEmail(email: string): Promise<string | null>;
  createUser(user: { name: string; phoneE164: string; email: string | null }): Promise<string>;
  /** Existe vínculo do usuário em OUTRA empresa que não `tenantId` (aviso `phone_shared`). */
  hasMembershipElsewhere(userId: string, tenantId: string): Promise<boolean>;
  updateUserContact(
    userId: string,
    contact: { phoneE164?: string; email?: string | null },
  ): Promise<void>;
}

export function createMemberDirectory(db: Database): MemberDirectory {
  return {
    async findUserByPhone(candidates) {
      if (candidates.length === 0) return null;
      const [row] = await db
        .select({ id: users.id, email: users.email })
        .from(users)
        .where(inArray(users.phoneE164, [...candidates]))
        .orderBy(asc(users.createdAt), asc(users.id))
        .limit(1);
      return row ?? null;
    },

    async findUserIdByEmail(email) {
      const [row] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email.trim().toLowerCase()))
        .limit(1);
      return row?.id ?? null;
    },

    async createUser(user) {
      const id = uuidv7();
      const [row] = await db
        .insert(users)
        .values({
          id,
          name: user.name,
          phoneE164: user.phoneE164,
          email: user.email === null ? null : user.email.trim().toLowerCase(),
        })
        .returning({ id: users.id });
      if (!row) throw new Error("insert de usuário sem retorno");
      return row.id;
    },

    async hasMembershipElsewhere(userId, tenantId) {
      const [row] = await db
        .select({ id: memberships.id })
        .from(memberships)
        .where(and(eq(memberships.userId, userId), ne(memberships.tenantId, tenantId)))
        .limit(1);
      return row !== undefined;
    },

    async updateUserContact(userId, contact) {
      const set: { phoneE164?: string; email?: string | null; updatedAt: Date } = {
        updatedAt: new Date(),
      };
      if (contact.phoneE164 !== undefined) set.phoneE164 = contact.phoneE164;
      if (contact.email !== undefined) {
        set.email = contact.email === null ? null : contact.email.trim().toLowerCase();
      }
      if (set.phoneE164 === undefined && set.email === undefined) return;
      await db.update(users).set(set).where(eq(users.id, userId));
    },
  };
}
