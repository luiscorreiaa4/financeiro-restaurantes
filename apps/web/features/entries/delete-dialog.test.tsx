import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DeleteDialog } from "./delete-dialog";

function show(props: Partial<React.ComponentProps<typeof DeleteDialog>> = {}) {
  const onConfirm = vi.fn();
  render(
    <DeleteDialog
      open
      onOpenChange={vi.fn()}
      title="Excluir lançamento?"
      summary="O lançamento vai para a lixeira por 30 dias."
      pending={false}
      error={null}
      onConfirm={onConfirm}
      {...props}
    />,
  );
  return { user: userEvent.setup(), onConfirm };
}

describe("diálogo de exclusão (RF24)", () => {
  it("mostra o contador de 200 caracteres do motivo", async () => {
    const { user } = show();
    expect(screen.getByText("0/200")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Motivo (opcional)"), "duplicado");
    expect(screen.getByText("9/200")).toBeInTheDocument();
  });

  it("não deixa passar de 200 caracteres", async () => {
    const { user } = show();
    const field = screen.getByLabelText("Motivo (opcional)");
    await user.click(field);
    await user.paste("a".repeat(250));
    expect(field).toHaveValue("a".repeat(200));
    expect(screen.getByText("200/200")).toBeInTheDocument();
  });

  it("confirma com o motivo sem espaços nas pontas, ou sem motivo", async () => {
    const first = show();
    await first.user.type(screen.getByLabelText("Motivo (opcional)"), "  erro de digitação ");
    await first.user.click(screen.getByRole("button", { name: "Excluir" }));
    expect(first.onConfirm).toHaveBeenCalledWith("erro de digitação");
  });

  it("sem motivo confirma com undefined", async () => {
    const { user, onConfirm } = show();
    await user.click(screen.getByRole("button", { name: "Excluir" }));
    expect(onConfirm).toHaveBeenCalledWith(undefined);
  });

  it("durante o envio o botão fica desabilitado e o erro aparece como texto", () => {
    show({ pending: true, error: "Não foi possível excluir." });
    expect(screen.getByRole("button", { name: "Excluir" })).toBeDisabled();
    expect(screen.getByText("Não foi possível excluir.")).toBeInTheDocument();
  });
});
