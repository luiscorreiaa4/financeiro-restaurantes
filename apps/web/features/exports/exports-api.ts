import {
  type ExportCreateBody,
  type ExportItem,
  type ExportLinkResponse,
  type ExportListResponse,
  exportItemSchema,
  exportLinkResponseSchema,
  exportListResponseSchema,
} from "@app/core/contracts";
import type { ApiClient } from "@/lib/api/client";

export type ExportsApi = {
  /** Pedidos dos últimos 7 dias do próprio usuário (RF29, Pesquisa). */
  list(): Promise<ExportListResponse>;
  /** `clientRequestId` torna o reenvio idempotente: 202 na primeira vez, 200 com o mesmo pedido depois. */
  create(body: ExportCreateBody): Promise<ExportItem>;
  /** Link de download de 1 hora (RF29.R5): a tela só navega até a `url`, nunca guarda o arquivo. */
  link(id: string): Promise<ExportLinkResponse>;
};

/** Exportações (`/api/exports*`). Toda resposta é validada contra o contrato. */
export function exportsApi(client: ApiClient): ExportsApi {
  return {
    list: () => client.get("/api/exports", exportListResponseSchema),
    create: (body) => client.post("/api/exports", body, exportItemSchema),
    link: (id) =>
      client.post(`/api/exports/${encodeURIComponent(id)}/link`, {}, exportLinkResponseSchema),
  };
}
