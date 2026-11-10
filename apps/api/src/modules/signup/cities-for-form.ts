import { BRAZILIAN_STATES, loadMunicipalities } from "@app/core";

/**
 * Municípios oficiais da UF do formulário (DD-29). UF ausente ou inválida devolve `undefined`:
 * quem acusa o erro é o `uf_invalid` do `validateSignupInput`, e o município só é conferido
 * contra a lista quando a UF existe.
 */
export async function citiesForForm(
  form: Record<string, unknown>,
): Promise<readonly string[] | undefined> {
  const unit = form.unit;
  if (typeof unit !== "object" || unit === null) return undefined;
  const raw = (unit as Record<string, unknown>).uf;
  const uf = typeof raw === "string" ? raw.trim().toUpperCase() : "";
  if (!(BRAZILIAN_STATES as readonly string[]).includes(uf)) return undefined;
  return loadMunicipalities(uf);
}
