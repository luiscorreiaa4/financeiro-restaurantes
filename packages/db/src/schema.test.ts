import { ROLES } from "@app/core";
import { getTableName, is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "../schema";

const tables = Object.values(schema).filter((value) => is(value, PgTable)) as PgTable[];

describe("schema do banco (checagens estáticas, sem Postgres)", () => {
  it("define as 18 tabelas do modelo de dados", () => {
    expect(tables.map(getTableName).sort()).toEqual(
      [
        "ai_usage",
        "audit_log",
        "categories",
        "entries",
        "entry_versions",
        "fiscal_documents",
        "inbound_messages",
        "memberships",
        "outbound_messages",
        "payment_methods",
        "pending_questions",
        "sales_channels",
        "suppliers",
        "tenants",
        "units",
        "users",
        "whatsapp_opt_ins",
        "whatsapp_status_events",
      ].sort(),
    );
  });

  it("toda tabela tem pelo menos uma política de RLS (isolamento por tenant)", () => {
    for (const table of tables) {
      const config = getTableConfig(table);
      expect(config.policies.length, `${config.name} sem política`).toBeGreaterThan(0);
    }
  });

  it("toda tabela com tenant_id tem política restrita ao papel app", () => {
    for (const table of tables) {
      const config = getTableConfig(table);
      if (!config.columns.some((column) => column.name === "tenant_id")) continue;
      const roles = config.policies.flatMap((policy) =>
        ([policy.to].flat() as ({ name: string } | string)[]).map((role) =>
          typeof role === "string" ? role : role.name,
        ),
      );
      expect(roles, `${config.name} sem política para app`).toContain("app");
      expect(roles, `${config.name} aberta a public`).not.toContain("public");
    }
  });

  it("todo id é uuid e todo valor em centavos é bigint", () => {
    for (const table of tables) {
      const { columns, name } = getTableConfig(table);
      const id = columns.find((column) => column.name === "id");
      expect(id?.getSQLType(), `${name}.id`).toBe("uuid");
      for (const column of columns.filter((c) => c.name.endsWith("_cents"))) {
        expect(column.getSQLType(), `${name}.${column.name}`).toBe("bigint");
      }
    }
  });

  it("papéis de membership vêm do domínio (core), sem lista duplicada", () => {
    const { checks } = getTableConfig(schema.memberships);
    const role = checks.find((check) => check.name === "memberships_role_check");
    expect(role).toBeDefined();
    expect(ROLES).toEqual(["owner", "manager", "staff"]);
  });
});
