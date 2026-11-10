import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { SignupApi } from "./signup-api";
import { SignupFlow } from "./signup-flow";
import { apiError, fakeSignupApi } from "./signup-test-helpers";

type User = ReturnType<typeof userEvent.setup>;

async function reachForm(user: User, email = "dono@novo.dev") {
  await user.type(screen.getByLabelText("E-mail"), email);
  await user.click(screen.getByRole("button", { name: "Enviar código" }));
  // O sexto dígito confirma sozinho.
  await user.type(await screen.findByLabelText("Código de 6 dígitos"), "123456");
  await screen.findByLabelText("Nome fantasia");
}

async function fillValidForm(user: User, { acceptTerms = true } = {}) {
  await user.type(screen.getByLabelText("Nome completo"), "Maria da Silva");
  await user.type(screen.getByLabelText("Celular (WhatsApp)"), "82 99658-5647");
  await user.type(screen.getByLabelText("Nome fantasia"), "Cantina da Maria");
  await user.selectOptions(screen.getByLabelText("Segmento"), "restaurant");
  await user.type(screen.getByLabelText("Município"), "Maceió");
  await user.selectOptions(screen.getByLabelText("Estado (UF)"), "AL");
  if (acceptTerms) {
    await user.click(
      screen.getByRole("checkbox", {
        name: "Li e aceito os Termos de Uso e a Política de Privacidade",
      }),
    );
  }
}

function renderFlow(api: SignupApi, onDone = vi.fn()) {
  render(<SignupFlow api={api} onDone={onDone} />);
  return onDone;
}

