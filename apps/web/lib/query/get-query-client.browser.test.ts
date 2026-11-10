import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";

const handle = vi.fn();
vi.mock("@/lib/api/browser-client", () => ({
  handleBrowserApiError: (...args: unknown[]) => handle(...args),
  windowNav: () => ({ assign: vi.fn(), reload: vi.fn(), pathname: "/", search: "" }),
}));

import { getQueryClient } from "./get-query-client";

describe("QueryClient do navegador", () => {
  it("o QueryCache chama handleBrowserApiError com kind query", async () => {
    const client = getQueryClient();
    const error = new ApiError("401", 401);

    await client
      .fetchQuery({
        queryKey: ["x"],
        queryFn: () => Promise.reject(error),
        retry: false,
      })
      .catch(() => undefined);

    expect(handle).toHaveBeenCalledWith(error, "query", expect.anything());
  });
});
