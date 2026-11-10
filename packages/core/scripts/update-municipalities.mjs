// Atualiza a cópia da lista oficial de municípios do IBGE (DD-29).
// Uso: pnpm --filter @app/core municipalities:update
// Grava src/registry/municipalities/data/<UF>.json (array de nomes, ordenado em pt-BR) e commite o resultado.
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const API = "https://servicodados.ibge.gov.br/api/v1/localidades";
const OUT = fileURLToPath(new URL("../src/registry/municipalities/data/", import.meta.url));

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`${url} respondeu ${res.status}`);
  return res.json();
}

const states = await getJson(`${API}/estados`);
if (!Array.isArray(states) || states.length !== 27) {
  throw new Error(`Esperava 27 UFs do IBGE, veio ${states?.length}`);
}

await mkdir(OUT, { recursive: true });
let total = 0;
for (const state of states) {
  const uf = state.sigla;
  const rows = await getJson(`${API}/estados/${uf}/municipios`);
  if (!Array.isArray(rows) || rows.length === 0) throw new Error(`${uf}: lista vazia`);
  const names = rows.map((row) => {
    if (typeof row?.nome !== "string" || row.nome.trim() === "") {
      throw new Error(`${uf}: município sem nome`);
    }
    return row.nome.trim();
  });
  names.sort((a, b) => a.localeCompare(b, "pt-BR"));
  await writeFile(`${OUT}${uf}.json`, `${JSON.stringify(names, null, 2)}\n`);
  total += names.length;
  console.log(`${uf}: ${names.length}`);
}
console.log(`Total: ${total} municípios em ${new Date().toISOString().slice(0, 10)}`);
