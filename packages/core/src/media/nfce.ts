/**
 * Chave de acesso da NFC-e/NF-e: 44 dígitos, o último é o dígito verificador (módulo 11, pesos
 * 2 a 9 da direita para a esquerda). O QR Code do cupom traz a chave em `?p=<chave>|...`
 * (versão 2.0) ou em `chNFe=<chave>` (versões antigas).
 */
export type AccessKey = string & { readonly __brand: "AccessKey" };

function checkDigit(first43: string): number {
  let weight = 2;
  let sum = 0;
  for (let index = first43.length - 1; index >= 0; index--) {
    sum += Number(first43[index]) * weight;
    weight = weight === 9 ? 2 : weight + 1;
  }
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

export function isValidAccessKey(value: string): value is AccessKey {
  if (!/^\d{44}$/.test(value)) return false;
  return checkDigit(value.slice(0, 43)) === Number(value[43]);
}

/** UF do emitente (2 primeiros dígitos, código IBGE) e CNPJ do emitente (posições 6 a 19). */
export function accessKeyParts(key: AccessKey): { ufCode: string; issuerCnpj: string } {
  return { ufCode: key.slice(0, 2), issuerCnpj: key.slice(6, 20) };
}

/** Extrai e valida a chave do texto do QR Code. Nulo se não houver chave válida. */
export function parseNfceQr(content: string): AccessKey | null {
  const candidates = [
    /[?&]p=(\d{44})(?:\||&|$)/,
    /[?&]chNFe=(\d{44})(?:\||&|$)/i,
    /(?:^|[^\d])(\d{44})(?:[^\d]|$)/,
  ];
  for (const pattern of candidates) {
    const key = pattern.exec(content)?.[1];
    if (key !== undefined && isValidAccessKey(key)) return key;
  }
  return null;
}
