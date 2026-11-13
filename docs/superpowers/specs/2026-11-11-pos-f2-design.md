# Bloco pós-F2: desenho

Data: 11/11/2026. Plano: `docs/superpowers/plans/2026-11-11-pos-f2.md`. Cita RF e CA de `docs/requisitos.md` e não copia regra.

## Contexto

Entre a F2 e a F3 sobraram pendências que a DD-32 (11/11/2026) decidiu e que a F3 precisa encontrar prontas: o dono sem unidade ativa não consegue entrar, quem só tem vínculos desativados não cria empresa, nenhuma rota de escrita confere `Origin`, as telas de acesso abrem para quem já está logado, o nome do perfil aceita caracteres invisíveis, o E2E oscila e o `pnpm lint` da raiz falha. Branch: `feat/f2-conta-unidade-permissoes`.



## A1. Objetivo, não objetivos

**Objetivo:** fechar F2-2, F1b-14, F2-1/F1b-8/F1c-8, F2-7, F1c-9, F1c-10, F1c-12, F1c-17 e F2-6.

**Não objetivos:** reativar ou criar unidade pela tela (F6); F2-3 (F3), F2-4 (F6), F2-5 (F13), F1c-4 (F6); tudo que depende de F8 e E10; "Meu perfil" para sessão restrita.

**Anti-objetivo:** qualquer caminho em que uma sessão restrita leia ou grave dado de uma empresa existente (RNF02). A única escrita permitida é criar a própria empresa nova por `POST /api/companies`.

**Termos:** "vínculo ativo", "unidade ativa", "conta legível para o papel" e "serve ao painel" têm o significado que o código já dá em `packages/core/src/access/panel-context.ts` (`accountAllows`, `servesPanel`) e `packages/db/src/panel-access-store.ts`. Este desenho não cria definição nova; status desconhecido conta como não ativo.

## A2. Decisões do Luís (11/11/2026)

1. **F1b-14: sessão restrita.** Quem só tem vínculos desativados faz login normal e cai na tela restrita.
2. **Gerente, lançador e contador sem unidade ativa: recusa depois de provar a credencial.** Sem sessão. O código por e-mail é enviado a eles; só com código ou senha certos o login responde `NO_ACTIVE_UNIT`. Credencial errada segue com o erro genérico (RF02.R1).
3. **`/redefinir-senha` com sessão aberta:** a tela abre; ao salvar a senha, a sessão do aparelho é encerrada e a pessoa vai para `/login`.

## A3. Abordagens consideradas (F1b-14)

| Abordagem | Troca | Resultado |
|---|---|---|
| Sessão restrita | Reaproveita o estado que o F2-2 já exige; ex-funcionário volta a ter sessão, sem dado de empresa | **Escolhida** |
| Pelo `/cadastro` (e-mail verificado cria empresa para usuário existente) | Nenhuma sessão nova; segundo caminho no cadastro e risco de revelar quem é cliente | Descartada |
| Passe de uso único no login | Nenhuma sessão nova; comprovante, tela e rota novos | Descartada (a maior) |

## A4. Entrada no painel: três resultados

Uma função pura no core classifica o usuário. É a única fonte da regra; login, sessão e recuperação a consultam.

| Ordem | Condição | Resultado |
|---|---|---|
| 1 | Algum vínculo serve ao painel (`resolvePanelContext(...).ok`) | `full` |
| 2 | Algum vínculo de dono, empresa legível para o dono (não `closed`), sem unidade ativa | `restricted` / `owner_no_unit` |
| 3 | Nenhum vínculo ativo de qualquer papel (`status = 'active'` e `deactivated_at IS NULL`) | `restricted` / `no_membership` |
| 4 | Algum vínculo que serviria ao painel se tivesse unidade (conta legível para o papel e `panel:access`) | `refused` / `ask_owner` |
| 5 | Resto (empresa `closed`, `canceled` para não dono, lançador sem painel) | `refused` / `no_access` |

