import { describe, expect, it } from "vitest";
import { recordAuditSafely } from "./record-audit-safely";

describe("registro de auditoria depois da troca (DD-30)", () => {
  it("grava e não reporta nada quando o registro funciona", async () => {
    const reported: string[] = [];
    let recorded = false;
    await recordAuditSafely(
      "password_reset",
      async () => {
        recorded = true;
      },
      (event) => reported.push(event),
    );
    expect(recorded).toBe(true);
    expect(reported).toEqual([]);
  });

  it("se o registro falha, não lança e reporta o evento e o erro", async () => {
    const failure = new Error("falha do banco");
    const reported: Array<{ event: string; error: unknown }> = [];
    await expect(
      recordAuditSafely(
        "name_changed",
        async () => {
          throw failure;
        },
        (event, error) => reported.push({ event, error }),
      ),
    ).resolves.toBeUndefined();
    expect(reported).toEqual([{ event: "name_changed", error: failure }]);
  });

  it("se o próprio relato falha, também não lança", async () => {
    await expect(
      recordAuditSafely(
        "password_changed",
        async () => {
          throw new Error("banco");
        },
        () => {
          throw new Error("log");
        },
      ),
    ).resolves.toBeUndefined();
  });

  it("funciona sem relator", async () => {
    await expect(
      recordAuditSafely("login", async () => {
        throw new Error("banco");
      }),
    ).resolves.toBeUndefined();
  });
});
