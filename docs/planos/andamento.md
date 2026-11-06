# Andamento do projeto

> **Papel deste documento:** o painel geral, para os dois sócios: o que já existe, o que vem agora, o que está travado e as pendências técnicas abertas. As tarefas de cada um estão em [`matheus.md`](matheus.md) e [`luis.md`](luis.md) (arquivos locais). A ordem das etapas de código está em [`canal-whatsapp.md`](canal-whatsapp.md) e [`painel.md`](painel.md). As regras continuam em [`../requisitos.md`](../requisitos.md) e o porquê em [`../decisoes.md`](../decisoes.md).
>
> Ao fechar uma pendência, marque aqui e atualize a fonte.

Atualizado em 06/11/2026 (F0 do painel feita; a reunião de descoberta de 05/11/2026 ampliou o escopo). O escopo do MVP cresceu: ver [`../DESCOBERTA.md`](../DESCOBERTA.md) e as decisões DD-01 a DD-16 em [`../decisoes.md`](../decisoes.md).

Legenda: 🔴 trava algo · 🟡 vale a proposta provisória · `[ ]` a fazer · `[x]` feito

## 1. Resumo

| Frente | Situação |
|---|---|
| Fundação (fase 0) | Pronta. Falta só rodar o CI no GitHub |
| Canal WhatsApp E1 a E9 | **Feitas.** Ressalvas: E3 sem mensagem real do celular (Meta); E9 com áudio e foto testados só com simulação |
| Canal WhatsApp E10 a E14 | **E11 quase feita** (dados e domínio de 06/11/2026; faltam `trocar unidade`/`trocar empresa`/empresa citada e rodar os evals com uma chave Anthropic válida); a E10 está travada pela Meta. E12 (resumos fixos) e E14 (importações e XML) entraram no MVP |
| Painel web F0 a F13 | **F0 feita (06/11/2026)**; F1 a F13 a fazer, **F1 é a próxima**. F12 (imposto estimado e DRE) e F13 (contador, importações e XML) entraram no MVP |
| Negócio, jurídico e validação | Quase tudo em aberto ([`matheus.md`](matheus.md)) |

## 2. O que já existe, de fato

Dá para "conversar" com o sistema pelo terminal (`pnpm dev:chat`), sem WhatsApp, e ver os lançamentos irem para o banco. Roteiro em [`guia-testes-manuais.md`](guia-testes-manuais.md).

- **Recebimento:** webhook do WhatsApp com assinatura conferida, sem gravar duas vezes a mesma mensagem, responde em menos de 1 s. Testado com o botão Teste da Meta.
- **Fila:** processamento em segundo plano, 5 novas tentativas em caso de falha, fila de mensagens que falharam de vez, desligamento sem perder mensagem.
- **Quem escreveu:** identifica o colaborador pelo telefone (com ou sem o 9º dígito), recusa número desconhecido ou desativado com a mesma resposta, registra o consentimento (opt-in).
- **IA:** entende texto livre e grava um ou vários lançamentos. Haiku 5.5 por padrão, Sonnet 5.5 nos casos difíceis. Cerca de **US$ 0,0004 por mensagem**, medido por empresa.
- **Lançamento:** grava com versão e origem, calcula taxa e líquido (a IA nunca faz conta), confirma, pergunta de volta quando falta algo essencial, aceita correção por resposta, `desfazer` (24 h), `cancelar`, `ajuda` e `suporte`, avisa possível duplicidade.
- **Áudio e foto:** transcrição de áudio (até 3 min), leitura de cupom fiscal pela IA, QR Code da NFC-e para não lançar a mesma nota duas vezes, itens agrupados por categoria, limites de uso.
- **Qualidade:** 39 casos de teste da IA com 100% de acerto (otimista: os casos foram inventados); centenas de testes automáticos no núcleo, no banco e na API; testes de arquitetura.
- **Banco:** 18 tabelas em 6 migrations (`0000` a `0005`), isolamento por empresa no próprio Postgres (RLS), testado tabela por tabela.

## 3. Próximos passos

