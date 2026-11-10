// Lista oficial de municípios do IBGE por UF (DD-29). Os JSON de `data/` são gerados por
// `pnpm --filter @app/core municipalities:update` e entram só por import dinâmico: o bundle do
// painel carrega um pedaço por UF escolhida, não as 27 listas de uma vez.

const LOADERS = {
  AC: () => import("./data/AC.json"),
  AL: () => import("./data/AL.json"),
  AP: () => import("./data/AP.json"),
  AM: () => import("./data/AM.json"),
  BA: () => import("./data/BA.json"),
  CE: () => import("./data/CE.json"),
  DF: () => import("./data/DF.json"),
  ES: () => import("./data/ES.json"),
  GO: () => import("./data/GO.json"),
  MA: () => import("./data/MA.json"),
  MT: () => import("./data/MT.json"),
  MS: () => import("./data/MS.json"),
  MG: () => import("./data/MG.json"),
  PA: () => import("./data/PA.json"),
  PB: () => import("./data/PB.json"),
  PR: () => import("./data/PR.json"),
  PE: () => import("./data/PE.json"),
  PI: () => import("./data/PI.json"),
  RJ: () => import("./data/RJ.json"),
  RN: () => import("./data/RN.json"),
  RS: () => import("./data/RS.json"),
  RO: () => import("./data/RO.json"),
  RR: () => import("./data/RR.json"),
  SC: () => import("./data/SC.json"),
  SP: () => import("./data/SP.json"),
  SE: () => import("./data/SE.json"),
  TO: () => import("./data/TO.json"),
} satisfies Record<string, () => Promise<{ default: string[] }>>;

/** Municípios da UF na grafia oficial, em ordem alfabética (pt-BR). Rejeita UF desconhecida. */
export async function loadMunicipalities(uf: string): Promise<readonly string[]> {
  const key = uf.trim().toUpperCase();
  if (!Object.hasOwn(LOADERS, key)) throw new Error(`UF desconhecida: ${uf}`);
  const loaded = await LOADERS[key as keyof typeof LOADERS]();
  return loaded.default;
}

/** Chave de comparação e de busca: sem acento, sem caixa e com espaços colapsados. */
export function normalizeCityKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Grafia oficial do município na lista (ignorando acento e caixa), ou `null` se não existir. */
export function findOfficialCity(list: readonly string[], city: string): string | null {
  const key = normalizeCityKey(city);
  if (key === "") return null;
  return list.find((name) => normalizeCityKey(name) === key) ?? null;
}
