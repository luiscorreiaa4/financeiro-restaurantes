import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { meFixture } from "@/lib/api/me-fixture";
import { RequireAction } from "./require-action";

describe("RequireAction", () => {
  it("com a ação mostra a página", () => {
    render(
      <RequireAction me={meFixture()} action="report:view">
        <p>conteúdo</p>
      </RequireAction>,
    );

    expect(screen.getByText("conteúdo")).toBeInTheDocument();
  });

  it("sem a ação mostra 'Você não tem acesso a esta página'", () => {
    const me = meFixture({
      context: { ...meFixture().context, allowedActions: ["entry:view"] },
    });
    render(
      <RequireAction me={me} action="report:view">
        <p>conteúdo</p>
      </RequireAction>,
    );

    expect(screen.getByText("Você não tem acesso a esta página")).toBeInTheDocument();
    expect(screen.queryByText("conteúdo")).not.toBeInTheDocument();
  });
});
