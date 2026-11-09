import { decideOtpSend } from "@app/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, createPool } from "../src/client";
import { createSignupStore, type SignupStore } from "../src/signup-store";
import { startTestDatabase, type TestDatabase } from "./database";

const MIN = 60 * 1000;
const START = new Date("2026-11-09T12:00:00.000Z");

let db: TestDatabase;
let pool: ReturnType<typeof createPool>;
let store: SignupStore;
let now = START;

const clock = { now: () => now };
const at = (minutes: number, seconds = 0) =>
  new Date(START.getTime() + minutes * MIN + seconds * 1000);

beforeAll(async () => {
  db = await startTestDatabase();
  pool = createPool(db.urls.auth);
  store = createSignupStore(createDatabase(pool), clock);
});

afterAll(async () => {
  await pool?.end();
  await db?.stop();
});

function send(
  email: string,
  ip: string,
  options: { kind?: "code" | "notice"; codeHash?: string | null } = {},
) {
  const kind = options.kind ?? "code";
  return store.reserveSend({
    email,
    ip,
    kind,
    codeHash: kind === "code" ? (options.codeHash ?? "hash-certo") : null,
    expiresAt: new Date(now.getTime() + 5 * MIN),
    decide: (byEmail, byIp) => decideOtpSend(byEmail, byIp, now).allowed,
  });
}

const receipt = () => ({
  receiptHash: "comprovante",
  expiresAt: new Date(now.getTime() + 30 * MIN),
});

