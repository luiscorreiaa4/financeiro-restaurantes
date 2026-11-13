import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { warmRoutes } from "./warm";

test.beforeAll(async () => {
  test.setTimeout(120_000);
  await warmRoutes();
});

// Prova o isolamento das personas restritas da API falsa: o estado (`promoted`, nome salvo) é por
// valor completo do cookie, então criar empresa numa sessão não altera as outras.
const FAKE_API = "http://localhost:4010";

function cookie(persona: string, suffix?: string) {
  const value = suffix ? `sessao-falsa-${persona}-${suffix}` : `sessao-falsa-${persona}`;
  return { cookie: `better-auth.session_token=${value}` };
}

test("persona restrita com sufixo: criar empresa só promove a própria sessão", async ({
  request,
}) => {
  const a = cookie("restrito-dono", randomUUID());
  const b = cookie("restrito-dono", randomUUID());

  const antes = await (await request.get(`${FAKE_API}/api/me`, { headers: b })).json();
  const criada = await request.post(`${FAKE_API}/api/companies`, {
    headers: a,
    data: { company: {} },
  });
  const depoisA = await (await request.get(`${FAKE_API}/api/me`, { headers: a })).json();
  const depoisB = await (await request.get(`${FAKE_API}/api/me`, { headers: b })).json();

  expect(antes).toMatchObject({ access: "restricted", reason: "owner_no_unit" });
  expect(criada.status()).toBe(201);
  expect(depoisA.access).toBe("full");
  expect(depoisB).toMatchObject({ access: "restricted", reason: "owner_no_unit" });
});

test("o motivo vem do prefixo, com ou sem sufixo (sem-vinculo não é lido como dono)", async ({
  request,
}) => {
  const semVinculo = await (
    await request.get(`${FAKE_API}/api/me`, {
      headers: cookie("restrito-sem-vinculo", randomUUID()),
    })
  ).json();
  const semVinculoFixo = await (
    await request.get(`${FAKE_API}/api/me`, { headers: cookie("restrito-sem-vinculo") })
  ).json();
  const donoFixo = await (
    await request.get(`${FAKE_API}/api/me`, { headers: cookie("restrito-dono") })
  ).json();

  expect(semVinculo).toMatchObject({ access: "restricted", reason: "no_membership" });
  expect(semVinculoFixo).toMatchObject({ access: "restricted", reason: "no_membership" });
  expect(donoFixo).toMatchObject({ access: "restricted", reason: "owner_no_unit" });
});
