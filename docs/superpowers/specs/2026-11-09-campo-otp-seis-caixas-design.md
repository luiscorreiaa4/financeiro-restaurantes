> **Substituído (09/11/2026):** o campo foi refeito com seis `<input>` próprios, sem a biblioteca `input-otp`, para permitir editar cada caixa e alinhar no celular. Este documento fica como registro.

# Campo de código (OTP) em 6 caixinhas

Data: 09/11/2026. Aprovado pelo Luís em 09/11/2026. Mudança pequena de interface no painel; não altera regra de negócio (RF02 e RF01 seguem como estão).

## Intenção

Digitar o código de 6 dígitos enviado por e-mail fica mais fácil e mais claro: seis caixinhas em vez de um campo só, teclado numérico no celular e um botão para colar.

## Onde

Só existem dois campos de código no painel:

- Login por código: `apps/web/features/auth/login-form.tsx`
- Autocadastro (inclui "Criar outra empresa"): `apps/web/features/signup/signup-flow.tsx`

A recuperação de senha e o "Meu perfil" usam link temporário (DD-26, DD-27), não código. Ficam de fora.

## Objetivos

- Seis caixinhas, em dois grupos de três (`000 000`).
- Só dígitos. `inputMode="numeric"` e `autoComplete="one-time-code"`: teclado numérico no celular e sugestão do código pelo sistema.
- Sem setinhas de campo numérico no desktop (o campo é de texto, não `type="number"`).
- Botão "Colar código", no celular e no desktop, escondido quando o navegador não oferece `navigator.clipboard.readText`. Colar "123 456" ou "123-456" preenche `123456`; Ctrl+V continua funcionando.
- Envio automático ao completar o sexto dígito (digitado ou colado). Os botões "Entrar" e "Confirmar código" continuam.
- Estados de erro (`aria-invalid`, `aria-describedby`) e desabilitado preservados.
- Rótulo acessível "Código de 6 dígitos" mantido, para os testes atuais continuarem selecionando por rótulo.

## Fora do escopo

- Mudar tamanho, validade ou número de tentativas do código (API).
- Trocar a recuperação de senha para código.
- Identidade visual: só tokens de `app/globals.css` (D-F8).

## O que seria um fracasso

- Envio automático disparar duas vezes (dígito + clique) e gastar duas das 3 tentativas.
- Rolagem horizontal no celular.
- Campo que o leitor de tela anuncia como seis campos sem rótulo.

## Abordagens

1. **shadcn `input-otp`** (`pnpm dlx shadcn@latest add input-otp` em `apps/web`). Escolhida: é o caminho que o projeto já usa para `components/ui/`, a biblioteca por baixo tem um único campo real (rótulo, colar e preenchimento automático funcionam) e é a base de outras bibliotecas conhecidas.
2. **boardui** (sugestão inicial). Descartada: não foi encontrada fonte oficial confiável.
3. **Implementação própria com seis `<input>`**. Descartada: foco, colar, apagar e preenchimento automático do sistema são difíceis de acertar, e seis campos pioram a acessibilidade.

## Desenho

- `components/ui/input-otp.tsx`: gerado pelo shadcn, sem edição além do necessário.
- `components/otp-code-field.tsx` (novo, com teste ao lado): recebe `id`, `label`, `value`, `onChange`, `onComplete`, `disabled`, `invalid`, `describedBy` e `ref`. Renderiza o rótulo, as caixinhas e o botão de colar. A limpeza do texto colado (só dígitos, até 6) fica aqui, numa função pura testada.
- `login-form.tsx` e `signup-flow.tsx` trocam o campo atual pelo `OtpCodeField`. `onComplete` chama o mesmo caminho do botão de enviar, protegido contra envio em andamento.

## Fica a cargo de quem implementa

- Se o `input-otp` do preset `base-nova` vier sobre a biblioteca `input-otp` ou sobre o OTP Field do Base UI, adaptar o invólucro; o contrato do `OtpCodeField` não muda.
- Ajustes nos testes existentes que usam `user.type` ou `fill` no campo, se o comportamento do componente exigir.

## Testes

- Vitest: `OtpCodeField` (digitar, colar com espaço e hífen, botão de colar, botão escondido sem a API, `onComplete` uma única vez).
- Vitest das duas telas: envio automático e sem envio duplo.
- Playwright (`login.spec.ts`, `signup.spec.ts`), em `Desktop Chrome` e `Pixel 7`: fluxo completo e ausência de rolagem horizontal.
