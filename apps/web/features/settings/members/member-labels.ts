import type { AdditionalPermission } from "@app/core";

export const ROLE_LABELS = { owner: "Dono", manager: "Gerente", staff: "Lançador" } as const;
export const STATUS_LABELS = {
  invited: "Convidado",
  active: "Ativo",
  deactivated: "Desativado",
} as const;
export const PERMISSION_LABELS: Record<AdditionalPermission, string> = {
  VER_FOLHA: "Ver folha de pagamento",
  EXPORTAR_DADOS: "Exportar dados",
  RECEBER_RESUMO_SEMANAL: "Receber resumo semanal",
  CONSULTAR_RELATORIOS_WHATSAPP: "Consultar relatórios pelo WhatsApp",
};

export const MEMBER_ERRORS: Record<string, string> = {
  "displayName.invalid": "O nome precisa ter entre 2 e 120 caracteres.",
  "phone.invalid": "Celular inválido. Use o DDD e o número.",
  "phone.foreign": "Só celulares do Brasil são aceitos.",
  "phone.product_number": "Este é o número do nosso WhatsApp, não de um colaborador.",
  "phone.required": "Informe o celular.",
  "email.invalid": "E-mail inválido.",
  "email.required": "Informe o e-mail para liberar o painel.",
  "permissions.invalid": "Alguma permissão não vale para este papel.",
  "defaultUnitId.outside_access": "A unidade padrão precisa estar entre as de acesso.",
  "defaultUnitId.required": "Escolha a unidade padrão.",
  "unitIds.required": "Escolha pelo menos uma unidade.",
  "unitIds.unknown": "Alguma unidade escolhida não está disponível.",
  "allUnits.needs_all": "O dono sempre tem acesso a todas as unidades.",
  already_member: "Esta pessoa já é colaboradora desta empresa.",
  contact_conflict:
    "Não foi possível usar esse celular com esse e-mail; confira com o colaborador.",
  phone_shared:
    "Este celular também está em outra empresa. Desative este colaborador e cadastre de novo com o número novo.",
  email_shared:
    "Este e-mail também está em outra empresa. Desative este colaborador e cadastre de novo.",
  phone_in_use: "Este celular já pertence a outra pessoa.",
  last_active_owner: "A empresa precisa de pelo menos um dono ativo. Promova outro dono antes.",
};