**Chamadas minhas:**
- **O modo restrito não é um `PanelContext` sem unidade.** A DD-32 fala em "contexto sem unidade"; aqui `servesPanel`, `PanelContext` e o cookie `fr_ctx` ficam como estão, e o restrito é um estado da sessão sem contexto. Motivo: toda rota de tenant exige `PanelContext`, então a sessão restrita é recusada por construção, sem precisar lembrar de proteger cada rota nova (RNF02).
- **Dono com a empresa A sem unidade e a empresa B normal entra `full`**, só com a B no seletor. A A reaparece quando ganhar unidade (F6).
- **`no_membership` inclui usuário só com convite pendente ou sem vínculo algum.** Lançador ativo só de WhatsApp tem vínculo ativo, então cai em `no_access` e continua sem sessão.
- **`ask_owner` vale também para o gerente cujas unidades vinculadas estão todas inativas**, mesmo que a empresa tenha outras ativas. A orientação continua correta (falar com o dono).

## A5. API

**Login (`create-auth.ts`), por resultado:**

| Resultado | Código por e-mail | Senha ou código certos | Credencial errada |
|---|---|---|---|
| `full`, `restricted` | enviado | sessão criada | erro genérico de hoje |
| `refused/ask_owner` | enviado | 403 `NO_ACTIVE_UNIT`, sem sessão, sem cookie, auditoria `login_failed`, contador de falhas de senha zerado | erro genérico de hoje |
| `refused/no_access`, e-mail desconhecido | não enviado | erro genérico de hoje, antes de conferir | erro genérico de hoje |

A recusa `ask_owner` acontece depois da conferência da credencial. Ponto único preferido: `databaseHooks.session.create.before` (⚠️ confirmar que um erro lançado ali chega ao cliente com o código; plano B na tarefa).

**Sessão a cada requisição:**
- `checkSession` (existente) continua exigindo `full`. Todas as rotas atuais seguem recusando a sessão restrita com 401, inclusive `/api/profile/*`, `/api/context` e `/api/units`.
- `checkEntry` (novo) aceita `full` e `restricted` e devolve qual é. Só duas rotas o usam: `GET /api/me` e `POST /api/companies`.
- `sessionBlocked` (rotas `/api/auth/*`): **removido em 13/11/2026 (DD-34)**. Nenhuma rota o chamava e a lista fechada de `/api/auth/*` não tem ação que dependa da sessão. O texto original previa bloquear só `refused`.
- Uma sessão `full` que vira `refused` no meio do caminho recebe 401 em tudo, como hoje (RF02.CA07).

**`GET /api/me`:** ganha o campo `access`. `full` devolve o corpo de hoje mais `access: "full"`. `restricted` devolve só `{ access: "restricted", reason, userId, name, email }`, sem empresas, sem contexto e sem tocar no `fr_ctx`.

**`POST /api/companies`:** aceita `full` e `restricted`. O resto do caso de uso não muda. Fica registrado no F2-7 que a checagem de sessão já estava dentro do handler.

**Recuperação de senha:** o link é enviado e aceito para `full` e `restricted`; `refused` segue em silêncio (chamada minha: o `ask_owner` usa o código por e-mail para ver a orientação).

**Hook global de `Origin` (DD-32 item 3):**
- `onRequest` na raiz do `buildApp`, antes dos plugins.
- Métodos POST, PUT, PATCH e DELETE.
- Aceita só `Origin` igual a `new URL(APP_URL).origin`. Ausente, `null` ou diferente: 403 `{ code: "origin_forbidden" }`.
- Exceções por caminho exato, em uma constante: `/webhooks/whatsapp` (protegido por assinatura; a Meta não manda `Origin`). **Chamada minha:** ausente é recusado porque todas as escritas chegam do navegador pelo rewrite do Next, que repassa o `Origin` (confirmado no `node_modules`, Next 16.4.3); o servidor do Next só faz GET.
- Um teste percorre todas as rotas de escrita registradas e exige 403 sem `Origin` em cada uma fora da lista; rota nova já nasce coberta.
- Consequência para desenvolvimento: abrir o painel em `127.0.0.1` com `APP_URL=http://localhost:3000` passa a dar 403 nas escritas. Vai para o roteiro de teste.

**Cadastro e recuperação chamados com sessão (chamada minha):** a API continua aceitando; a prova ali é o código do e-mail ou o token. Quem trata é a tela.

