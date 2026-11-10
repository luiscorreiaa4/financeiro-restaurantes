# F1c: Recuperação de senha, perfil e sessões (desenho)

> **Revisão de 09/11/2026 (DD-27):** a recuperação de senha passou de código de 6 dígitos para **link temporário** (uso único, 30 minutos), também no "Meu perfil". Onde este documento fala em código de recuperação, rotas `/password/code` e `/with-code` ou `email-otp/request-password-reset`, vale a DD-27 em `docs/decisoes.md` e o RF03 do `requisitos.md` v1.6. O login por código (RF02) não mudou.

> Aprovado pelo Luís em 09/11/2026. Próximo passo: `superpowers:writing-plans`.

Data: 09/11/2026. Etapa: F1c do painel (`docs/planos/painel.md`). Fluxo: Superpowers (DD-18).
Este documento **cita** RF/CA de `docs/requisitos.md` e não copia regra. Em conflito, vale `requisitos.md`.
Desenho-mãe: `docs/superpowers/specs/2026-11-07-f1-autenticacao-design.md` (F1a e F1b feitas em 09/11/2026).

## Intenção

Fechar a F1: quem esqueceu a senha (ou nunca definiu uma) recupera o acesso sozinho pelo e-mail, e o usuário logado cuida do próprio acesso (nome, senha, sessões abertas em outros aparelhos). Ao final, o "Pronto quando" da F1 do `painel.md` se cumpre inteiro e a F2 pode começar.

Requisitos: RF03 (R1 a R3, Obs1), RF02.R2 (orientação a quem não tem senha), R3, R8, Obs3 (menos a troca de e-mail), CA09; RNF01.R1 a R3; RNF04.R4 (auditoria). Critérios: RF03.CA01 a CA03, RF02.CA09.

## Objetivos

- **Recuperação** (`/recuperar-senha`, pública): e-mail → resposta sempre igual → código de 6 dígitos + nova senha + confirmação → "Senha alterada" → volta ao `/login` no modo senha com o e-mail preenchido. Encerra **todas** as sessões e envia aviso por e-mail (RF03.Obs1, CA02). Serve também para definir a primeira senha (CA01).
- **Link "Esqueci a senha"** no modo senha do `/login`, e a orientação do RF02.R2 ("Ainda não tem senha? Entre com código ou defina uma em Esqueci a senha"), texto fixo, sem revelar se o e-mail existe.
- **"Meu perfil"** (`/perfil`, logado), aberto por um menu do usuário na casca (desktop e celular), com três blocos:
  - Nome: alterar o próprio nome.
  - Senha: com senha definida, pede a senha atual (e oferece "Não lembro a senha atual: receber código"); sem senha, "Definir senha" pelo código. Ao concluir, encerra as **outras** sessões (CA09), mantém a atual, grava auditoria e envia o aviso por e-mail.
  - Sessões ativas: lista com aparelho legível ("Chrome no Android"), último uso e marca "esta sessão"; um único botão "Encerrar as outras sessões" (RF02.R8).
- **Lista de rotas permitidas** em `/api/auth/*`: só passam as rotas que o web usa (login por código e senha, envio de código, recuperação por código, sair, leitura de sessão se usada). Todo o resto (`update-user`, `change-email`, `change-password`, `list-sessions`, `revoke-*`, etc.) responde 404. Fecha a lacuna de hoje (todo `/api/auth/*` é repassado).

## Fora de escopo (decidido com o Luís)

- **Troca do próprio e-mail (RF02.Obs3, terceira parte):** adiada. Vira pendência em `andamento.md`, candidata a acompanhar a F6 (o Dono troca o e-mail do colaborador, RF05). A rota `change-email` fica fechada pela lista de permitidas.
- Encerrar uma sessão específica: não (só "encerrar as outras").
- Entrar logado direto ao fim da recuperação: não (volta ao login).
- Desativação de usuário encerrando sessões (RF02.R8 parte 2, CA07): já coberta pela checagem de vínculo ativo da F1a; a tela de desativar é da F6.
- Envio real de e-mail (F8, DD-21), `trustProxy`/IP real (F8), segundo fator e código por WhatsApp (v1.1).

