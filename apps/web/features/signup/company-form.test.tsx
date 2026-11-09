import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CompanyForm } from "./company-form";
import { apiError, fakeSignupApi } from "./signup-test-helpers";

type User = ReturnType<typeof userEvent.setup>;

async function fillCompany(user: User) {
  await user.type(screen.getByLabelText("Nome fantasia"), "Bar do Zé");
  await user.selectOptions(screen.getByLabelText("Segmento"), "bar");
  await user.type(screen.getByLabelText("Município"), "Recife");
  await user.selectOptions(screen.getByLabelText("Estado (UF)"), "PE");
  await user.click(
    screen.getByRole("checkbox", {
      name: "Li e aceito os Termos de Uso e a Política de Privacidade",
    }),
  );
}

describe("criar outra empresa (usuário logado)", () => {
  it("company form for logged user has no email/password fields and asks for phone only when the session user has none", async () => {
    const user = userEvent.setup();
    const submitCompany = vi
      .fn()
      .mockRejectedValueOnce(
        apiError(400, "INVALID_FIELDS", "Confira os campos marcados e tente de novo.", {
          "owner.phone": "phone_required",
        }),
      )
      .mockResolvedValueOnce({ tenantId: "tenant-2" });
    const onDone = vi.fn();
    render(<CompanyForm api={fakeSignupApi({ submitCompany })} onDone={onDone} />);

    expect(screen.queryByLabelText("E-mail")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Senha/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Nome completo")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Celular (WhatsApp)")).not.toBeInTheDocument();

    await fillCompany(user);
    await user.click(screen.getByRole("button", { name: "Criar empresa" }));

    // A API diz que o usuário não tem celular: só então o campo aparece.
    const phone = await screen.findByLabelText("Celular (WhatsApp)");
    expect(phone).toHaveAttribute("aria-invalid", "true");
    expect(phone).toHaveAccessibleDescription(/celular/i);
    expect(screen.getByLabelText("Nome fantasia")).toHaveValue("Bar do Zé");
    expect(onDone).not.toHaveBeenCalled();

    await user.type(phone, "81 98888-7777");
    await user.click(screen.getByRole("button", { name: "Criar empresa" }));

    expect(submitCompany).toHaveBeenLastCalledWith({
      owner: { phone: "81 98888-7777" },
      company: {
        tradeName: "Bar do Zé",
        legalName: "",
        cnpj: "",
        segment: "bar",
        taxRegime: "",
        revenueRange: "",
      },
      unit: { name: "Bar do Zé", city: "Recife", uf: "PE" },
      terms: { accepted: true },
    });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("user who already has a phone creates the company without ever seeing the phone field", async () => {
    const user = userEvent.setup();
    const api = fakeSignupApi();
    const onDone = vi.fn();
    render(<CompanyForm api={api} onDone={onDone} />);

    await fillCompany(user);
    await user.click(screen.getByRole("button", { name: "Criar empresa" }));

    expect(api.submitCompany).toHaveBeenCalledWith(
      expect.objectContaining({ owner: {}, terms: { accepted: true } }),
    );
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText("Celular (WhatsApp)")).not.toBeInTheDocument();
  });

  it("terms unchecked blocks the new company too (CA06)", async () => {
    const user = userEvent.setup();
    const api = fakeSignupApi();
    render(<CompanyForm api={api} onDone={vi.fn()} />);

    await user.type(screen.getByLabelText("Nome fantasia"), "Bar do Zé");
    await user.selectOptions(screen.getByLabelText("Segmento"), "bar");
    await user.type(screen.getByLabelText("Município"), "Recife");
    await user.selectOptions(screen.getByLabelText("Estado (UF)"), "PE");
    await user.click(screen.getByRole("button", { name: "Criar empresa" }));

    expect(api.submitCompany).not.toHaveBeenCalled();
    expect(
      screen.getByRole("checkbox", {
        name: "Li e aceito os Termos de Uso e a Política de Privacidade",
      }),
    ).toHaveAttribute("aria-invalid", "true");
  });
});
