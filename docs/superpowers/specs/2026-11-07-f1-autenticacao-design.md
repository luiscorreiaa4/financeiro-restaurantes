# F1: Autenticação e sessão (desenho)

Data: 07/11/2026. Etapa: F1 do painel (`docs/planos/painel.md`). Fluxo: Superpowers (DD-18).
Este documento **cita** RF/CA de `docs/requisitos.md` e não copia regra. Em conflito, vale `requisitos.md`.

## Intenção

Abrir a porta do painel: o dono se cadastra sozinho, entra por código de e-mail ou por senha, recupera o acesso, e um e-mail desconhecido recebe a mesma resposta de um conhecido. Sem isso nenhuma outra etapa do painel (F2 a F13) começa.

Requisitos: RF01 (autocadastro), RF02 (acesso e sessão), RF03 (recuperação), RNF01 (credenciais e sessão), RNF04.R4 (auditoria). Critérios: RF01.CA01 a CA10, RF02.CA01 a CA09, RF03.CA01 a CA03.

## Objetivos

- Better Auth na API Fastify, com `rewrites` no web para o cookie ser de primeira parte (D-F1).
- Código (modo padrão da tela) e senha (D-F5, RF02.R2).
- Autocadastro atômico (RF01.Obs2) e recuperação (RF03).
- Leitura da sessão no servidor em um único lugar (`lib/auth/session.ts`) e API que recusa chamada sem sessão mesmo se o `proxy.ts` for contornado (RF02.CA08).

## Fora de escopo

- Código por WhatsApp e segundo fator do dono (v1.1).
- Seletor de empresa e unidade, permissões e `can()` na navegação (F2).
- Convite de colaboradores e do contador (F6, F13). O desenho só deixa `phone_e164` opcional para não travar o contador.
- Envio real de e-mail, domínio, SPF, DKIM e DMARC (F8, RNF10.R4).
- Assinatura e planos (F9). A conta nasce `TESTE` e `ATIVA` com valores provisórios (P03).

## Anti-objetivos

- Revelar se um e-mail ou celular existe (RF02.R1, RF01.R11/CA05, RF03.R1).
- Guardar senha em texto puro ou logar código, senha, e-mail ou celular em log (CLAUDE.md, regra 9).
- Duas fontes de verdade para o usuário.
- Cadastro parcial no banco (RF01.CA08).

## Decisões do Luís (07/11/2026)

1. **E-mail com envio falso na F1.** O código sai por uma porta `EmailSender` com implementação de desenvolvimento. O serviço real e o domínio ficam para a F8.
2. **A F1 se divide em três partes:** F1a prova de conceito mais login por código e senha; F1b autocadastro transacional; F1c recuperação, perfil e sessões.
3. **Better Auth sobre `users` (caminho A).** `users` vira a tabela de usuário do Better Auth por mapeamento de nomes e campos.
4. **`users.phone_e164` passa a ser opcional** (continua único quando existe), já na F1a. Dono e colaboradores do WhatsApp continuam obrigatórios por regra de domínio; o contador não. Fecha a pendência da E11.
5. **A prova de conceito é descartável**, em branch separada. Só o aprendizado volta; o código definitivo nasce com TDD na F1a.

## Abordagens consideradas

| | Descrição | Troca |
|---|---|---|
| **A (escolhida)** | `users` é o usuário do Better Auth; criamos `sessions`, `accounts` e `verifications` no drizzle-kit; conexão com papel `app_auth` sem `app.tenant_id` | Uma só fonte do usuário e `entries.created_by` intacto. Risco: o mapeamento pode exigir ajustes (a prova mede) |
| B | Schema padrão do Better Auth mais ligação com `users` | Mapeamento simples, mas duas pessoas por usuário e reconciliação com o telefone do WhatsApp |
| C | Banco ou schema separado | Isola, mas foge da revisão do SQL no drizzle-kit e dos testes de isolamento por tabela |

Se a prova de conceito mostrar que A não fecha, a alternativa é B, sem perder o resto do desenho.

## Desenho

### Banco

