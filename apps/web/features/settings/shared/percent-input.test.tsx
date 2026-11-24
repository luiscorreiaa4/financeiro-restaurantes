import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PercentInput } from "./percent-input";

describe("PercentInput", () => {
  it("emite pontos-base do texto digitado", async () => {
    const onChange = vi.fn();
    render(<PercentInput label="Taxa" value={null} onChange={onChange} />);
    await userEvent.type(screen.getByLabelText("Taxa"), "3,2");
    expect(onChange).toHaveBeenLastCalledWith(320);
  });

  it("recusa 120 e mostra o motivo, sem emitir valor", async () => {
    const onChange = vi.fn();
    render(<PercentInput label="Taxa" value={null} onChange={onChange} />);
    await userEvent.type(screen.getByLabelText("Taxa"), "120");
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole("alert")).toHaveTextContent("entre 0 e 100");
  });

  it("recusa mais de duas casas", async () => {
    const onChange = vi.fn();
    render(<PercentInput label="Taxa" value={null} onChange={onChange} />);
    await userEvent.type(screen.getByLabelText("Taxa"), "3,256");
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("mostra o valor de fora formatado", () => {
    render(<PercentInput label="Taxa" value={320} onChange={() => {}} />);
    expect(screen.getByLabelText("Taxa")).toHaveValue("3,20");
  });
});
