import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildWhatsappLink, Welcome } from "./welcome";

describe("boas-vindas depois do cadastro", () => {
  it('welcome shows the wa.me link built from the env number, a QR code and a "Ir para o painel" button', () => {
    render(<Welcome whatsappNumber="+55 (82) 99999-0000" />);

    expect(screen.getByRole("link", { name: /Abrir o WhatsApp/ })).toHaveAttribute(
      "href",
      "https://wa.me/5582999990000",
    );
    expect(screen.getByRole("img", { name: /QR Code/ })).toBeInTheDocument();
    expect(screen.getByText("+55 (82) 99999-0000")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ir para o painel" })).toHaveAttribute("href", "/");
  });

  it("without a configured number shows a message instead of a broken link", () => {
    render(<Welcome whatsappNumber={undefined} />);

    expect(screen.queryByRole("link", { name: /Abrir o WhatsApp/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("img", { name: /QR Code/ })).not.toBeInTheDocument();
    expect(screen.getByText(/ainda não foi configurado/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Ir para o painel" })).toBeInTheDocument();
  });
});

describe("buildWhatsappLink", () => {
  it("keeps only the digits", () => {
    expect(buildWhatsappLink("+55 (82) 99999-0000")).toBe("https://wa.me/5582999990000");
    expect(buildWhatsappLink("5511988887777")).toBe("https://wa.me/5511988887777");
  });
});