**Nome do perfil (DD-32 item 4):** normalizador no core, aplicado em `PATCH /api/profile/name` antes do limite de tamanho. Remove controle e formato (`\p{Cc}`, `\p{Cf}`, `\p{Zl}`, `\p{Zp}`) e os "brancos" que são letra para o Unicode (U+115F, U+1160, U+3164, U+FFA0, U+2800). **Chamada minha:** emoji composto com ZWJ perde a junção; aceitável para nome de pessoa. O nome do autocadastro fica como está (fora da DD-32).

## A6. Painel (web)

**Área restrita.** Grupo de rotas novo `(restricted)`, com layout próprio:

| Rota | Conteúdo |
|---|---|
| `/acesso-restrito` | Aviso conforme o motivo, botão "Criar outra empresa", contato de suporte, "Sair" |
| `/acesso-restrito/nova-empresa` | O `CompanyForm` de hoje; ao concluir vai para `/bem-vindo`, já com sessão `full` |

```
┌──────────────────────────────────────────────┐
│ Financeiro                    Fulano · Sair  │
├──────────────────────────────────────────────┤
│  Sua empresa não tem unidade ativa           │
│  Para voltar a usar o painel, fale com o     │
│  suporte: <contato>                          │
│                                              │
│  [ Criar outra empresa ]                     │
└──────────────────────────────────────────────┘
```

- Texto de `owner_no_unit`: "Sua empresa não tem unidade ativa."
- Texto de `no_membership`: "Você não tem acesso ativo a nenhuma empresa."
- O layout `(app)` manda sessão restrita para `/acesso-restrito`; o layout `(restricted)` manda sessão `full` para `/` e quem não tem sessão para `/login`. Nenhuma página de `(app)` renderiza para sessão restrita.
- Sem seletor, sem menu, sem "Meu perfil" (DD-32: "a única tela").
- **Contato de suporte:** e-mail (A11), em uma constante única.

**Login:** o erro `NO_ACTIVE_UNIT` mostra "Sua empresa está sem unidade ativa. Peça ao dono da empresa para reativar uma unidade." (RF02.CA10).

**Rotas por estado de sessão (F2-7):**

| Rota | Sem sessão | Sessão `full` | Sessão restrita | Cookie inválido ou vencido |
|---|---|---|---|---|
| Grupo `(app)` | `/login?next=` | abre | `/acesso-restrito` | `/login` |
| `/acesso-restrito*` | `/login?next=` | `/` | abre | `/login` |
| `/login`, `/cadastro`, `/recuperar-senha` | abre | `safeNext(next)`, padrão `/` | `/acesso-restrito` (via `/`) | abre, sem laço |
| `/redefinir-senha` | abre | abre; ao concluir, sai e vai a `/login` | idem | abre |
| `/termos`, `/privacidade` | abre | abre | abre | abre |

- O redirecionamento das telas de acesso valida a sessão na API (`currentSession()`), dentro de `<Suspense>`, e só quando o cookie existe. O `proxy.ts` não muda: ele não valida sessão, e um Server Component não apaga cookie (confirmado no `node_modules`).
- A matriz vai para `apps/web/CLAUDE.md`. Um teste compara as páginas do grupo `(app)` no disco com a lista que o E2E percorre, para rota nova não ficar de fora.

**Nome no menu (F1c-10):** `router.refresh()` depois de salvar o nome; o layout relê `/api/me`.

## A7. Testes e qualidade

- **E2E "Sair" (F1c-12):** o teste passa a esperar a casca terminar de carregar antes do clique, como manda `.claude/rules/e2e-painel.md`. Depois, rodada repetida com `next dev` e vários workers; o que oscilar por causa do teste é corrigido, o que for de ambiente vira pendência no `andamento.md`. Nenhuma asserção é removida nem afrouxada.
- **AuthStore (F1c-17):** os três casos de borda listados no `andamento.md`.
- **Lint (F2-6):** a prop `role` de `AccountBanner` vira `userRole` (chamada minha: resolve a regra de a11y sem `biome-ignore`); `packages/db/migrations/meta` sai do Biome; `fake-api.mjs` é formatado; `.claude/rules/biome-escopo.md` deixa de citar o CRLF.

## A8. Regras novas (entram antes em `decisoes.md` e `requisitos.md` 1.12)