## Anti-objetivos

- Revelar se um e-mail existe ou tem senha (RF03.R1, CA03; RF02.R1).
- Guardar ou logar senha, código ou e-mail em texto (RNF01.R1, CLAUDE.md regra 9). Auditoria usa `email_hash`, como hoje.
- Devolver ao navegador o token de outras sessões.
- Deixar rotas do Better Auth abertas sem regra nossa.
- Encerrar a sessão atual na troca de senha pelo perfil (CA09 fala das **outras**).

## Decisões do Luís (09/11/2026)

1. Troca de e-mail **adiada**.
2. Fim da recuperação **volta ao login** (modo senha, e-mail preenchido).
3. Sessões: **só "encerrar as outras"**.
4. **Abordagem B** (abaixo): rotas próprias de perfil.
5. **Conflito RF02.R8 × CA09 resolvido:** trocar a senha pelo perfil encerra as **outras** sessões e mantém a atual. O R8 é corrigido para "as outras" em `requisitos.md` (versão 1.5), com DD nova em `decisoes.md`. Na recuperação, sem login, todas caem.

## Chamadas minhas (para o Luís conferir)

- `/recuperar-senha` como página própria (não um terceiro modo do `/login`); e-mail levado ao login por `sessionStorage`, não pela URL.
- Senha atual errada no perfil **não** conta para o bloqueio de 5 erros do RF02.R7 (o bloqueio é do login).
- `describeDevice` por heurística simples, sem biblioteca nova.
- Aviso por e-mail num método novo da porta (`sendSecurityNotice`), separado do envio de código.
- Evento de auditoria também para troca de nome (barato, ajuda o suporte).
- Recuperação só envia código a quem tem vínculo ativo (já é o comportamento do `hasActiveMembership`).

## Abordagens consideradas

| | Descrição | Troca |
|---|---|---|
| A | Web chama direto `change-password`, `update-user`, `list-sessions`, `revoke-other-sessions` do Better Auth; regras nos ganchos `before`/`after` de `create-auth.ts` | Menos rotas; ganchos (já ~400 linhas de desvios por caminho) crescem; `list-sessions` devolve dados crus com token; sem contrato Zod nosso |
| **B (escolhida)** | Rotas `/api/profile/*` com Zod, chamando o Better Auth só no servidor (`auth.api.*`); auditoria e aviso dentro de cada rota; lista de permitidas fecha o resto de `/api/auth/*` | Mais rotas, mas contrato explícito, resposta pronta para a tela, mesmo padrão do cadastro (F1b) e casos claros nos testes |

A recuperação, nas duas, usa o caminho nativo `forget-password` do `emailOTP`, que já está ligado: anti-enumeração, limites de envio (`reserveOtpSend`), `validatePassword` no `before`.

## Desenho

### Banco (`packages/db`)

- Migration nova (gerada pelo drizzle-kit e revisada): eventos novos no CHECK de `auth_audit.event` (`AUTH_EVENTS` em `packages/db/schema/auth.ts`): `password_reset` (recuperação), `password_changed` (perfil, com senha atual ou código), `password_set` (primeira senha pelo perfil, se o builder separar de `password_changed`), `other_sessions_revoked`, `name_changed` (opcional, chamada minha: barato e útil para suporte). Nada de tabela nova.
- `AuthStore` (`packages/db/src/auth-store.ts`) ganha só o que faltar (por exemplo, `hasPassword(userId)`, listar sessões do usuário com `id, user_agent, ip_address, updated_at, created_at`, revogar as outras). Grants do `app_auth` só se faltarem (menor privilégio).

### Core (`packages/core`)