1. **E11 (canal): modelo de dados dos requisitos** (mudança `e11-modelo-de-dados`, iniciada ainda no OpenSpec; o registro está em `openspec/changes/e11-modelo-de-dados/`). Quatro papéis (o contador já no MVP, vendo folha) e permissões adicionais, matriz de permissões como teste, unidades de acesso em lista (P13), campos novos de unidade (canal padrão), categoria e lançamento (`paid_on`, `orders`, `CANAL_A_REVISAR`), tabelas de imposto por vigência; destrava `trocar unidade`, `trocar empresa` e empresa citada no texto. Detalhe em [`canal-whatsapp.md`](canal-whatsapp.md).
2. **F1 (painel): autenticação e sessão.** A F0 está feita; a F1 precisa do banco (E2, pronto). Planejar com o Superpowers (`brainstorming` ou `grilling`, depois `writing-plans`), fazendo antes a prova de conceito do Better Auth com Fastify (prompt de apoio em [`prompts/planejar-painel-f0-f1.txt`](prompts/planejar-painel-f0-f1.txt)). As etapas seguintes do painel (F2 a F6, F12 e F13) seguem o mesmo fluxo.
3. **Rodar o CI no GitHub**, agora também com os jobs novos `e2e` e `integration` (a suíte de integração nunca tinha rodado no CI; localmente passou: db 179 e api 88).
4. **Testar áudio e foto reais** (precisa da chave da OpenAI e do ffmpeg).
5. **Matheus:** CNPJ, nome, mensagens reais, textos do WhatsApp ([`matheus.md`](matheus.md), seção 1).
6. **Matheus (novas pendências da reunião de 05/11/2026):** P16 (parâmetros e fórmulas de imposto por regime e se a estimativa entra no Resultado), P17 (vigências da reforma tributária), P18 (regras do XML manual), P01 (lista de categorias com Natureza FIXA/VARIAVEL), P03 (planos e preços), P04 (essenciais, agora com canal e pedidos). Detalhe em [`../DESCOBERTA.md`](../DESCOBERTA.md).

## 4. Travado por fora 🔴

| Item | Dono | O que trava |
|---|---|---|
| **P15, parte 1:** publicar o app da Meta para as mensagens do celular chegarem | Luís | Teste real da E3 e a E10 |
| **P15, parte 2:** erro 130497 no envio | Luís; Matheus (CNPJ) | Respostas reais no WhatsApp e a E10 |
| Número de WhatsApp definitivo e nome de exibição | Luís | E10 |
| Abrir o CNPJ | Matheus | Verificação da empresa na Meta |
| Chave da OpenAI | Luís | Só o teste de áudio real |

## 5. Pendências técnicas do canal WhatsApp

### Das etapas feitas (E3 a E9)

- [ ] 🔴 E3: mensagem real do celular virar linha em `inbound_messages` sem duplicar no reenvio (P15).
- [ ] E3: trocar as fixtures sintéticas pelos payloads reais anonimizados (texto recebido e `status: failed` 130497).
- [ ] E3: conferir o `redact` do Pino na documentação; script de carga do webhook em rajada (antes do piloto).
- [ ] E4: confirmar a política de retry (5 tentativas, de 10 s a 160 s, teto de 300 s) e o lote de 5; rodar o worker contra o Postgres do Compose; teste real de queda do processo em staging.
- [ ] E5: confirmar a regra do "vínculo mais antigo" (DE-07); conferir a regra de "IA de propósito geral" da Meta antes da E10.
- [ ] E9: testar **áudio real** (cozinha, com ruído) e **foto real** de cupom com QR legível.
- [ ] E9: confirmar o preço do `gpt-transcribe` (estimativa de US$ 0,006 por minuto) e do cache do Haiku 5.5.
- [ ] Pergunta de volta vencida só vira `expired` quando outra abre; falta um job que feche as vencidas (RF15.R4).
- [ ] Correção por resposta não cria fornecedor novo (só aceita os já cadastrados). Confirmar se basta.
- [ ] Evals no CI (precisa do segredo da Anthropic) e casos reais no lugar dos inventados.

### Que já estão na E10 e na E11

- E10: `CloudMessageSender` e `MetaMediaDownloader` na composição (`CHANNEL_MODE=whatsapp`), janela de 24 h, templates, `parar` e `voltar` (P14), cotas e alerta de custo (RF21), S3 e retenção de 90 dias do áudio, consulta à SEFAZ, ffmpeg no servidor, decisão D4 (build), Sentry, backup, staging e produção.
- E11: ~~canal do tipo `APLICATIVO`~~ (feito em 06/11/2026).
- **E11, pendentes (mudança `e11-modelo-de-dados`, tarefas 3.8 e 7.3):**
  - [ ] `trocar unidade`, `trocar empresa` e empresa citada no texto (RF11.R5, RF19): falta decidir onde guardar a escolha. Proposta em `openspec/changes/e11-modelo-de-dados/design.md` ("Open Questions"); decidir, registrar em `decisoes.md` e só então implementar.
  - [ ] Rodar `pnpm --filter @app/ai eval` e conferir contra o baseline: a `ANTHROPIC_API_KEY` do `.env` está inválida (401). Trocar a chave primeiro.
  - [ ] Contador criado só por e-mail: `users.phone_e164` é obrigatório hoje (ajustar na F1/F13).
  - Depois de fechar as três (a pasta `openspec/changes/e11-modelo-de-dados/` fica como registro, sem arquivar): marcar a E11 como "Feita" nos planos e atualizar o `CLAUDE.md`.