DD-33 registra: os três resultados de entrada e a sessão restrita (RF01.Obs4, RF02.R1); a orientação ao gerente só depois da credencial provada (RF02.R1, RF02.CA10); telas de acesso com sessão aberta e `/redefinir-senha` (regra e CA novos no RF02; RF03); `Origin` ausente recusado e a exceção do webhook (RNF de segurança); o modo restrito sem `PanelContext` (nota em `arquitetura.md`, que ajusta o texto da DD-32 item 1).

## A9. Deixado para quem constrói

Layout visual da tela restrita dentro do padrão shadcn da casca; nomes de arquivos de teste; como repetir o E2E sob carga no Windows.

## A10. Conferência do construtor independente

**Respondidas pelo projeto:**
- A empresa criada por `/api/companies` já nasce com uma unidade ativa na mesma transação (`packages/db/src/signup-repo.ts`), então a sessão vira `full`. Um teste prova isso logo após o 201.
- Só três caminhos criam sessão: `sign-in/email`, `sign-in/email-otp` (lista fechada `ALLOWED_PATHS` em `auth-routes.ts`) e `openSession` do autocadastro, que acabou de criar o vínculo. O plano B da recusa `ask_owner` cobre os dois primeiros, que são todos os de login.
- Pela mesma lista fechada, a sessão restrita só alcança `sign-out` em `/api/auth/*`. Troca de senha, de e-mail e listagem de sessões do Better Auth respondem 404 para qualquer um.
- `currentSession()` devolve `null` para qualquer falha, inclusive API fora. Nas telas de acesso isso faz a tela abrir (falha aberta); no grupo `(app)` segue como hoje.
- Os três casos de borda do AuthStore: `keepSessionId` de outro usuário em `deleteSessionsExcept`; conta de outro provedor em `getPasswordHash` e `setPasswordHash`; `expiresAt` igual a `now` em `listSessions`.

**Chamadas minhas:**
- **Paridade contra enumeração:** corpo e status idênticos, como hoje. O pedido de código responde antes de qualquer consulta, então não revela nada. Este bloco não iguala tempo de resposta nem contador entre `no_access` e os demais; o comportamento de `no_access` é o de hoje.
- **Conflitos de `/api/companies`** (`CNPJ_TAKEN`, `PHONE_TAKEN`) ficam como estão; já são vistos por qualquer usuário logado e pelo autocadastro. Sem teto novo de empresas por usuário.
- **`/redefinir-senha`:** a tela encerra a sessão do aparelho seja de quem for (decisão A2.3) e vai para `/login` mesmo se o `sign-out` falhar. O que a redefinição faz com as outras sessões da conta do link não muda neste bloco.
- **Classificação que muda no meio da sessão:** o 401 leva a `/login`, que leva a `/`, que leva a `/acesso-restrito`. A cadeia termina sem laço e é coberta por teste.
- **Sem piscar o formulário:** o formulário das telas de acesso fica dentro do mesmo `<Suspense>` da checagem, então só aparece depois dela. Sem cookie não há chamada à API nem espera.
- **Nome "vazio":** além da lista de A5, o nome precisa ter ao menos uma letra ou número depois da limpeza. Cobre seletores de variação e marcas soltas sem manter lista infinita. O tamanho é medido depois; nomes já gravados não são migrados.
- **Uma origem só.** Escrita feita pelo servidor do Next ou webhook novo (F8, E10) exige entrada explícita na lista de exceções; fica escrito em `apps/web/CLAUDE.md` e na regra de rota.
- **Convite pendente e empresa `closed`:** sem tela nem texto novos. O aceite de convite é da F6, que revê `no_membership` para o convidado.
- **Oscilação do E2E:** é "de teste" o que se corrige esperando estado da tela ou isolando dados; é "de ambiente" só o que depende da máquina (compilação do `next dev`, CPU). Critério de parada: 5 repetições com os workers padrão.

## A11. Contato de suporte (decisão do Luís)

E-mail de suporte, mostrado como link `mailto:`. O endereço ainda não foi informado: o Luís passa o valor antes da T10. Mora na constante única `SUPPORT_EMAIL` em `apps/web/lib/support.ts`. A T10 não inventa endereço; sem o valor, ela para e pergunta.

