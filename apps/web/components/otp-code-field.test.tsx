import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OtpCodeField, sanitizeOtp } from "./otp-code-field";

const LABEL = "Código de 6 dígitos";

type HarnessProps = {
  onComplete?: (value: string) => void;
  initial?: string;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
};

function Harness({ onComplete, initial = "", ...rest }: HarnessProps) {
  const [value, setValue] = useState(initial);
  return (
    <OtpCodeField id="code" value={value} onChange={setValue} onComplete={onComplete} {...rest} />
  );
}

/** As seis caixas, na ordem. */
function boxes(): HTMLInputElement[] {
  return screen.getAllByRole("textbox") as HTMLInputElement[];
}

function box(index: number): HTMLInputElement {
  return boxes()[index] as HTMLInputElement;
}

function code(): string {
  return boxes()
    .map((box) => box.value)
    .join("");
}

function mockClipboard(read: () => Promise<string>) {
  return vi.spyOn(navigator.clipboard, "readText").mockImplementation(read);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("sanitizeOtp", () => {
  it("mantém só dígitos e corta em 6", () => {
    expect(sanitizeOtp("123 456")).toBe("123456");
    expect(sanitizeOtp("123-456-789")).toBe("123456");
    expect(sanitizeOtp("abc")).toBe("");
  });
});

describe("OtpCodeField", () => {
  it("tem seis caixas numéricas; a primeira leva o rótulo e o código único", () => {
    render(<Harness />);

    expect(boxes()).toHaveLength(6);
    const first = screen.getByLabelText(LABEL);
    expect(first).toBe(box(0));
    expect(first).toHaveAttribute("autocomplete", "one-time-code");
    for (const box of boxes()) {
      expect(box).toHaveAttribute("inputmode", "numeric");
      expect(box).not.toHaveAttribute("type", "number");
    }
    expect(screen.getByLabelText("Dígito 6 de 6")).toBe(box(5));
  });

  it("digitar 6 dígitos avança caixa a caixa e chama onComplete uma vez", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<Harness onComplete={onComplete} />);

    await user.type(screen.getByLabelText(LABEL), "12345");
    expect(box(5)).toHaveFocus();
    expect(onComplete).not.toHaveBeenCalled();
    await user.keyboard("6");

    expect(boxes().map((box) => box.value)).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith("123456");
  });

  it("ignora letras ao digitar", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.type(screen.getByLabelText(LABEL), "1a2b3");

    expect(code()).toBe("123");
  });

  it("clicar numa caixa e digitar troca só aquele dígito", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<Harness initial="123456" onComplete={onComplete} />);

    await user.click(box(2));
    await user.keyboard("9");

    expect(code()).toBe("129456");
    expect(box(3)).toHaveFocus();
    expect(onComplete).toHaveBeenCalledWith("129456");
  });

  it("clicar numa caixa depois da próxima vazia leva o foco para a próxima vazia", async () => {
    const user = userEvent.setup();
    render(<Harness initial="12" />);

    await user.click(box(4));

    expect(box(2)).toHaveFocus();
  });

  it("Backspace apaga o dígito da caixa; em caixa vazia, apaga o anterior e volta", async () => {
    const user = userEvent.setup();
    render(<Harness initial="123" />);

    await user.click(box(3)); // vazia: cai na terceira (índice 2)... foco em 3 dígitos preenchidos
    await user.keyboard("{Backspace}");
    expect(code()).toBe("12");
    expect(box(2)).toHaveFocus();

    await user.click(box(0));
    await user.keyboard("{Backspace}");
    expect(code()).toBe("2"); // apagar o primeiro puxa os outros para a esquerda
  });

  it("setas movem o foco sem editar", async () => {
    const user = userEvent.setup();
    render(<Harness initial="123" />);

    await user.click(box(1));
    await user.keyboard("{ArrowLeft}");
    expect(box(0)).toHaveFocus();
    await user.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}");
    expect(box(3)).toHaveFocus(); // para na primeira caixa vazia
    expect(code()).toBe("123");
  });

  it("vários dígitos de uma vez numa caixa (preenchimento do sistema) preenchem o código", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<Harness onComplete={onComplete} />);

    const first = screen.getByLabelText(LABEL);
    await user.click(first);
    await user.paste("123456");

    expect(code()).toBe("123456");
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("colar '123 456 789' pelo teclado preenche 123456", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<Harness onComplete={onComplete} />);

    await user.click(screen.getByLabelText(LABEL));
    await user.paste("123 456 789");

    expect(code()).toBe("123456");
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("colar um código inteiro por cima de um completo troca tudo e completa", async () => {
    const user = userEvent.setup();
    const onComplete = vi.fn();
    render(<Harness onComplete={onComplete} initial="000000" />);

    await user.click(box(3));
    await user.paste("123 456");

    expect(code()).toBe("123456");
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith("123456");
  });

  it("botão 'Colar código' lê a área de transferência, preenche e completa uma vez", async () => {
    const user = userEvent.setup();
    mockClipboard(async () => "123-456");
    const onComplete = vi.fn();
    render(<Harness onComplete={onComplete} />);

    await user.click(await screen.findByRole("button", { name: "Colar código" }));

    expect(code()).toBe("123456");
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith("123456");
  });

  it("botão 'Colar código' por cima de um código completo troca o código", async () => {
    const user = userEvent.setup();
    mockClipboard(async () => "654321");
    const onComplete = vi.fn();
    render(<Harness onComplete={onComplete} initial="123456" />);

    await user.click(await screen.findByRole("button", { name: "Colar código" }));

    expect(code()).toBe("654321");
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith("654321");
  });

  it("colar texto curto preenche o que houver e não completa", async () => {
    const user = userEvent.setup();
    mockClipboard(async () => "12");
    const onComplete = vi.fn();
    render(<Harness onComplete={onComplete} />);

    await user.click(await screen.findByRole("button", { name: "Colar código" }));

    expect(code()).toBe("12");
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("colar texto sem dígitos mantém o que já estava digitado", async () => {
    const user = userEvent.setup();
    mockClipboard(async () => "abc");
    render(<Harness initial="12" />);

    await user.click(await screen.findByRole("button", { name: "Colar código" }));

    expect(code()).toBe("12");
  });

  it("leitura negada não quebra e foca a próxima caixa", async () => {
    const user = userEvent.setup();
    mockClipboard(async () => {
      throw new Error("NotAllowedError");
    });
    render(<Harness />);

    await user.click(await screen.findByRole("button", { name: "Colar código" }));

    expect(box(0)).toHaveFocus();
    expect(code()).toBe("");
  });

  it("sem leitura da área de transferência o botão não aparece", () => {
    const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    try {
      render(<Harness />);
      expect(screen.queryByRole("button", { name: "Colar código" })).not.toBeInTheDocument();
    } finally {
      if (original) Object.defineProperty(navigator, "clipboard", original);
      else Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("repassa invalid, describedBy e disabled a todas as caixas", async () => {
    userEvent.setup();
    render(<Harness invalid describedBy="x" disabled />);

    for (const box of boxes()) {
      expect(box).toHaveAttribute("aria-invalid", "true");
      expect(box).toHaveAttribute("aria-describedby", "x");
      expect(box).toBeDisabled();
    }
    expect(await screen.findByRole("button", { name: "Colar código" })).toBeDisabled();
  });
});
