> **Substituído (09/11/2026):** o campo foi refeito com seis `<input>` próprios, sem a biblioteca `input-otp`, para permitir editar cada caixa e alinhar no celular. Este documento fica como registro.

# Campo de código (OTP) em 6 caixinhas: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar os dois campos de código de 6 dígitos do painel (login e autocadastro) por seis caixinhas com teclado numérico, botão de colar e envio automático.

**Architecture:** O `input-otp` do shadcn entra em `components/ui/`. Um invólucro `OtpCodeField` em `components/` concentra rótulo, caixinhas, botão de colar e a limpeza do texto colado. As duas telas só trocam o campo e ligam o `onComplete` ao envio que já existe.

**Tech Stack:** Next.js (App Router), shadcn `base-nova`, Tailwind, Vitest + Testing Library (jsdom), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-09-campo-otp-seis-caixas-design.md`

## Global Constraints

- Leia `apps/web/CLAUDE.md` antes de mexer.
- Rótulo acessível exatamente `Código de 6 dígitos`; botão exatamente `Colar código`.
- 6 dígitos, só `0-9`, dois grupos de três.
- `inputMode="numeric"`, `autoComplete="one-time-code"`, nunca `type="number"`.
- Cores só pelos tokens de `app/globals.css` (D-F8). Sem paleta ou fonte nova.
- Testes selecionam por papel e rótulo, não por classe CSS.
- Componente de `components/ui/` adicionado com `pnpm dlx shadcn@latest add`, dentro de `apps/web`, sem `--overwrite`.
- Nada de API muda. Commits em Conventional Commits.

## Review Focus

1. Envio duplo: sexto dígito e clique em "Entrar" quase juntos devem gerar uma chamada só (são 3 tentativas).
2. Colar texto sem dígitos suficientes ("abc", "12") não deve disparar envio nem apagar o que já estava digitado de forma inesperada: preenche o que houver de dígitos.
3. Permissão de área de transferência negada (`readText` rejeita): o botão não quebra a tela nem mostra erro técnico; o campo ganha foco para a pessoa colar à mão.
4. Depois de erro (`INVALID_OTP`), o campo aceita novo código e envia de novo ao completar; em `OTP_EXPIRED`/`TOO_MANY_ATTEMPTS` o campo é limpo como hoje.
5. Tela de 360 px: seis caixinhas, separador e botão cabem sem rolagem horizontal.

---

### Task 1: `OtpCodeField`

**Files:**
- Create: `apps/web/components/ui/input-otp.tsx` (gerado)
- Create: `apps/web/components/otp-code-field.tsx`
- Test: `apps/web/components/otp-code-field.test.tsx`
- Modify: `apps/web/package.json` (dependência trazida pelo shadcn)

**Interfaces:**
- Produces:

```ts
export function sanitizeOtp(text: string): string; // só dígitos, no máximo 6

export type OtpCodeFieldProps = {
  id: string;
  label?: string;            // padrão "Código de 6 dígitos"
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void; // chamado uma vez quando chega a 6 dígitos
  disabled?: boolean;
  invalid?: boolean;          // vira aria-invalid
  describedBy?: string;       // vira aria-describedby
  ref?: React.Ref<HTMLInputElement>;
};
export function OtpCodeField(props: OtpCodeFieldProps): React.JSX.Element;
```

- [ ] **Step 1: Instalar o componente.** Em `apps/web`: `pnpm dlx shadcn@latest add input-otp`. Leia o arquivo gerado e anote se ele usa a biblioteca `input-otp` ou o OTP Field do Base UI; o contrato acima vale nos dois casos. Se o jsdom reclamar de `ResizeObserver` ou `document.elementFromPoint`, adicione o stub no setup de testes do Vitest do web.

- [ ] **Step 2: Escrever os testes que falham** em `otp-code-field.test.tsx`:

```tsx
it("sanitizeOtp mantém só dígitos e corta em 6", () => {
  expect(sanitizeOtp("123 456")).toBe("123456");
  expect(sanitizeOtp("123-456-789")).toBe("123456");
  expect(sanitizeOtp("abc")).toBe("");
});

it("tem um único campo com o rótulo, numérico e de código único", () => {
  // render com value="" 
  const input = screen.getByLabelText("Código de 6 dígitos");
  expect(input).toHaveAttribute("inputmode", "numeric");
  expect(input).toHaveAttribute("autocomplete", "one-time-code");
  expect(input).not.toHaveAttribute("type", "number");
});