- `describeDevice(userAgent)`: função pura e testada que devolve rótulo em pt-BR ("Chrome no Android", "Safari no iPhone", "Navegador desconhecido"). Heurística simples, sem dependência nova (chamada minha).
- Regra "nova senha diferente da atual" (RF03.R3) junto do `validatePassword` (`packages/core/src/auth/auth-policy.ts`), como erro nomeado.
- Porta `EmailSender` (`packages/core/src/ports/ports.ts`): método novo para aviso de segurança (`sendSecurityNotice({ to, kind: "password-changed" })` ou nome equivalente), separado de `sendAccessCode`. Texto do aviso: data/hora em `America/Sao_Paulo`, orientação para procurar o suporte se não foi a pessoa (RF03.Obs1). Fakes em memória e em arquivo atualizados.

### API (`apps/api`)

- **Lista de permitidas** em `apps/api/src/http/auth/auth-routes.ts`: substitui o repasse de todo `/api/auth/*`. `OPEN_PATHS` continua valendo para rotas sem sessão.
- **Recuperação** (rotas nativas, já liberadas): `POST /api/auth/email-otp/request-password-reset` (ou `forget-password/email-otp`, o que o web usar) e `POST /api/auth/email-otp/reset-password`. Ajustes nos ganchos:
  - `before` de reset: rejeitar nova senha igual à atual (RF03.R3).
  - Encerrar **todas** as sessões ao concluir (⚠️ conferir `emailAndPassword.revokeSessionsOnPasswordReset` no Better Auth 1.7.18 e se vale para o `emailOTP`; senão, revogar no `after`).
  - `after`: auditoria `password_reset` e aviso por e-mail, só em sucesso. Falha de código segue as mensagens já traduzidas em `auth-messages.ts`.
- **Perfil** (`/api/profile/*`, todas atrás de `requireSession`, Zod na entrada e saída):
  - `GET /api/profile`: nome, e-mail, `hasPassword`, sessões (id opaco, rótulo do aparelho, último uso, `current`). Nunca o token.
  - `PATCH /api/profile/name`.
  - `POST /api/profile/password` com `{ currentPassword, newPassword }`: chama o Better Auth no servidor com `revokeOtherSessions: true`, auditoria e aviso. Senha atual errada → "Senha atual incorreta." Não conta para o bloqueio do RF02.R7 (chamada minha; o bloqueio é do login).
  - `POST /api/profile/password/code`: envia código ao e-mail da sessão, pelos mesmos limites do RF02.R4 (`decideOtpSend`/`reserveOtpSend`).
  - `POST /api/profile/password/with-code` com `{ code, newPassword }`: valida e consome o código (6 dígitos, 5 min, 3 tentativas), grava a senha (definir ou trocar), encerra as outras sessões e mantém a atual, auditoria e aviso. Como verificar e consumir o código e como gravar a senha no servidor fica com o builder (opções: tipo `forget-password` do `emailOTP` via `auth.api.*`, ou adaptador interno), desde que respeite RF02.R4 e não derrube a sessão atual.
  - `POST /api/profile/sessions/revoke-others`: auditoria `other_sessions_revoked`.

### Web (`apps/web`)

- `/recuperar-senha` em `app/(public)/`, adicionada a `PUBLIC_PAGES` em `apps/web/proxy.ts`. Mesmo estilo do `LoginForm` (`features/auth/login-form.tsx`: `useState`, `Button`/`Input`/`Label` do shadcn, erro em `role="alert"`, contagem de 60 s para reenviar). Ao concluir, guarda o e-mail em `sessionStorage` (não na URL) e vai para `/login` no modo senha; o `LoginForm` lê e preenche (chamada minha).
- `LoginForm`: link "Esqueci a senha" e a orientação do RF02.R2 no modo senha.
- Casca (`components/app-shell.tsx`): menu do usuário com nome, "Meu perfil" e "Sair" (o `SignOutButton` atual entra no menu), no desktop e na folha do celular.
- `/perfil` em `app/(app)/`: leitura inicial no servidor via `lib/api` com a sessão; mutações pelo navegador, invalidando a query do perfil. Sem `use cache` (dado de usuário).
- `features/profile/*` para os formulários; nada de react-hook-form ainda (segue o padrão atual).
- `fake-api.mjs` do E2E ganha as rotas novas (recuperação e perfil).

