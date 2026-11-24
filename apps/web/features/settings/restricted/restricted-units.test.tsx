import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import { RestrictedUnits, type RestrictedUnitsApi } from "./restricted-units";

const UNIT = {
  id: "0193a1b2-0000-7000-8000-000000000003",
  name: "Centro",
  tenantName: "Restaurante Sol",
};

const api = (over: Partial<RestrictedUnitsApi> = {}): RestrictedUnitsApi => ({
  list: () => Promise.resolve({ units: [UNIT] }),
  reactivate: () => Promise.resolve(),
  ...over,
});

describe("RestrictedUnits", () => {
  it("lista as unidades inativas e leva o dono ao painel depois de reativar", async () => {
    const reactivate = vi.fn().mockResolvedValue(undefined);
    const navigate = vi.fn();
    render(<RestrictedUnits api={api({ reactivate })} navigate={navigate} />);
    expect(await screen.findByText(/Restaurante Sol/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reativar Centro" }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith("/"));
    expect(reactivate).toHaveBeenCalledWith(UNIT.id);
  });

  it("sem unidades elegíveis não mostra nada", async () => {
    const { container } = render(
      <RestrictedUnits
        api={api({ list: () => Promise.resolve({ units: [] }) })}
        navigate={() => {}}
      />,
    );
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("404 na reativação mostra aviso e não navega", async () => {
    const navigate = vi.fn();
    render(
      <RestrictedUnits
        api={api({
          reactivate: () => Promise.reject(new ApiError("x", 404, { code: "not_found" })),
        })}
        navigate={navigate}
      />,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Reativar Centro" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/não foi possível reativar/i);
    expect(navigate).not.toHaveBeenCalled();
  });
});