- Migration nova gerada pelo drizzle-kit e revisada, com RLS conforme o padrão do repositório e teste de isolamento para as tabelas novas.
- `users`: `phone_e164` opcional; campos exigidos pelo Better Auth (e-mail verificado, imagem se necessário), `password_hash` em `accounts`, e campos de RF02 (último acesso, bloqueio da senha até quando, contagem de erros).
- `sessions`, `accounts`, `verifications`: tabelas globais (sem `tenant_id`), acessadas só pelo papel `app_auth`. IDs UUID v7.
- `tenants` e `users` ganham os campos de RF01 que faltam (CNPJ único fora de ENCERRADA, segmento, situação, aceite dos termos com data e versões) na F1b.
- `auth_audit` (ou equivalente) para login, bloqueio e troca de senha ou e-mail, com IP e dispositivo, sem segredo (RNF04.R4).

### API (Fastify)

- Better Auth montado em `/api/auth/*`, com plugin `emailOTP` e `disableSignUp: true`: o login comum nunca cria usuário.
- `POST /api/signup` próprio (F1b): e-mail verificado antes; uma transação cria tenant, unidade, dono, vínculo com todas as unidades, formas de pagamento e canais padrão (RF01.Obs2).
- Limites de envio e tentativas conforme RF02.R4/R7, usando relógio injetado para teste.
- Resposta idêntica para e-mail desconhecido ou sem vínculo ativo, e nenhum e-mail enviado nesse caso (RF02.CA02).
- Todas as rotas protegidas leem a sessão por uma função única; sem sessão, recusam.

### Web (Next.js)

- `rewrites` de `/api/*` já existe da F0; `proxy.ts` redireciona quem não tem cookie; autoridade real é a API.
- Telas: acesso (abre em código, oferece "Entrar com senha"), cadastro, recuperação, perfil.
- Estados de erro previstos: código errado, expirado, excesso de tentativas, senha bloqueada.
- `lib/auth/session.ts` como ponto único de leitura da sessão no servidor.

### Partes

- **F1a:** prova de conceito descartável (mapeamento de `users`, RLS com `app_auth`, cookie via `rewrites`, `emailOTP`, relógio injetado); depois a migration, o Better Auth, o login por código e por senha, a porta `EmailSender`, `lib/auth/session.ts`, o `proxy.ts`, logout e a auditoria básica. Pronto quando um usuário seed entra por código e por senha e a API recusa chamada sem sessão.
- **F1b:** campos de RF01 em `tenants`/`users`, `POST /api/signup` atômico, telas de cadastro, CNPJ único em cadastros simultâneos. Pronto quando um dono se cadastra sozinho (CA04, CA07, CA08).
- **F1c:** recuperação (RF03), "Meu perfil" (RF02.Obs3), lista de sessões e encerramento das outras, aviso por e-mail da troca de senha, encerramento de todas as sessões (RF02.R8, CA09). Pronto quando o "Pronto quando" da F1 do `painel.md` se cumpre inteiro.

### Testes

Vitest com Testcontainers para a API e o banco; Playwright para o fluxo de cadastro e de login. Relógio e envio de e-mail injetados, sem rede. Casos obrigatórios: RF02.CA02 (e-mail desconhecido), CA03 (4ª tentativa de código), CA04 (bloqueio da senha), CA07 (usuário desativado perde a sessão), CA08 (API recusa sem sessão), CA09; RF01.CA04, CA05, CA08, CA09, CA10.

## Fica a cargo de quem implementa

- Nome exato das tabelas e colunas de autenticação e a forma do mapeamento do Better Auth (a prova decide).
- Biblioteca de hash de senha, desde que forte e com sal (RNF01).
- Duração do teste e demais valores da conta: provisórios por P03, isolados em constante.
- Texto das mensagens de erro, em português do Brasil, seguindo RNF09.

## Riscos e pontos a confirmar na prova de conceito

- ⚠️ Mapeamento do Better Auth para `users` com UUID v7 e colunas em `snake_case`.
- ⚠️ Adaptador Drizzle do Better Auth com a política de RLS: `app_auth` precisa de política própria em `users` sem `app.tenant_id`. Confirmar na documentação atual do Better Auth antes de implementar.
- ⚠️ Cookie de primeira parte com `rewrites` em desenvolvimento e produção.
- O limite de 20 envios por hora por IP depende de ler o IP real atrás do proxy.
- Pendência: P03 (duração do teste e planos) segue provisória.

## Atualizações de documentos ao fechar a F1a

`painel.md` (tabela e "Atualizado em"), `andamento.md` (pendência de `phone_e164` e F1), `arquitetura.md` (tabelas de autenticação) e `CLAUDE.md` (Estado atual).
