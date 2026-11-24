import type { FeeReapplication } from "@app/core/contracts";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import { fakeSettingsApi, renderWithQuery, scopeOf, uuid } from "../shared/settings-test-helpers";
import { FeeReapplyDialog } from "./fee-reapply-dialog";

const target = { kind: "payment_method" as const, id: uuid(1), name: "Crédito" };

function reapplication(overrides: Partial<FeeReapplication> = {}): FeeReapplication {
  return {
    id: uuid(50),
    targetKind: "payment_method",
    targetId: uuid(1),
    from: "2026-11-01",
    to: "2026-11-23",
    status: "queued",
    errorCode: null,
    matched: 0,
    updated: 0,
    skipped: 0,
    createdAt: "2026-11-23T12:00:00.000Z",
    finishedAt: null,
    ...overrides,
  };
}

const PREVIEW = { matched: 312, deltaNetCents: -123456, feePercentBp: 320, feeFixedCents: 0 };

async function openPreview() {
  await userEvent.click(await screen.findByRole("button", { name: "Ver prévia" }));
  return screen.findByText(/312 lançamentos/);
}

describe("FeeReapplyDialog", () => {
  it("mostra a prévia do servidor com o líquido formatado", async () => {
    const previewReapplication = vi.fn().mockResolvedValue(PREVIEW);
    renderWithQuery(
      <FeeReapplyDialog
        scope={scopeOf(fakeSettingsApi({ previewReapplication }))}
        target={target}
        onClose={() => {}}
      />,
    );
    const text = await openPreview();
    expect(text).toHaveTextContent(/o líquido muda em -R\$\s1\.234,56/);
    expect(previewReapplication.mock.calls[0]?.[0]).toMatchObject({
      targetKind: "payment_method",
      targetId: uuid(1),
    });
  });

  it("a chave da tentativa só muda depois do sucesso", async () => {
    const reapply = vi
      .fn()
      .mockRejectedValueOnce(new ApiError("x", 503, { code: "queue_unavailable" }))
      .mockRejectedValueOnce(new ApiError("x", 0))
      .mockResolvedValueOnce(reapplication());
    renderWithQuery(
      <FeeReapplyDialog
        scope={scopeOf(
          fakeSettingsApi({ previewReapplication: vi.fn().mockResolvedValue(PREVIEW), reapply }),
        )}
        target={target}
        onClose={() => {}}
      />,
    );
    await openPreview();
    const confirm = () => screen.getByRole("button", { name: "Confirmar" });
    await userEvent.click(confirm());
    await waitFor(() => expect(reapply).toHaveBeenCalledTimes(1));
    await userEvent.click(confirm());
    await waitFor(() => expect(reapply).toHaveBeenCalledTimes(2));
    await userEvent.click(confirm());
    await waitFor(() => expect(reapply).toHaveBeenCalledTimes(3));
    const keys = reapply.mock.calls.map((call) => call[0].clientRequestId);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).toBe(keys[0]);
  });

  it("409 reapply_in_progress mostra o estado atual", async () => {
    const reapply = vi.fn().mockRejectedValue(
      new ApiError("x", 409, {
        code: "reapply_in_progress",
        item: reapplication({ status: "running" }),
      }),
    );
    renderWithQuery(
      <FeeReapplyDialog
        scope={scopeOf(
          fakeSettingsApi({ previewReapplication: vi.fn().mockResolvedValue(PREVIEW), reapply }),
        )}
        target={target}
        onClose={() => {}}
      />,
    );
    await openPreview();
    await userEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    const dialog = screen.getByRole("dialog");
    expect(
      await within(dialog).findByText(/já tem uma reaplicação em andamento/i),
    ).toBeInTheDocument();
  });

  it("mostra o resultado da última reaplicação", async () => {
    const latestReapplication = vi
      .fn()
      .mockResolvedValue(reapplication({ status: "done", matched: 10, updated: 9, skipped: 1 }));
    renderWithQuery(
      <FeeReapplyDialog
        scope={scopeOf(fakeSettingsApi({ latestReapplication }))}
        target={target}
        onClose={() => {}}
      />,
    );
    expect(await screen.findByText(/9 atualizados/)).toBeInTheDocument();
    expect(screen.getByText(/1 pulado/)).toBeInTheDocument();
  });
});
