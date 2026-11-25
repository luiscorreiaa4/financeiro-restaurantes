import { ApiError } from "@/lib/api/client";

const FALLBACK = "Não foi possível salvar. Tente de novo.";

/** Textos dos erros de validação do servidor (`reason` em snake_case), por `field.reason`. */
const VALIDATION: Record<string, string> = {
  "parent_id.unknown": "Escolha uma categoria do sistema como pai.",
  "parent_id.immutable": "A categoria pai não pode ser trocada. Crie outra subcategoria.",
  "nature.invalid": "A natureza (fixa ou variável) só vale para despesas.",
  "is_sensitive.locked": "Esta subcategoria é sensível e não pode ser desmarcada.",
  "support_words.too_many": "Há palavras de apoio demais (até 30).",
  "support_words.too_long": "Uma palavra de apoio passou de 40 caracteres.",
  "document.invalid": "Documento inválido. Confira os dígitos do CPF ou do CNPJ.",
  "name.invalid": "O nome precisa ter entre 2 e 40 caracteres.",
  "name.system_read_only": "Este é um cadastro do sistema e não pode ser alterado.",
  "aliases.too_many": "Há apelidos demais.",
  "aliases.too_long": "Um dos apelidos é grande demais.",
  "fee_percent_bp.invalid": "A taxa precisa ficar entre 0 e 100 %.",
  "fee_fixed_cents.invalid": "A taxa fixa precisa ser um valor válido.",
  "is_default_card.invalid_type": "Só crédito ou débito pode ser a forma de cartão padrão.",
  "is_default_card.inactive": "A forma de cartão padrão não pode ficar inativa.",
};

export type SettingsErrorText = { message: string; conflict: boolean };

/** Texto de erro do formulário de cadastro. `conflict` = nome já existe (a tela mostra "Já existe"). */
export function settingsErrorText(
  error: unknown,
  extra: Record<string, string> = {},
): SettingsErrorText {
  if (!(error instanceof ApiError)) return { message: FALLBACK, conflict: false };
  const body = (error.body ?? {}) as { code?: string; field?: string; reason?: string };
  if (error.status === 403)
    return { message: "Você não tem permissão para alterar este cadastro.", conflict: false };
  if (body.code === "name_taken")
    return { message: "Já existe um cadastro com este nome ou apelido.", conflict: true };
  if (body.code === "document_taken")
    return { message: "Já existe um fornecedor com este documento.", conflict: true };
  if (body.code === "channel_is_unit_default") {
    return {
      message: "Este canal é o padrão de uma unidade. Troque o canal padrão da unidade antes.",
      conflict: false,
    };
  }
  if (body.code === "validation") {
    const key = `${body.field}.${body.reason}`;
    return { message: extra[key] ?? VALIDATION[key] ?? FALLBACK, conflict: false };
  }
  if (body.code && extra[body.code])
    return { message: extra[body.code] as string, conflict: false };
  return { message: FALLBACK, conflict: false };
}
