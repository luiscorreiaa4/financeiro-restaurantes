import type { TenantExtractionContext } from "@app/core";

/** Contexto do restaurante dos casos: o mesmo para todos, para o prefixo cacheável ser reaproveitado. */
export const EVAL_CONTEXT: TenantExtractionContext = {
  categories: [
    "Carnes e peixes",
    "Hortifruti",
    "Bebidas",
    "Gás",
    "Energia",
    "Água",
    "Aluguel",
    "Internet",
    "Manutenção",
    "Folha de pagamento",
    "Marketing",
    "Outras despesas",
    "Salão",
    "Delivery",
    "Balcão",
    "Outras receitas",
  ],
  suppliers: ["Atacadão", "Ceasa", "Ambev"],
  units: ["Restaurante Centro"],
  paymentMethods: ["Dinheiro", "Pix", "Débito", "Crédito", "Voucher"],
};
