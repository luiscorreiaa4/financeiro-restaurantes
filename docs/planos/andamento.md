# Andamento do projeto

> **Papel deste documento:** o painel geral, para os dois sócios: o que já existe, o que vem agora, o que está travado e as pendências técnicas abertas. As tarefas de cada um estão em [`matheus.md`](matheus.md) e [`luis.md`](luis.md) (arquivos locais). A ordem das etapas de código está em [`canal-whatsapp.md`](canal-whatsapp.md) e [`painel.md`](painel.md). As regras continuam em [`../requisitos.md`](../requisitos.md) e o porquê em [`../decisoes.md`](../decisoes.md).
>
> Ao fechar uma pendência, marque aqui e atualize a fonte.

Atualizado em 05/11/2026 (reunião de descoberta; o código não mudou desde 30/10/2026). O escopo do MVP cresceu: ver [`../DESCOBERTA.md`](../DESCOBERTA.md) e as decisões DD-01 a DD-16 em [`../decisoes.md`](../decisoes.md).

Legenda: 🔴 trava algo · 🟡 vale a proposta provisória · `[ ]` a fazer · `[x]` feito

## 1. Resumo

| Frente | Situação |
|---|---|
| Fundação (fase 0) | Pronta. Falta só rodar o CI no GitHub |
| Canal WhatsApp E1 a E9 | **Feitas.** Ressalvas: E3 sem mensagem real do celular (Meta); E9 com áudio e foto testados só com simulação |
| Canal WhatsApp E10 a E14 | A fazer. **E11 é a próxima** (agora ampliada); a E10 está travada pela Meta. E12 (resumos fixos) e E14 (importações e XML) entraram no MVP |
| Painel web F0 a F13 | Nada feito. **F0 pode começar já**. F12 (imposto estimado e DRE) e F13 (contador, importações e XML) entraram no MVP |
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

1. **OpenSpec (fluxo de cada etapa) — antes de abrir qualquer etapa nova do canal ou do painel.** Instalado e iniciado em 05/11/2026 (`openspec/`, comandos `/opsx:*` em `.claude/`, contexto em `openspec/config.yaml`; decisão DD-17). Falta o Luís: (a) conferir `openspec/config.yaml` e os comandos criados em `.claude/commands/opsx/` e `.claude/skills/openspec-*`; (b) decidir sobre a telemetria anônima (`openspec config set telemetry.enabled false`); (c) rodar `/opsx:explore` e depois `/opsx:propose e11-modelo-de-dados` para provar o fluxo na E11; (d) arquivar com `/opsx:archive` ao concluir e conferir que `requisitos.md`, `decisoes.md` e o plano continuam coerentes. Regra: o OpenSpec **referencia** RF e CA do `requisitos.md`, não copia regra. Guia: [`guia/02-claude-code-skills-plugins-mcps.md`](guia/02-claude-code-skills-plugins-mcps.md).
2. **E11 (canal): modelo de dados dos requisitos**, como primeira mudança do OpenSpec (`e11-modelo-de-dados`). Quatro papéis (o contador já no MVP, vendo folha) e permissões adicionais, matriz de permissões como teste, unidades de acesso em lista (P13), campos novos de unidade (canal padrão), categoria e lançamento (`paid_on`, `orders`, `CANAL_A_REVISAR`), tabelas de imposto por vigência; destrava `trocar unidade`, `trocar empresa` e empresa citada no texto. Detalhe em [`canal-whatsapp.md`](canal-whatsapp.md).
3. **F0 (painel): fundação do web**, só depois do passo 1. Pode andar em paralelo com a E11. Antes, planejar F0 e F1 com [`prompts/planejar-painel-f0-f1.txt`](prompts/planejar-painel-f0-f1.txt) e abrir como mudança do OpenSpec (`/opsx:propose f0-fundacao-web`). As etapas seguintes do painel (F2 a F6, F12 e F13) seguem o mesmo fluxo.
4. **Rodar o CI no GitHub.**
5. **Testar áudio e foto reais** (precisa da chave da OpenAI e do ffmpeg).
6. **Matheus:** CNPJ, nome, mensagens reais, textos do WhatsApp ([`matheus.md`](matheus.md), seção 1).
7. **Matheus (novas pendências da reunião de 05/11/2026):** P16 (parâmetros e fórmulas de imposto por regime e se a estimativa entra no Resultado), P17 (vigências da reforma tributária), P18 (regras do XML manual), P01 (lista de categorias com Natureza FIXA/VARIAVEL), P03 (planos e preços), P04 (essenciais, agora com canal e pedidos). Detalhe em [`../DESCOBERTA.md`](../DESCOBERTA.md).

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
- E11: `trocar unidade`, `trocar empresa`, empresa citada no texto (RF11.R5), canal do tipo `APLICATIVO`.

## 6. Painel

Nada feito. Plano completo em [`painel.md`](painel.md).

- [ ] **P12:** os ajustes do plano (autocadastro, login por senha, papel Contador) foram escritos em 29/10; falta implementar na F1, F2 e F6.
- [ ] D-F7 (biblioteca de planilha) e as outras decisões D-F em aberto.
- [ ] Reunião de 05/11/2026: F2 e F6 passam a cobrir o contador (convite com aviso de folha) e o canal padrão da unidade; F4 ganha ticket médio, ponto de equilíbrio e imposto estimado; F12 e F13 são etapas novas. Planejar com os sócios antes de abrir a F0 se quiserem encaixar as telas novas.
- [ ] Antes de iniciar a E11, sugerido reler `arquitetura.md` (divergências atualizadas) e abrir as migrations de `paid_on`, `orders`, canal padrão e `tax_*`.

## 7. Documentação

- [ ] Atualizar `arquitetura.md`: tabela `fiscal_documents`, colunas novas (`entries.flags`, `ai_usage.cache_*`, `pending_questions.status`), ação `restore` e os índices de envio único.
- [ ] Se os sócios aceitarem as propostas de P04 e P06, levar para `requisitos.md` (subindo a versão) e para `escopo-por-fase.md`. (P06 e P07 foram mantidas provisórias em 05/11/2026, DD-15.)
- [ ] Corrigido em 05/11/2026: o `andamento.md` citava "F0 a F11" e o `CLAUDE.md` "F0 a F10"; agora ambos dizem F0 a F13 e E1 a E14.
