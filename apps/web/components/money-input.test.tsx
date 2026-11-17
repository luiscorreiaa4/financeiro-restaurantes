import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { MoneyInput } from "./money-input";

function Harness({
  initial = null,
  onChange,
}: {
  initial?: number | null;
  onChange?: (cents: number | null) => void;
}) {
  const [cents, setCents] = useState<number | null>(initial);
  return (
    <>
      <label htmlFor="valor">Valor</label>
      <MoneyInput
        id="valor"
        value={cents}
        onChange={(next) => {
          setCents(next);
          onChange?.(next);
        }}
      />
      <output data-testid="cents">{cents === null ? "vazio" : String(cents)}</output>
    </>
  );
}

describe("MoneyInput", () => {
  it("não deixa digitar acima de R$ 100.000.000,00 (teto do lançamento, F3c-3)", async () => {
    render(<Harness />);
    const input = screen.getByLabelText("Valor");
    await userEvent.type(input, "100000000,00");
    expect(input).toHaveValue("100.000.000,00");
    await userEvent.clear(input);
    await userEvent.type(input, "1000000000");
    expect(input).toHaveValue("100.000.000");
    await userEvent.clear(input);
    await userEvent.type(input, "100000000,01");
    expect(input).toHaveValue("100.000.000,0");
  });

  it("digitar 1234,56 mostra 1.234,56 e emite 123456 centavos (RF23.CA01)", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const input = screen.getByLabelText("Valor");
    await userEvent.type(input, "1234,56");
    expect(input).toHaveValue("1.234,56");
    expect(onChange).toHaveBeenLastCalledWith(123456);
    expect(screen.getByTestId("cents")).toHaveTextContent("123456");
  });

  it("valor incompleto (termina em vírgula) emite null sem apagar o que foi digitado", async () => {
    render(<Harness />);
    const input = screen.getByLabelText("Valor");
    await userEvent.type(input, "1234,");
    expect(input).toHaveValue("1.234,");
    expect(screen.getByTestId("cents")).toHaveTextContent("vazio");
  });

  it("colar R$ 1.234,56 vira 1.234,56 e 123456", async () => {
    render(<Harness />);
    const input = screen.getByLabelText("Valor");
    await userEvent.click(input);
    await userEvent.paste("R$ 1.234,56");
    expect(input).toHaveValue("1.234,56");
    expect(screen.getByTestId("cents")).toHaveTextContent("123456");
  });

  it("colar 1234.56 (ponto decimal) é lido como 1.234,56", async () => {
    render(<Harness />);
    const input = screen.getByLabelText("Valor");
    await userEvent.click(input);
    await userEvent.paste("1234.56");
    expect(input).toHaveValue("1.234,56");
    expect(screen.getByTestId("cents")).toHaveTextContent("123456");
  });

  it("apagar tudo emite null", async () => {
    const onChange = vi.fn();
    render(<Harness initial={4500} onChange={onChange} />);
    const input = screen.getByLabelText("Valor");
    expect(input).toHaveValue("45,00");
    await userEvent.clear(input);
    expect(input).toHaveValue("");
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("mostra o valor que veio de fora sempre com dois decimais", () => {
    render(<Harness initial={123456} />);
    expect(screen.getByLabelText("Valor")).toHaveValue("1.234,56");
  });
});
