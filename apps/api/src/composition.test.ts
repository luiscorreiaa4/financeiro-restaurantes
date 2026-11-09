import { describe, expect, it } from "vitest";
import { createAuthEmailSender } from "./composition";

describe("createAuthEmailSender", () => {
  it("em produção recusa o envio para arquivo (sem serviço de e-mail até a F8)", () => {
    expect(() =>
      createAuthEmailSender({ NODE_ENV: "production", DEV_MAIL_DIR: ".dev-mail" }),
    ).toThrow(/sem serviço de e-mail configurado \(F8\)/);
  });

  it("em desenvolvimento grava o código em arquivo", () => {
    const sender = createAuthEmailSender({ NODE_ENV: "development", DEV_MAIL_DIR: ".dev-mail" });
    expect(typeof sender.sendAccessCode).toBe("function");
  });
});