describe("reserveSend", () => {
  it("recusa um segundo envio em 60 s e o sexto na hora para o mesmo e-mail", async () => {
    now = START;
    expect(await send("envio@exemplo.com", "10.0.0.1")).toBe(true);
    now = at(0, 30);
    expect(await send("envio@exemplo.com", "10.0.0.1")).toBe(false);
    for (const minutes of [1, 2, 3, 4]) {
      now = at(minutes, 1);
      expect(await send("envio@exemplo.com", "10.0.0.1")).toBe(true);
    }
    now = at(6);
    expect(await send("envio@exemplo.com", "10.0.0.1")).toBe(false);
    now = at(61);
    expect(await send("envio@exemplo.com", "10.0.0.1")).toBe(true);
  });

  it("recusa o 21o envio por IP na hora", async () => {
    now = at(200);
    for (let i = 0; i < 20; i++) {
      expect(await send(`ip${i}@exemplo.com`, "10.0.0.2")).toBe(true);
    }
    expect(await send("ip20@exemplo.com", "10.0.0.2")).toBe(false);
    expect(await send("ip20@exemplo.com", "10.0.0.3")).toBe(true);
  });

  it("pedidos paralelos do mesmo e-mail passam só uma vez", async () => {
    now = at(300);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => send("paralelo@exemplo.com", "10.0.0.4")),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});

describe("verifyCode", () => {
  it("aceita o código certo, recusa o errado e na 4a tentativa bloqueia", async () => {
    now = at(400);
    await send("codigo@exemplo.com", "10.0.1.1");
    const input = { email: "codigo@exemplo.com", now: at(401), makeReceipt: receipt };
    expect(await store.verifyCode({ ...input, codeHash: "errado" })).toBe("invalid");
    expect(await store.verifyCode({ ...input, codeHash: "errado" })).toBe("invalid");
    expect(await store.verifyCode({ ...input, codeHash: "errado" })).toBe("invalid");
    expect(await store.verifyCode({ ...input, codeHash: "errado" })).toBe("too_many_attempts");
    expect(await store.verifyCode({ ...input, codeHash: "hash-certo" })).toBe("too_many_attempts");
  });

  it("aceita o código certo dentro dos 5 minutos", async () => {
    now = at(410);
    await send("certo@exemplo.com", "10.0.1.2");
    const result = await store.verifyCode({
      email: "certo@exemplo.com",
      codeHash: "hash-certo",
      now: at(414),
      makeReceipt: receipt,
    });
    expect(result).toBe("ok");
  });

  it("trata o código vencido (após 5 min) como inválido e conta a tentativa", async () => {
    now = at(420);
    await send("vencido@exemplo.com", "10.0.1.3");
    const input = { email: "vencido@exemplo.com", makeReceipt: receipt };
    expect(await store.verifyCode({ ...input, codeHash: "hash-certo", now: at(425, 1) })).toBe(
      "invalid",
    );
    const { rows } = await db.admin.query(
      "select attempts from signup_verifications where email = $1",
      ["vencido@exemplo.com"],
    );
    expect(rows[0].attempts).toBe(1);
  });

  it("uma linha de aviso se comporta como código errado e conta tentativas", async () => {
    now = at(430);
    await send("aviso@exemplo.com", "10.0.1.4", { kind: "notice" });
    const input = { email: "aviso@exemplo.com", now: at(431), makeReceipt: receipt };
    expect(await store.verifyCode({ ...input, codeHash: "hash-certo" })).toBe("invalid");
    expect(await store.verifyCode({ ...input, codeHash: "hash-certo" })).toBe("invalid");
    expect(await store.verifyCode({ ...input, codeHash: "hash-certo" })).toBe("invalid");
    expect(await store.verifyCode({ ...input, codeHash: "hash-certo" })).toBe("too_many_attempts");
  });

  it("aceita o código certo na 3a tentativa depois de 2 erros", async () => {
    now = at(460);
    await send("terceira@exemplo.com", "10.0.1.6");
    const input = { email: "terceira@exemplo.com", now: at(461), makeReceipt: receipt };
    expect(await store.verifyCode({ ...input, codeHash: "errado" })).toBe("invalid");
    expect(await store.verifyCode({ ...input, codeHash: "errado" })).toBe("invalid");
    expect(await store.verifyCode({ ...input, codeHash: "hash-certo" })).toBe("ok");
  });

  it("e-mail sem envio é inválido", async () => {
    const result = await store.verifyCode({
      email: "ninguem@exemplo.com",
      codeHash: "x",
      now: at(440),
      makeReceipt: receipt,
    });
    expect(result).toBe("invalid");
  });

  it("o mesmo código não gera um segundo comprovante", async () => {
    now = at(450);
    await send("dupla@exemplo.com", "10.0.1.5");
    const input = { email: "dupla@exemplo.com", codeHash: "hash-certo", now: at(451) };
    expect(await store.verifyCode({ ...input, makeReceipt: receipt })).toBe("ok");
    expect(await store.verifyCode({ ...input, makeReceipt: receipt })).toBe("invalid");
  });
});

describe("consumeReceipt", () => {
  async function verified(email: string, minutes: number) {
    now = at(minutes);
    await send(email, "10.0.2.1");
    await store.verifyCode({ email, codeHash: "hash-certo", now, makeReceipt: receipt });
  }

  it("vale uma vez, falha na segunda, após 30 min e para outro e-mail", async () => {
    await verified("recibo@exemplo.com", 500);
    const base = { email: "recibo@exemplo.com", receiptHash: "comprovante" };
    expect(await store.consumeReceipt({ ...base, email: "outro@exemplo.com", now: at(501) })).toBe(
      false,
    );
    expect(await store.consumeReceipt({ ...base, receiptHash: "falso", now: at(501) })).toBe(false);
    expect(await store.consumeReceipt({ ...base, now: at(501) })).toBe(true);
    expect(await store.consumeReceipt({ ...base, now: at(502) })).toBe(false);

    await verified("expira@exemplo.com", 510);
    expect(
      await store.consumeReceipt({
        email: "expira@exemplo.com",
        receiptHash: "comprovante",
        now: at(541),
      }),
    ).toBe(false);
  });

  it("dentro de uma transação que desfaz, o comprovante continua valendo", async () => {
    await verified("rollback@exemplo.com", 700);
    const input = { email: "rollback@exemplo.com", receiptHash: "comprovante", now: at(701) };
    await createDatabase(pool)
      .transaction(async (tx) => {
        expect(await store.consumeReceipt(input, tx)).toBe(true);
        throw new Error("cnpj_taken");
      })
      .catch(() => undefined);
    expect(await store.consumeReceipt(input)).toBe(true);
  });

  it("dentro de uma transação confirmada, consome uma vez", async () => {
    await verified("commit@exemplo.com", 710);
    const input = { email: "commit@exemplo.com", receiptHash: "comprovante", now: at(711) };
    const inTx = await createDatabase(pool).transaction((tx) => store.consumeReceipt(input, tx));
    expect(inTx).toBe(true);
    expect(await store.consumeReceipt(input)).toBe(false);
  });

  it("duas chamadas paralelas: exatamente uma devolve true", async () => {
    await verified("corrida@exemplo.com", 600);
    const call = () =>
      store.consumeReceipt({
        email: "corrida@exemplo.com",
        receiptHash: "comprovante",
        now: at(601),
      });
    const results = await Promise.all([call(), call(), call(), call()]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});

describe("isReceiptLive", () => {
  it("vivo, vencido, já consumido e de outro e-mail; só lê, não consome", async () => {
    now = at(800);
    await send("vivo@exemplo.com", "10.0.3.1");
    await store.verifyCode({
      email: "vivo@exemplo.com",
      codeHash: "hash-certo",
      now,
      makeReceipt: receipt,
    });
    const base = { email: "vivo@exemplo.com", receiptHash: "comprovante" };

    expect(await store.isReceiptLive({ ...base, now: at(801) })).toBe(true);
    // Ler não gasta: continua vivo e ainda consome uma vez.
    expect(await store.isReceiptLive({ ...base, now: at(801) })).toBe(true);
    expect(await store.isReceiptLive({ ...base, email: "outro@exemplo.com", now: at(801) })).toBe(
      false,
    );
    expect(await store.isReceiptLive({ ...base, receiptHash: "falso", now: at(801) })).toBe(false);
    expect(await store.isReceiptLive({ ...base, now: at(831) })).toBe(false);

    expect(await store.consumeReceipt({ ...base, now: at(802) })).toBe(true);
    expect(await store.isReceiptLive({ ...base, now: at(803) })).toBe(false);
  });
});
