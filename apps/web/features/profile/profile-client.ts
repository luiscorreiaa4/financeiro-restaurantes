import { z } from "zod";
import { createApiClient } from "@/lib/api/client";

/** Espelho de `ProfileView` da API (`GET /api/profile`): sem token nem id de sessão. */
export const profileSchema = z.object({
  name: z.string(),
  email: z.string(),
  hasPassword: z.boolean(),
  sessions: z.array(
    z.object({
      device: z.string(),
      lastUsedAt: z.string(),
      current: z.boolean(),
    }),
  ),
});

export type Profile = z.infer<typeof profileSchema>;

export type ProfileClient = {
  get(): Promise<Profile>;
  updateName(name: string): Promise<void>;
  changePassword(input: { currentPassword: string; newPassword: string }): Promise<void>;
  /** Pede o link de nova senha por e-mail (RF03, DD-27); quem conclui é /redefinir-senha. */
  requestPasswordLink(): Promise<void>;
  revokeOtherSessions(): Promise<void>;
};

const successSchema = z.object({ success: z.literal(true) });

/** Cliente de `/api/profile/*`. O navegador fala com o próprio web, que repassa /api/* (cookie de primeira parte). */
export function createProfileClient(fetchImpl?: typeof fetch): ProfileClient {
  const api = createApiClient({ baseUrl: "", fetch: fetchImpl });
  return {
    get: () => api.get("/api/profile", profileSchema),
    async updateName(name) {
      await api.patch("/api/profile/name", { name }, successSchema);
    },
    async changePassword(input) {
      await api.post("/api/profile/password", input, successSchema);
    },
    async requestPasswordLink() {
      await api.post("/api/profile/password/link", {}, successSchema);
    },
    async revokeOtherSessions() {
      await api.post("/api/profile/sessions/revoke-others", {}, successSchema);
    },
  };
}
