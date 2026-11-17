import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BlockBoundary } from "./block-boundary";

function Boom(): never {
  throw new Error("falha do bloco");
}

describe("fronteira de erro por bloco (RF27.Obs3)", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("um bloco que lança mostra a falha só nele, e o vizinho renderiza", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <BlockBoundary title="Receita × despesa">
          <Boom />
        </BlockBoundary>
        <BlockBoundary title="Resultado">
          <p>vizinho ok</p>
        </BlockBoundary>
      </QueryClientProvider>,
    );
    expect(screen.getByRole("alert").textContent).toContain("Receita × despesa");
    expect(screen.getByText("vizinho ok")).toBeDefined();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("a mensagem de erro não mostra o texto da exceção", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <BlockBoundary title="Resultado">
          <Boom />
        </BlockBoundary>
      </QueryClientProvider>,
    );
    expect(screen.getByRole("alert").textContent).not.toContain("falha do bloco");
  });
});
