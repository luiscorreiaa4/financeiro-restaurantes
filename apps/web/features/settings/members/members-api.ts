import {
  type MemberCreated,
  type MemberSettings,
  type MemberSettingsInput,
  type MemberSettingsPatch,
  memberCreatedSchema,
  memberSettingsSchema,
} from "@app/core/contracts";
import { z } from "zod";
import type { ApiClient } from "@/lib/api/client";

const listSchema = z.object({ items: z.array(memberSettingsSchema) });

export type MemberFilters = { search?: string; role?: string; status?: string };

function query(filters: MemberFilters): string {
  const params = new URLSearchParams();
  if (filters.search?.trim()) params.set("search", filters.search.trim());
  if (filters.role) params.set("role", filters.role);
  if (filters.status) params.set("status", filters.status);
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}

export type MembersApi = {
  list(filters?: MemberFilters): Promise<MemberSettings[]>;
  create(body: MemberSettingsInput): Promise<MemberCreated>;
  update(id: string, body: MemberSettingsPatch): Promise<MemberSettings>;
  deactivate(id: string): Promise<MemberSettings>;
  reactivate(id: string): Promise<MemberSettings>;
};

/** Colaboradores (`/api/settings/members`). Toda resposta é validada contra o contrato (`@app/core`). */
export function membersApi(client: ApiClient): MembersApi {
  const id = encodeURIComponent;
  return {
    list: async (filters = {}) =>
      (await client.get(`/api/settings/members${query(filters)}`, listSchema)).items,
    create: (body) => client.post("/api/settings/members", body, memberCreatedSchema),
    update: (mid, body) =>
      client.patch(`/api/settings/members/${id(mid)}`, body, memberSettingsSchema),
    deactivate: (mid) =>
      client.post(`/api/settings/members/${id(mid)}/deactivate`, {}, memberSettingsSchema),
    reactivate: (mid) =>
      client.post(`/api/settings/members/${id(mid)}/reactivate`, {}, memberSettingsSchema),
  };
}
