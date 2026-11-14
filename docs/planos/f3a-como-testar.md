# F3a (lançamentos, leitura): como testar

> Roteiro de teste da F3a, a parte "ver" da F3 (RF22 e RF25). Desenho em `docs/superpowers/specs/2026-11-13-f3-lancamentos-design.md`, plano em `docs/superpowers/plans/2026-11-13-f3a-lancamentos-ver.md`, registro da execução em [`f3a-execucao.md`](f3a-execucao.md). Criado em 14/11/2026.

## 1. Antes de tudo

1. **Docker Desktop aberto.** Os testes de integração sobem o Postgres pelo Testcontainers. Com o Docker fechado, todos os arquivos falham com `Could not find a working container runtime strategy`, sem nenhum teste rodar.
2. **Migration 0018 no banco de dev.** Ela só cria dois índices (`entries_created_idx` e `entries_trash_idx`). O `db:migrate` não lê o `.env`; exporte a variável antes:

   ```
   ! export DATABASE_ADMIN_URL=<a URL de admin do seu .env>; pnpm db:migrate
   ```

3. **Dependências.** Se o `typecheck` do `@app/db` acusar `Cannot find module 'drizzle-orm'` depois de um `pnpm --filter ... add`, rode `pnpm install` na raiz.

## 2. Testes automáticos

| O que | Comando | Esperado (14/11/2026) |
|---|---|---|
| Tudo, menos integração e E2E | `pnpm typecheck && pnpm lint && pnpm test` | verde; core 814, api 465, web 298 |
| Integração (Docker) | `pnpm test:int` | db 370, api 370 |
| Só o leitor de lançamentos | `pnpm --filter @app/db exec vitest run entry-reader` | 80 ou mais |
| Só as rotas de lançamentos | `pnpm --filter @app/api exec vitest run entries-panel` | 103 ou mais |
| Recorte, contrato, valor em reais, diff de versões | `pnpm --filter @app/core test entry-scope contracts parse-brl version-diff` | verde |
| Telas de lançamentos | `pnpm --filter @app/web test features/entries` | verde |
| E2E de lançamentos (build de produção) | `CI=true pnpm --filter @app/web exec playwright test entries` | 16 passam, 2 pulados de propósito |
| E2E completo | `CI=true pnpm --filter @app/web test:e2e` | 269 passam, 5 pulados |

Atenção: `pnpm --filter <pacote> test:int <nome>` **roda todos os arquivos**, porque o script já passa `int.test.ts` como filtro. Para um arquivo só, use `exec vitest run <nome>`. Detalhe em `.claude/rules/testes-integracao-ambiente.md`.

## 3. Roteiro à mão

### Subir

Em quatro terminais, na raiz:

```
pnpm db:seed:dev
pnpm dev
pnpm dev:worker
pnpm dev:chat
```

Abra o painel em `http://localhost:3000` (use `localhost`, não `127.0.0.1`: com o hook de `Origin`, o outro host dá 403 nas escritas).

### Criar dados pelo chat

No `pnpm dev:chat`, como o dono, mande três mensagens:

1. `paguei 450 de gás`
2. `vendi 1200 no salão, cartão de crédito`
3. `paguei 3100 de salário do João`

A terceira cai na categoria de folha (sensível).

### Contas do seed

| Persona | E-mail | Como entrar |
|---|---|---|
| Dono | `dono@demo.dev` | senha `demo12345` ou código |
| Gerente | `gerente@demo.dev` | código (lido na pasta `DEV_MAIL_DIR`) |
| Lançador | `atendente@demo.dev` | código |
| Contadora | `contadora@demo.dev` | código |

### O que conferir em `/lancamentos`

**Como dono**
- [ ] A lista mostra os três lançamentos do mês corrente, do mais novo para o mais antigo.
- [ ] Os totais batem: receitas R$ 1.200,00, despesas R$ 3.550,00, resultado negativo, "3 lançamentos". Nenhum aviso de valores restritos.
- [ ] Busca `450,00` (ou `450`): só o gás.
- [ ] Clique no cabeçalho "Valor": ordena do maior para o menor; de novo, do menor para o maior; de novo, volta à ordem de criação. A URL ganha `sort` e `dir`.
- [ ] Filtre por "Despesas" e recarregue a página: o filtro continua. Use o botão voltar: o filtro anterior volta.
- [ ] Abra o gás: aba Dados com valor e datas; aba Origem com o texto "paguei 450 de gás" e "Canal: WhatsApp"; aba Histórico com "Criação · WhatsApp". O botão voltar do navegador fecha o lançamento.
- [ ] Endereço com `&entry=` de um id inventado: "Lançamento não encontrado".

**Como gerente**
- [ ] Se o gerente do seed não tiver VER_FOLHA: o salário não aparece, os totais não somam os R$ 3.100,00 e aparece "Há valores restritos que não entram nestes totais.". A categoria de folha não aparece no filtro de categorias.
- [ ] Copie de uma sessão de dono o endereço `?entry=<id do salário>` e abra como gerente: "Lançamento não encontrado".

**Como lançador**
- [ ] "Lançamentos" aparece no menu (antes da F3a não aparecia; ver a decisão 1 em `f3a-execucao.md`).
- [ ] Só os lançamentos que ele mesmo mandou. Não há o filtro "Lançado por". Pôr `&createdBy=<id do dono>` na URL não muda nada.
- [ ] Nada de folha, nem a que ele mesmo lançou.

**Como contadora**
- [ ] Vê tudo, inclusive a folha, e nenhum botão de alteração (a F3a ainda não tem edição).

**No celular** (DevTools, largura de 390 px)
- [ ] Cartões em vez de tabela, filtros no botão "Filtros" (folha lateral), sem rolagem horizontal.

## 4. Limites conhecidos (não são defeito da F3a)

- Áudio e imagem da origem só na E10 (F3-1); a F3a mostra a transcrição e a chave da nota.
- O aviso de valores restritos respeita a busca (F3-3, decisão do Luís antes do merge).
- O filtro "Lançado por" lista todos os vínculos da empresa (F3-4).
- Campo que não mudou numa reclassificação continua visível nas versões seguintes; o detalhe abre lançamento na lixeira pelo endereço; "hoje" usa o fuso de São Paulo (F3-5).
- Edição, exclusão, lixeira e lote são a F3b.