## 6. Painel

**F0 feita em 06/11/2026**; F1 a F13 a fazer, a **F1 é a próxima**. Plano completo em [`painel.md`](painel.md) (resumo do que a F0 entregou e deixou para a F1 logo antes de "Fechamento de etapa").

- [ ] **P12:** os ajustes do plano (autocadastro, login por senha, papel Contador) foram escritos em 29/10; falta implementar na F1, F2 e F6.
- [ ] D-F7 (biblioteca de planilha) e as outras decisões D-F em aberto.
- **Pendências deixadas pela F0:**
  - [ ] 🟡 Rodar no GitHub os jobs novos `e2e` e `integration`. É a primeira vez que a suíte de integração roda no CI; localmente passou (db 179, api 88). Se falhar, diagnosticar a causa real, sem enfraquecer teste. Dono: Luís (depende do push).
  - [ ] Decidir a **identidade visual** (marca, paleta, fonte). A F0 ficou neutra por decisão do Luís (D-F8); a troca é local, em `apps/web/app/globals.css`. Antes do piloto (F7 e F8).
  - [ ] Decidir o destino do `apps/web/AGENTS.md` (gerado pelo Next, não versionado): versionar, ignorar no `.gitignore` ou apagar.
  - [ ] Confirmar com o Luís que a base dos componentes do shadcn (`@base-ui/react`, preset `base-nova`) serve à F3 (tabela, formulário, drawer). Alternativa: refazer o `init` com `--base radix`.
  - [ ] Seguem ⚠️ no `painel.md`: prova de conceito do Better Auth com Fastify e `rewrites` (F1), `storageState` do Playwright (F1), manifest do PWA (F7), CSP e Web Vitals (F8), base do TanStack Table (F3).
  - [x] `apps/web/CLAUDE.md` criado (regras de cache, dinheiro, datas, testes e E2E do painel).
- [ ] Reunião de 05/11/2026: F2 e F6 passam a cobrir o contador (convite com aviso de folha) e o canal padrão da unidade; F4 ganha ticket médio, ponto de equilíbrio e imposto estimado; F12 e F13 são etapas novas. Planejar com os sócios antes de abrir a F0 se quiserem encaixar as telas novas.
- [ ] Antes de iniciar a E11, sugerido reler `arquitetura.md` (divergências atualizadas) e abrir as migrations de `paid_on`, `orders`, canal padrão e `tax_*`.

## 7. Documentação

- [ ] Atualizar `arquitetura.md`: tabela `fiscal_documents`, colunas novas (`entries.flags`, `ai_usage.cache_*`, `pending_questions.status`), ação `restore` e os índices de envio único.
- [ ] Se os sócios aceitarem as propostas de P04 e P06, levar para `requisitos.md` (subindo a versão) e para `escopo-por-fase.md`. (P06 e P07 foram mantidas provisórias em 05/11/2026, DD-15.)
- [x] Fluxo de cada etapa trocado de OpenSpec para Superpowers em 06/11/2026 (DD-18); `CLAUDE.md`, planos, `README` e guias atualizados.
- [ ] Limpar o que sobrou do OpenSpec, se o Luís confirmar: `.claude/commands/opsx/`, `.claude/skills/openspec-*` e `openspec/` (config e specs). Manter `openspec/changes/e11-modelo-de-dados/` até fechar a E11, que guarda a pergunta de design aberta.
- [ ] `planos/guia/contabilidade-restaurante-plano-do-zero.md` (roteiro genérico, já marcado como superado) ainda traz exemplos com `/opsx:*`; reescrever ou apagar.
- [ ] Corrigido em 05/11/2026: o `andamento.md` citava "F0 a F11" e o `CLAUDE.md` "F0 a F10"; agora ambos dizem F0 a F13 e E1 a E14.