it("digitar 6 dígitos chama onComplete uma vez com o código", async () => {
  // componente controlado num wrapper com useState
  await user.type(screen.getByLabelText("Código de 6 dígitos"), "123456");
  expect(onComplete).toHaveBeenCalledTimes(1);
  expect(onComplete).toHaveBeenCalledWith("123456");
});

it("ignora letras ao digitar", async () => {
  await user.type(input, "1a2b3");
  expect(input).toHaveValue("123");
});

it("colar '123 456' pelo teclado preenche 123456", async () => {
  await user.click(input); await user.paste("123 456");
  expect(input).toHaveValue("123456");
});

it("botão Colar código lê a área de transferência, preenche e completa", async () => {
  // navigator.clipboard.readText = vi.fn().mockResolvedValue("123-456")
  await user.click(screen.getByRole("button", { name: "Colar código" }));
  expect(input).toHaveValue("123456");
  expect(onComplete).toHaveBeenCalledTimes(1);
});

it("colar texto curto preenche o que houver e não completa", async () => {
  // readText -> "12"
  expect(input).toHaveValue("12"); expect(onComplete).not.toHaveBeenCalled();
});

it("readText rejeitado não quebra e foca o campo", async () => {
  // readText -> rejects
  expect(input).toHaveFocus();
});

it("sem navigator.clipboard.readText o botão não aparece", () => {
  expect(screen.queryByRole("button", { name: "Colar código" })).toBeNull();
});

it("repassa invalid, describedBy e disabled", () => {
  expect(input).toHaveAttribute("aria-invalid", "true");
  expect(input).toHaveAttribute("aria-describedby", "x");
  // com disabled: campo e botão desabilitados
});
```

- [ ] **Step 3: Rodar e ver falhar.** `pnpm --filter @app/web test -- otp-code-field`. Esperado: FAIL (módulo não existe).

- [ ] **Step 4: Implementar `otp-code-field.tsx`** (`"use client"`). Seis caixinhas em dois grupos de três com separador; `Label` de `@/components/ui/label` ligado pelo `id`; botão `Button` variante discreta com ícone `ClipboardPaste` do `lucide-react` e texto `Colar código`, `type="button"`. A disponibilidade de `readText` é detectada depois da montagem (efeito), para não divergir do HTML do servidor. Texto digitado e colado passa por `sanitizeOtp`. O botão chama `onChange` e, com 6 dígitos, `onComplete`; garanta que `onComplete` não dispare duas vezes para o mesmo preenchimento (o componente interno já pode avisar ao completar). As caixinhas usam largura flexível com limite, para caber em 360 px.

- [ ] **Step 5: Rodar e ver passar.** `pnpm --filter @app/web test -- otp-code-field`. Esperado: PASS.

- [ ] **Step 6: Commit.** `feat(web): campo de código em 6 caixinhas com botão de colar`

### Task 2: Login por código

**Files:**
- Modify: `apps/web/features/auth/login-form.tsx` (campo em ~187-203, `onSubmit` em ~133-143)
- Test: `apps/web/features/auth/login-form.test.tsx`
- Test: `apps/web/e2e/login.spec.ts`

**Interfaces:**
- Consumes: `OtpCodeField` da Task 1.

- [ ] **Step 1: Testes que falham** em `login-form.test.tsx`:

```tsx
it("envia sozinho ao completar o sexto dígito", async () => {
  // chegar ao passo do código como os testes atuais fazem
  await user.type(await screen.findByLabelText("Código de 6 dígitos"), "123456");
  expect(auth.signInWithCode).toHaveBeenCalledTimes(1);
  expect(auth.signInWithCode).toHaveBeenCalledWith(
    expect.objectContaining({ otp: "123456" }),
  );
});

it("não envia duas vezes se clicar em Entrar durante o envio automático", async () => {
  // signInWithCode devolve promessa pendente; digitar 6 dígitos e clicar em "Entrar"
  expect(auth.signInWithCode).toHaveBeenCalledTimes(1);
});

it("depois de código inválido, completar um novo código envia de novo", async () => {
  // 1ª chamada -> INVALID_OTP; apagar, digitar outro código
  expect(auth.signInWithCode).toHaveBeenCalledTimes(2);
});