describe("cadastro do dono", () => {
  it("step 1 shows the same message for any email after sending the code", async () => {
    const user = userEvent.setup();
    const api = fakeSignupApi();
    renderFlow(api);

    await user.type(screen.getByLabelText("E-mail"), "novo@restaurante.dev");
    await user.click(screen.getByRole("button", { name: "Enviar código" }));
    await screen.findByLabelText("Código de 6 dígitos");
    const first = screen.getByRole("status").textContent;

    // Outro e-mail (por exemplo, um que já tem conta): a tela não pode mudar.
    await user.clear(screen.getByLabelText("E-mail"));
    await user.type(screen.getByLabelText("E-mail"), "ja-cadastrado@restaurante.dev");
    await user.click(screen.getByRole("button", { name: "Enviar código" }));
    await screen.findByLabelText("Código de 6 dígitos");
    const second = screen.getByRole("status").textContent;

    expect(first).toMatch(/código de 6 dígitos/);
    expect(second).toBe(first);
    expect(second).not.toContain("restaurante.dev");
    expect(api.requestCode).toHaveBeenNthCalledWith(1, "novo@restaurante.dev");
    expect(api.requestCode).toHaveBeenNthCalledWith(2, "ja-cadastrado@restaurante.dev");
  });

  it('wrong code shows "código incorreto"; 3 failures show the blocked message with the resend countdown', async () => {
    const user = userEvent.setup();
    const verifyCode = vi
      .fn()
      .mockRejectedValueOnce(apiError(400, "INVALID_CODE", "Código inválido ou vencido."))
      .mockRejectedValueOnce(apiError(400, "INVALID_CODE", "Código inválido ou vencido."))
      .mockRejectedValueOnce(
        apiError(429, "TOO_MANY_ATTEMPTS", "Muitas tentativas com este código."),
      );
    renderFlow(fakeSignupApi({ verifyCode }));

    await user.type(screen.getByLabelText("E-mail"), "dono@novo.dev");
    await user.click(screen.getByRole("button", { name: "Enviar código" }));
    const code = await screen.findByLabelText("Código de 6 dígitos");
    await user.type(code, "000000");
    expect(await screen.findByRole("alert")).toHaveTextContent(/código incorreto/i);
    expect(code).toHaveAttribute("aria-invalid", "true");

    for (const attempt of ["111111", "222222"]) {
      await user.clear(screen.getByLabelText("Código de 6 dígitos"));
      await user.type(screen.getByLabelText("Código de 6 dígitos"), attempt);
    }

    expect(await screen.findByRole("alert")).toHaveTextContent(/muitas tentativas/i);
    expect(screen.getByRole("button", { name: "Confirmar código" })).toBeDisabled();
    expect(screen.getByLabelText("Código de 6 dígitos")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Colar código" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Reenviar código em \d+ s/ })).toBeDisabled();
    expect(verifyCode).toHaveBeenCalledTimes(3);
    expect(screen.queryByLabelText("Nome fantasia")).not.toBeInTheDocument();
  });

  it("confirms by itself when the sixth digit is typed", async () => {
    const user = userEvent.setup();
    const api = fakeSignupApi();
    renderFlow(api);

    await user.type(screen.getByLabelText("E-mail"), "dono@novo.dev");
    await user.click(screen.getByRole("button", { name: "Enviar código" }));
    await user.type(await screen.findByLabelText("Código de 6 dígitos"), "123456");

    await screen.findByLabelText("Nome fantasia");
    expect(api.verifyCode).toHaveBeenCalledTimes(1);
    expect(api.verifyCode).toHaveBeenCalledWith("dono@novo.dev", "123456");
  });

  it("does not confirm twice when the form is submitted during the automatic confirmation", async () => {
    const user = userEvent.setup();
    const verifyCode = vi.fn(() => new Promise<never>(() => {}));
    renderFlow(fakeSignupApi({ verifyCode }));

    await user.type(screen.getByLabelText("E-mail"), "dono@novo.dev");
    await user.click(screen.getByRole("button", { name: "Enviar código" }));
    await user.type(await screen.findByLabelText("Código de 6 dígitos"), "123456");
    await user.keyboard("{Enter}");

    expect(verifyCode).toHaveBeenCalledTimes(1);
  });

  it("after a wrong code, clicking the button without changing the field sends the same code again", async () => {
    const user = userEvent.setup();
    const verifyCode = vi
      .fn()
      .mockRejectedValueOnce(apiError(400, "INVALID_CODE", "Código inválido ou vencido."))
      .mockResolvedValueOnce({ receipt: "comprovante-1" });
    renderFlow(fakeSignupApi({ verifyCode }));

    await user.type(screen.getByLabelText("E-mail"), "dono@novo.dev");
    await user.click(screen.getByRole("button", { name: "Enviar código" }));
    await user.type(await screen.findByLabelText("Código de 6 dígitos"), "000000");
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Confirmar código" }));

    await screen.findByLabelText("Nome fantasia");
    expect(verifyCode).toHaveBeenCalledTimes(2);
    expect(verifyCode).toHaveBeenLastCalledWith("dono@novo.dev", "000000");
  });

  it("the code cannot be edited while it is being confirmed; after the error the field gets the focus back", async () => {
    const user = userEvent.setup();
    let reject: (cause: unknown) => void = () => {};
    const verifyCode = vi.fn(
      () =>
        new Promise<never>((_, fail) => {
          reject = fail;
        }),
    );
    renderFlow(fakeSignupApi({ verifyCode }));

    await user.type(screen.getByLabelText("E-mail"), "dono@novo.dev");
    await user.click(screen.getByRole("button", { name: "Enviar código" }));
    await user.type(await screen.findByLabelText("Código de 6 dígitos"), "000000");

    expect(screen.getByLabelText("Código de 6 dígitos")).toBeDisabled();

    await act(async () => {
      reject(apiError(400, "INVALID_CODE", "Código inválido ou vencido."));
    });

    await screen.findByRole("alert");
    expect(screen.getByLabelText("Código de 6 dígitos")).toBeEnabled();
    expect(screen.getByLabelText("Código de 6 dígitos")).toHaveFocus();
  });

  it("an incomplete code still shows the message when the button is clicked", async () => {
    const user = userEvent.setup();
    const api = fakeSignupApi();
    renderFlow(api);

    await user.type(screen.getByLabelText("E-mail"), "dono@novo.dev");
    await user.click(screen.getByRole("button", { name: "Enviar código" }));
    await user.type(await screen.findByLabelText("Código de 6 dígitos"), "123");
    await user.click(screen.getByRole("button", { name: "Confirmar código" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Digite os 6 dígitos do código.");
    expect(api.verifyCode).not.toHaveBeenCalled();
  });

  it("step 2 only appears after a valid code; unit name is prefilled with the trade name (R7)", async () => {
    const user = userEvent.setup();
    const api = fakeSignupApi();
    renderFlow(api);

    expect(screen.queryByLabelText("Nome fantasia")).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("E-mail"), "dono@novo.dev");
    await user.click(screen.getByRole("button", { name: "Enviar código" }));
    expect(screen.queryByLabelText("Nome fantasia")).not.toBeInTheDocument();

    await user.type(await screen.findByLabelText("Código de 6 dígitos"), "123456");
    await screen.findByLabelText("Nome fantasia");

    expect(api.verifyCode).toHaveBeenCalledWith("dono@novo.dev", "123456");
    // Código aceito não pode ser reenviado (a API responderia INVALID_CODE).
    expect(screen.queryByRole("button", { name: "Confirmar código" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Código de 6 dígitos")).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Nome fantasia"), "Cantina da Maria");
    expect(screen.getByLabelText("Nome da unidade")).toHaveValue("Cantina da Maria");

    // Depois que o dono edita o nome da unidade, o nome fantasia não o sobrescreve mais.
    await user.clear(screen.getByLabelText("Nome da unidade"));
    await user.type(screen.getByLabelText("Nome da unidade"), "Cantina Centro");
    await user.type(screen.getByLabelText("Nome fantasia"), "!");
    expect(screen.getByLabelText("Nome da unidade")).toHaveValue("Cantina Centro");
  });

  it("invalid cnpj highlights the field and keeps all other values (CA01)", async () => {
    const user = userEvent.setup();
    const api = fakeSignupApi();
    renderFlow(api);
    await reachForm(user);
    await fillValidForm(user);
    await user.type(screen.getByLabelText("CNPJ (opcional)"), "11.222.333/0001-00");

    await user.click(screen.getByRole("button", { name: "Criar conta" }));

    const cnpj = screen.getByLabelText("CNPJ (opcional)");
    expect(cnpj).toHaveAttribute("aria-invalid", "true");
    expect(cnpj).toHaveAccessibleDescription(/dígito verificador/i);
    expect(cnpj).toHaveValue("11.222.333/0001-00");
    expect(screen.getByLabelText("Nome completo")).toHaveValue("Maria da Silva");
    expect(screen.getByLabelText("Celular (WhatsApp)")).toHaveValue("82 99658-5647");
    expect(screen.getByLabelText("Nome fantasia")).toHaveValue("Cantina da Maria");
    expect(screen.getByLabelText("Segmento")).toHaveValue("restaurant");
    expect(screen.getByLabelText("Município")).toHaveValue("Maceió");
    expect(screen.getByLabelText("Estado (UF)")).toHaveValue("AL");
    expect(
      screen.getByRole("checkbox", {
        name: "Li e aceito os Termos de Uso e a Política de Privacidade",
      }),
    ).toBeChecked();
    expect(screen.getByLabelText("Nome completo")).not.toHaveAttribute("aria-invalid", "true");
    expect(api.submitSignup).not.toHaveBeenCalled();
  });

  it("terms checkbox starts unchecked and blocks submit (CA06)", async () => {
    const user = userEvent.setup();
    const api = fakeSignupApi();
    renderFlow(api);
    await reachForm(user);

    const terms = screen.getByRole("checkbox", {
      name: "Li e aceito os Termos de Uso e a Política de Privacidade",
    });
    expect(terms).not.toBeChecked();

    await fillValidForm(user, { acceptTerms: false });
    await user.click(screen.getByRole("button", { name: "Criar conta" }));

    expect(api.submitSignup).not.toHaveBeenCalled();
    expect(terms).toHaveAttribute("aria-invalid", "true");
    expect(terms).toHaveAccessibleDescription(/aceite os Termos de Uso/i);
  });

  it("valid form sends the full payload with the receipt and goes to the welcome page", async () => {
    const user = userEvent.setup();
    const api = fakeSignupApi();
    const onDone = renderFlow(api);
    await reachForm(user);
    await fillValidForm(user);

    await user.click(screen.getByRole("button", { name: "Criar conta" }));

    expect(api.submitSignup).toHaveBeenCalledWith({
      receipt: "comprovante-1",
      email: "dono@novo.dev",
      owner: {
        name: "Maria da Silva",
        email: "dono@novo.dev",
        phone: "82 99658-5647",
        password: "",
      },
      company: {
        tradeName: "Cantina da Maria",
        legalName: "",
        cnpj: "",
        segment: "restaurant",
        taxRegime: "",
        revenueRange: "",
      },
      unit: { name: "Cantina da Maria", city: "Maceió", uf: "AL" },
      terms: { accepted: true },
    });
    expect(onDone).toHaveBeenCalledTimes(1);
    // Depois do sucesso o botão não volta: nada de segundo envio.
    expect(screen.getByRole("button", { name: /Criar conta|Criando/ })).toBeDisabled();
  });

  it("password and confirmation must match before sending", async () => {
    const user = userEvent.setup();
    const api = fakeSignupApi();
    renderFlow(api);
    await reachForm(user);
    await fillValidForm(user);
    await user.type(screen.getByLabelText("Senha (opcional)"), "cantina2026");
    await user.type(screen.getByLabelText("Confirmar senha"), "cantina2027");

    await user.click(screen.getByRole("button", { name: "Criar conta" }));

    expect(api.submitSignup).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Confirmar senha")).toHaveAccessibleDescription(/não conferem/i);
  });

  it("CNPJ_TAKEN and PHONE_TAKEN show their messages; PHONE_TAKEN points to support without naming an account", async () => {
    const user = userEvent.setup();
    const submitSignup = vi
      .fn()
      .mockRejectedValueOnce(
        apiError(
          409,
          "CNPJ_TAKEN",
          "Este CNPJ já está cadastrado. Se a empresa é sua, entre na conta existente ou fale com o suporte.",
        ),
      )
      .mockRejectedValueOnce(
        apiError(
          409,
          "PHONE_TAKEN",
          "Este celular já está em uso. Fale com o suporte para continuar.",
        ),
      );
    renderFlow(fakeSignupApi({ submitSignup }));
    await reachForm(user);
    await fillValidForm(user);
    await user.type(screen.getByLabelText("CNPJ (opcional)"), "11.222.333/0001-81");

    await user.click(screen.getByRole("button", { name: "Criar conta" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("CNPJ já está cadastrado");
    expect(screen.getByLabelText("CNPJ (opcional)")).toHaveAttribute("aria-invalid", "true");

    await user.click(screen.getByRole("button", { name: "Criar conta" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/celular já está em uso/i);
    expect(alert).toHaveTextContent(/suporte/i);
    expect(alert).not.toHaveTextContent("dono@novo.dev");
    expect(alert).not.toHaveTextContent("99658");
    expect(screen.getByLabelText("Celular (WhatsApp)")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Nome fantasia")).toHaveValue("Cantina da Maria");
  });

  it("field errors from the API mark the fields; an expired receipt goes back to the e-mail step", async () => {
    const user = userEvent.setup();
    const submitSignup = vi
      .fn()
      .mockRejectedValueOnce(
        apiError(400, "INVALID_FIELDS", "Confira os campos marcados e tente de novo.", {
          "unit.city": "city_required",
        }),
      )
      .mockRejectedValueOnce(
        apiError(401, "RECEIPT_INVALID", "A confirmação do seu e-mail venceu ou já foi usada."),
      );
    renderFlow(fakeSignupApi({ submitSignup }));
    await reachForm(user);
    await fillValidForm(user);

    await user.click(screen.getByRole("button", { name: "Criar conta" }));
    expect(await screen.findByLabelText("Município")).toHaveAttribute("aria-invalid", "true");

    await user.click(screen.getByRole("button", { name: "Criar conta" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/venceu ou já foi usada/);
    expect(screen.queryByLabelText("Nome fantasia")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enviar código" })).toBeEnabled();
  });
});