### Testes

- **Core (Vitest, sem mocks):** `describeDevice`, regra "senha igual à atual".
- **Integração da API (Testcontainers, relógio e e-mail injetados), no padrão de `apps/api/test/auth-login.int.test.ts`:**
  - RF03.CA01: usuário sem senha conclui a recuperação e entra com senha.
  - RF03.CA02: sessão antiga recusada depois da recuperação; aviso enviado.
  - RF03.CA03: e-mail desconhecido → mesma resposta, nenhum e-mail.
  - RF03.R3: nova senha igual à atual recusada.
  - RF02.CA09: troca pelo perfil encerra as outras sessões e mantém a atual (com senha atual e com código).
  - Lista de sessões não traz token; "encerrar as outras" mantém a atual.
  - Rotas fora da lista de permitidas respondem 404 (ex.: `update-user`, `change-email`, `list-sessions`).
  - Rotas de perfil sem sessão → 401 (RF02.CA08).
  - Auditoria gravada para cada evento, sem senha nem e-mail em claro; logs sem segredo.
- **E2E (Playwright, desktop e Pixel 7, API falsa):** recuperação completa até entrar com a nova senha; perfil (trocar nome, trocar senha, encerrar outras sessões); link "Esqueci a senha" no login.

## Fica a cargo de quem implementa

- Nomes exatos dos eventos de auditoria e do método da porta de e-mail.
- Como verificar/consumir o código e gravar a senha no `with-code` (ver acima).
- Lista exata de rotas permitidas, a partir do que o web chama de fato.
- Formato da resposta de `GET /api/profile`, desde que sem token.
- Textos de tela e de e-mail em pt-BR (RNF09).

## Riscos e pontos a confirmar

- ⚠️ `revokeSessionsOnPasswordReset` e o comportamento de `resetPassword` do `emailOTP` no Better Auth 1.7.18.
- ⚠️ `auth.api.changePassword` com `revokeOtherSessions` chamado no servidor com os headers da sessão (o teste da F1a em `auth-login.int.test.ts` ~L410 já usa a rota; conferir a chamada pelo servidor).
- O limite por IP continua global atrás do rewrite até a F8 (pendência já aberta).
- **Pendências de decisão que sobraram da F1c (09/11/2026, detalhe em `docs/planos/andamento.md`):** (1) a auditoria que falha depois de gravar a senha ou o nome devolve erro ao usuário mesmo com a troca feita; (2) no login por código (F1a), `TOO_MANY_ATTEMPTS` e `OTP_EXPIRED` permitem descobrir se um e-mail tem conta; a recuperação por link (DD-27) não tem esse problema.


## Fechamento (ao terminar a F1c)

- `painel.md`: F1c "Feita", "Atualizado em"; F1 inteira cumprida.
- `andamento.md`: F1c feita; pendência nova "troca do próprio e-mail (RF02.Obs3), adiada da F1c"; pendências da F1c.
- `arquitetura.md`: eventos novos de `auth_audit` e rotas `/api/profile/*`.
- `CLAUDE.md` (Estado atual): próxima etapa F2.
- Decisão registrada em `decisoes.md` (DD nova: troca de e-mail adiada; rotas próprias de perfil e lista de permitidas no `/api/auth/*`; RF02.R8 alinhado ao CA09) e `requisitos.md` v1.5 com o R8 corrigido. Isso entra **no início** da implementação (regra de manutenção do `CLAUDE.md`: decisão primeiro em `decisoes.md`/`requisitos.md`).
- Verificação: `pnpm typecheck && pnpm lint && pnpm test`, integração e E2E; roteiro à mão: `pnpm dev`, "Esqueci a senha" em `/login`, ler código em `DEV_MAIL_DIR`, trocar a senha, entrar; no `/perfil`, trocar nome e senha com duas abas/navegadores e ver a outra sessão cair.