it("respeita 'manter conectado' marcado antes de completar", async () => {
  expect(auth.signInWithCode).toHaveBeenCalledWith(
    expect.objectContaining({ rememberMe: true }),
  );
});
```

- [ ] **Step 2: Rodar e ver falhar.** `pnpm --filter @app/web test -- login-form`.

- [ ] **Step 3: Trocar o campo.** Substitua o bloco `Label` + `Input` do OTP por `<OtpCodeField id="login-otp" ref={otpRef} value={otp} onChange={setOtp} onComplete={...} invalid={invalid} describedBy={describedBy} />`. Extraia do `onSubmit` a função que chama `auth.signInWithCode` para que o formulário e o `onComplete` usem a mesma, recebendo o código como argumento (o estado ainda pode não ter atualizado). Proteja com uma trava de envio em andamento (ref), além do estado de carregamento que já existir. Mantenha a limpeza do campo em `OTP_EXPIRED`/`TOO_MANY_ATTEMPTS` e o foco ao enviar o código.

- [ ] **Step 4: Ajustar testes atuais** do arquivo que mudarem de comportamento por causa do envio automático (os que digitam 6 dígitos e depois clicam em "Entrar" passam a esperar uma chamada só). Não enfraqueça asserções.

- [ ] **Step 5: E2E.** Em `login.spec.ts`, depois de `getByLabel("Código de 6 dígitos").fill(CODE)`, o login deve concluir sem clicar em "Entrar" (remova o clique no caminho feliz; mantenha um cenário em que o clique ainda funciona, o de erro com `000000`, aceitando que o envio automático já tenha mostrado o erro). Acrescente no passo do código: `expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)`.

- [ ] **Step 6: Rodar.** `pnpm --filter @app/web test -- login-form` e `pnpm --filter @app/web test:e2e -- login`. Esperado: PASS nos dois projetos (`Desktop Chrome`, `Pixel 7`).

- [ ] **Step 7: Commit.** `feat(web): login por código com 6 caixinhas e envio automático (RF02)`

### Task 3: Autocadastro

**Files:**
- Modify: `apps/web/features/signup/signup-flow.tsx` (campo em ~239-252, `confirmCode` em ~123-150)
- Test: `apps/web/features/signup/signup-flow.test.tsx`
- Test: `apps/web/e2e/signup.spec.ts`

**Interfaces:**
- Consumes: `OtpCodeField` da Task 1.

- [ ] **Step 1: Testes que falham** em `signup-flow.test.tsx`:

```tsx
it("confirma sozinho ao completar o sexto dígito", async () => {
  await user.type(await screen.findByLabelText("Código de 6 dígitos"), "123456");
  expect(client.verifyCode).toHaveBeenCalledTimes(1);
  expect(client.verifyCode).toHaveBeenCalledWith(expect.any(String), "123456");
});

it("não confirma duas vezes se clicar em Confirmar código durante o envio", async () => {
  expect(client.verifyCode).toHaveBeenCalledTimes(1);
});

it("campo e botão de colar ficam desabilitados quando bloqueado", async () => {
  // após TOO_MANY_ATTEMPTS
  expect(screen.getByLabelText("Código de 6 dígitos")).toBeDisabled();
});
```

- [ ] **Step 2: Rodar e ver falhar.** `pnpm --filter @app/web test -- signup-flow`.

- [ ] **Step 3: Trocar o campo.** Substitua o `TextField` do código por `<OtpCodeField id="signup-code" ref={codeRef} value={code} onChange={setCode} onComplete={...} disabled={blocked} invalid={codeInvalid} describedBy={codeInvalid ? "signup-code-alert" : undefined} />`. `confirmCode` passa a aceitar o código como argumento opcional (padrão: o estado) e ganha a mesma trava de envio em andamento. A validação `INCOMPLETE_CODE` do clique continua.

- [ ] **Step 4: Ajustar testes atuais** afetados pelo envio automático, sem enfraquecer asserções.

- [ ] **Step 5: E2E.** Em `signup.spec.ts`, o passo do código conclui sem clicar em "Confirmar código"; acrescente a mesma checagem de rolagem horizontal da Task 2.

- [ ] **Step 6: Rodar tudo.** `pnpm --filter @app/web test`, `pnpm --filter @app/web test:e2e`, depois `pnpm typecheck && pnpm lint`. Esperado: tudo verde.

- [ ] **Step 7: Commit.** `feat(web): código do autocadastro com 6 caixinhas e envio automático (RF01)`
