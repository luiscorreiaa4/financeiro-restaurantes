import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const promptInstall = vi.fn();
vi.mock("@/lib/install-prompt", () => ({ promptInstall: () => promptInstall() }));

import { InstallDialog } from "./install-dialog";

beforeEach(() => promptInstall.mockReset());

describe("diálogo de instalação", () => {
  it("no iPhone mostra os passos do Safari", () => {
    render(<InstallDialog mode="ios" open onOpenChange={() => {}} />);
    expect(screen.getByRole("heading", { name: "Instalar o app" })).toBeInTheDocument();
    expect(
      screen.getByText(
        "Toque em Compartilhar (o quadrado com a seta) e depois em Adicionar à Tela de Início.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Instalar" })).not.toBeInTheDocument();
  });

  it("no modo manual manda usar o menu do navegador", () => {
    render(<InstallDialog mode="manual" open onOpenChange={() => {}} />);
    expect(
      screen.getByText("No menu do navegador, escolha Instalar app ou Adicionar à tela inicial."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Instalar" })).not.toBeInTheDocument();
  });

  it("no modo prompt, Instalar chama promptInstall e fecha se aceito", async () => {
    promptInstall.mockResolvedValue("accepted");
    const onOpenChange = vi.fn();
    render(<InstallDialog mode="prompt" open onOpenChange={onOpenChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Instalar" }));
    expect(promptInstall).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("no modo prompt, se o pedido for recusado o diálogo continua aberto", async () => {
    promptInstall.mockResolvedValue("dismissed");
    const onOpenChange = vi.fn();
    render(<InstallDialog mode="prompt" open onOpenChange={onOpenChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Instalar" }));
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
