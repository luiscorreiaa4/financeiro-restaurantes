# Pendências (índice)

> **Só índice.** Cada linha aponta para o arquivo que explica a pendência; o texto, o contexto e a decisão moram lá. Ao fechar uma pendência, marque na fonte e **tire a linha daqui**. Pendência nova entra primeiro na fonte e depois ganha uma linha aqui, na etapa de origem.
>
> Atualizado em 24/11/2026 (F6b feita: saiu F2-4; entraram F6b-1 a F6b-4). Antes, em 23/11/2026 (F6a feita: saiu F2-2). Antes, em 23/11/2026 (DD-43: entrou F6-1; F2-2 entrou com destino F6a; F2-4 passa para F6b). Antes, em 23/11/2026 (DD-42: entraram F5-1 e F5-2). Antes, em 17/11/2026 (DD-40: saiu F3b-6). Antes, em 17/11/2026 (DD-39: saíram F3-3, F3-4, F3-6, F3b-2, F3b-3, F3b-4, F3c-5 e E11-2; F3-5 reduzida; entrou F3b-6). Antes, em 17/11/2026 (entrou F3c-8). Antes, em 16/11/2026 (pendências da F3 fechadas: saíram F3b-1, F3c-3, F3c-4 e F3c-7, DD-38). Antes, em 16/11/2026 (F3b feita: saiu F2-3; entraram F3b-1 a F3b-5; F3-5 passa para a F3c). Antes, em 16/11/2026 (DD-37, RF26 no MVP: entraram F3c-1, F3c-2 e E11-2). Antes, em 14/11/2026 (F3a feita: entraram F3-3 a F3-6). Antes, em 13/11/2026 (DD-36: saiu F0-3; F0-4 sem o TanStack Table; entraram F3-1 e F3-2). Antes, em 13/11/2026 (DD-34: saíram PF2-1, PF2-2, PF2-3, PF2-4, PF2-6, PF2-7 e PF2-8, e a PF2-9, corrigida no teste; fica PF2-5). Antes, em 11/11/2026 (fechamento do bloco pós-F2, DD-33: saíram F1b-8, F1b-14, F1c-8, F1c-9, F1c-10, F1c-12, F1c-17, F2-1, F2-2, F2-6 e F2-7; entraram PF2-1 a PF2-9). Antes, em 11/11/2026 (entrevista de pendências, DD-32: F0-2 e F1c-11 saíram; "pós-F2" é o bloco de código antes da F3). Antes, em 10/11/2026 (F2 feita: F1a-1, F1b-12 e F1c-6 saíram daqui). Só entram itens abertos. Não entram: `escopo-por-fase.md` (é escopo, não pendência) e os planos das etapas.

**Fontes:** [`andamento.md`](andamento.md) (pendências técnicas, quem está travado e documentação) · [`requisitos.md` §5](../requisitos.md#5-pendências-e-decisões-em-aberto) (pendências de negócio P01 a P18) · [`contingencia-canal.md`](contingencia-canal.md) · [`politica-meta-whatsapp.md`](../politica-meta-whatsapp.md) · `matheus.md` e `luis.md` (locais, fora do git).

**Coluna "Resolver em":** a etapa em que o item deve ser tratado (pode ser diferente da etapa que o gerou). "Decisão" = depende de resposta do Luís ou do Matheus.

## Travado por fora 🔴

| ID | Pendência | Resolver em | Detalhe |
|---|---|---|---|
| B1 | Publicar o app da Meta (P15, parte 1) | E10 | [andamento §4](andamento.md#4-travado-por-fora-) |
| B2 | Erro 130497 no envio (P15, parte 2) | E10 | [andamento §4](andamento.md#4-travado-por-fora-) |
| B3 | Número de WhatsApp definitivo e nome de exibição | E10 | [andamento §4](andamento.md#4-travado-por-fora-) |
| B4 | Abrir o CNPJ (Matheus) | E10 | [andamento §4](andamento.md#4-travado-por-fora-) |
| B5 | Chave da OpenAI | E9 | [andamento §4](andamento.md#4-travado-por-fora-) |

## Canal WhatsApp (E1 a E14)

| ID | Pendência | Resolver em | Detalhe |
|---|---|---|---|
| E3-1 | Mensagem real do celular vira linha sem duplicar (P15) | E3 | [andamento §5](andamento.md#das-etapas-feitas-e3-a-e9) |
| E3-2 | Trocar fixtures sintéticas por payloads reais | E3 | [andamento §5](andamento.md#das-etapas-feitas-e3-a-e9) |
| E3-3 | Conferir `redact` do Pino; carga em rajada do webhook | antes do piloto | [andamento §5](andamento.md#das-etapas-feitas-e3-a-e9) |
| E4-1 | Política de retry, worker no Compose, queda em staging | antes do piloto | [andamento §5](andamento.md#das-etapas-feitas-e3-a-e9) |
| E5-1 | Regra do "vínculo mais antigo" (DE-07); regra de IA da Meta | E10 | [andamento §5](andamento.md#das-etapas-feitas-e3-a-e9) |
| E9-1 | Testar áudio e foto reais | E9 | [andamento §5](andamento.md#das-etapas-feitas-e3-a-e9) |
| E9-2 | Confirmar preço do `gpt-transcribe` e do cache do Haiku | E9 | [andamento §5](andamento.md#das-etapas-feitas-e3-a-e9) |
| E3a9-1 | Job que fecha pergunta de volta vencida (RF15.R4) | canal | [andamento §5](andamento.md#das-etapas-feitas-e3-a-e9) |
| E3a9-2 | Correção por resposta não cria fornecedor novo | Decisão | [andamento §5](andamento.md#das-etapas-feitas-e3-a-e9) |
| E3a9-3 | Evals no CI e casos reais | canal | [andamento §5](andamento.md#das-etapas-feitas-e3-a-e9) |
| E10-1 | Itens já planejados para a E10 | E10 | [andamento §5](andamento.md#que-já-estão-na-e10-e-na-e11) |
| E10-2 | Contingência do canal (portas limpas, sandbox Twilio, orçamentos) | E10 | [contingencia-canal](contingencia-canal.md) |
| E10-3 | Reler seção 4.7 e conferir papel de Tech Provider | E10 | [politica-meta](../politica-meta-whatsapp.md) |
| E11-1 | Roteiro manual do `pnpm dev:chat` (trocar unidade e empresa) | E11 | [andamento §5](andamento.md#que-já-estão-na-e10-e-na-e11) |

## Painel (F0 a F13)

### F0

| ID | Pendência | Resolver em | Detalhe |
|---|---|---|---|
| F0-1 | Identidade visual (marca, paleta, fonte) | F7 e F8 | [andamento §6](andamento.md#6-painel) · bloco "F0" |
| F0-4 | Itens com ⚠️ no `painel.md` (PWA, CSP, Web Vitals…) | F1 a F8 | [andamento §6](andamento.md#6-painel) · bloco "F0" |

### F1 (geral)

| ID | Pendência | Resolver em | Detalhe |
|---|---|---|---|
| F1-1 | P12: ajustes do plano (autocadastro, senha, papel Contador) | F1, F2, F6 | [andamento §6](andamento.md#6-painel) · [requisitos §5](../requisitos.md#5-pendências-e-decisões-em-aberto) |
| F1-3 | Reunião de 05/11: contador, canal padrão, ticket médio (feito na F4), F12 e F13 | F2, F4, F6, F12, F13 | [andamento §6](andamento.md#6-painel) |

### F1a

| ID | Pendência | Resolver em | Detalhe |
|---|---|---|---|
| F1a-2 | `trustProxy`/IP real; produção só com autenticação real | F8 | [andamento §6](andamento.md#6-painel) · bloco "F1a" |
| F1a-3 | Fila persistente de e-mail | F8 | [andamento §6](andamento.md#6-painel) · bloco "F1a" |
| F1a-4 | Minors do review (juntar 0011 e 0012, índices de `auth_audit`…) | antes de produção | [andamento §6](andamento.md#6-painel) · bloco "F1a" |

### F1b

| ID | Pendência | Resolver em | Detalhe |
|---|---|---|---|
| F1b-1 | Roteiro à mão do cadastro | F1b | [andamento §6](andamento.md#6-painel) · bloco "F1b" |
| F1b-2 | `NEXT_PUBLIC_WHATSAPP_NUMBER` no deploy | F8, E10 | [andamento §6](andamento.md#6-painel) · bloco "F1b" |
| F1b-3 | P07: lista padrão de formas e canais | Decisão (Matheus) | [andamento §6](andamento.md#6-painel) · [requisitos §5](../requisitos.md#5-pendências-e-decisões-em-aberto) |
| F1b-4 | Texto final de Termos e Política; `LEGAL_VERSIONS` | antes do piloto (sócios e jurídico) | [andamento §6](andamento.md#6-painel) · bloco "F1b" |
| F1b-5 | `trustProxy` para cadastro e login | F8 | [andamento §6](andamento.md#6-painel) · bloco "F1b" |
| F1b-6 | Limpeza de `signup_verifications` vencidas | F8 | [andamento §6](andamento.md#6-painel) · bloco "F1b" |
| F1b-7 | Sondagem de celular e CNPJ em uso | F8 | [andamento §6](andamento.md#6-painel) · bloco "F1b" |
| F1b-9 | `tax_settings.valid_from` e fusos fora de São Paulo | F10 | [andamento §6](andamento.md#6-painel) · bloco "F1b" |
| F1b-10 | GRANT de `membership_units` sem uso (menor privilégio) | migration futura | [andamento §6](andamento.md#6-painel) · bloco "F1b" |
| F1b-11 | Consulta pública de CNPJ | sem etapa | [andamento §6](andamento.md#6-painel) · bloco "F1b" |
| F1b-13 | Mapa `timezoneForUf` vs RF04.R4 | F10 | [andamento §6](andamento.md#6-painel) · bloco "F1b" |
| F1b-15 | API falsa do E2E não espelha todos os erros do cadastro | F1b | [andamento §6](andamento.md#6-painel) · bloco "F1b" |
| F1b-16 | Constantes duplicadas a juntar no `core` | refatoração | [andamento §6](andamento.md#6-painel) · bloco "F1b" |
| F1b-17 | CNPJ alfanumérico na chave da NFC-e e no chat de dev; roteiro com leitor de tela | E9, E13 | [andamento §6](andamento.md#6-painel) · bloco "DD-28" |

### F1c

| ID | Pendência | Resolver em | Detalhe |
|---|---|---|---|
| F1c-4 | Troca do próprio e-mail (RF02.Obs3) | F6 | [andamento §6](andamento.md#6-painel) · bloco "F1c" |
| F1c-5 | Sem limite de tentativas na senha atual | F8 | [andamento §6](andamento.md#6-painel) · bloco "F1c" |
| F1c-7 | Aviso real de troca de senha e IP real | F8 | [andamento §6](andamento.md#6-painel) · bloco "F1c" |
| F1c-13 | Cota de envio compartilhada entre link e código | F8 | [andamento §6](andamento.md#6-painel) · bloco "F1c" |
| F1c-14 | Fila de segundo plano descarta tarefas quando enche | F8 | [andamento §6](andamento.md#6-painel) · bloco "F1c" |
| F1c-16 | `peekResetToken` não usa o relógio injetado | refatoração | [andamento §6](andamento.md#6-painel) · bloco "F1c" |

### F2

| ID | Pendência | Resolver em | Detalhe |
|---|---|---|---|
| F2-3 | Filtro de categoria sensível na resposta (RF06.R3, CA02) e matriz papel × ação por rota: acrescentar linha a cada rota nova | F3 | [andamento §6](andamento.md#6-painel) · bloco "F2" |
| F2-5 | Lista de empresas do contador com busca e convite com aviso de folha (RF36) | F13 | [andamento §6](andamento.md#6-painel) · bloco "F2" |

### F3

| ID | Pendência | Resolver em | Detalhe |
|---|---|---|---|
| F3-1 | "Ver origem" de áudio e imagem: player, imagem da nota e URL assinada (RF25.R2, R3, Obs2, CA02) | E10 | [andamento §6](andamento.md#6-painel) · bloco "Pendências deixadas pela F3" |
| F3-2 | Itens lidos da nota não são gravados em lugar nenhum (RF25.R3) | E9, E14 | [andamento §6](andamento.md#6-painel) · bloco "Pendências deixadas pela F3" |
| F3-5 | Restam dois limites: "hoje" da lixeira e do período usa `America/Sao_Paulo`, não o fuso da unidade, e as opções de filtro não escondem cadastro inativo (importa para o formulário de edição) | F6 | [andamento §6](andamento.md#6-painel) · bloco "Pendências deixadas pela F3" |
| F3c-1 | Sugestão de categoria no formulário do RF26 (fora do MVP, DD-37) | Depois do piloto | [andamento §6](andamento.md#6-painel) · bloco "Pendências deixadas pela F3" |
| F3c-8 | Mais formas de pagamento e canais padrão, com vários tipos de delivery (WhatsApp, site, iFood…); ligada a P07 | Decisão (Matheus) | [andamento §6](andamento.md#6-painel) · bloco "Pendências deixadas pela F3" |

### F4

| ID | Pendência | Resolver em | Detalhe |
|---|---|---|---|
| F4-1 | Balde "Pessoal (restrito)" do gráfico por categoria mostra participação, o que deixa deduzir a folha (RF28.Obs4) | Decisão (Luís e Matheus) | [andamento §6](andamento.md#6-painel) · bloco "F4" |
| F4-2 | `setErrorHandler` de `reports-routes.ts` converte 4xx em `invalid_request` | antes do piloto | [andamento §6](andamento.md#6-painel) · bloco "F4" |
| F4-3 | Imposto estimado e seu cartão no dashboard | F12 | [andamento §6](andamento.md#6-painel) · bloco "F4" |

### F5

| ID | Pendência | Resolver em | Detalhe |
|---|---|---|---|
| F5-1 | E-mail de exportação pronta, com link para `/exportacoes`, nunca o arquivo (DD-42) | F8 | [andamento §6](andamento.md#6-painel) · bloco "F5" |
| F5-2 | `ExportFileStore` em S3 e criptografia em repouso (DD-42) | E10 | [andamento §6](andamento.md#6-painel) · bloco "F5" |
| F5-3 | API e worker não sobem em produção sem o `ExportFileStore` S3; `.dev-exports/` relativo ao diretório | E10 | [andamento §6](andamento.md#6-painel) · bloco "F5" |
| F5-4 | Corrida DLQ × worker vivo pode deixar arquivo órfão | E10 | [andamento §6](andamento.md#6-painel) · bloco "F5" |
| F5-5 | Reenvio da mesma chave após 503 devolve o pedido `failed` (cliente precisa queimar a chave) | quando houver outro cliente da API | [andamento §6](andamento.md#6-painel) · bloco "F5" |
| F5-6 | `filters.q` (texto da busca) fica na linha do pedido após os 7 dias | antes do piloto | [andamento §6](andamento.md#6-painel) · bloco "F5" |
| F5-7 | Lista mostra como disponível o arquivo que o autor já não pode baixar (403 após perder folha ou unidade) | F5 (ajuste de tela) | [andamento §6](andamento.md#6-painel) · bloco "F5" |

### F6

| ID | Pendência | Resolver em | Detalhe |
|---|---|---|---|
| F6-1 | Tela de histórico de cadastro (leitura do `audit_log`; DD-43) | sem etapa | [andamento §6](andamento.md#6-painel) · bloco "F6" |
| F6b-1 | Porta `EmailSender.sendMemberInvite` e texto do e-mail de convite (provisório) | F8 | [andamento §6](andamento.md#6-painel) · bloco "F6b" |
| F6b-2 | Limite de tentativa no cadastro e na edição de colaborador (sonda de celular e e-mail: `contact_conflict`, `already_member`, `phone_in_use`, `phone_shared`, `email_shared`) | F8/F9 | [andamento §6](andamento.md#6-painel) · bloco "F6b" |
| F6b-3 | E-mail omitido ao dono quando a pessoa tem vínculo em outra empresa: confirmar a regra | Matheus | [andamento §6](andamento.md#6-painel) · bloco "F6b" |
| F6b-4 | Contador fora da tela de colaboradores; minors adiados da revisão | F13 | [andamento §6](andamento.md#6-painel) · bloco "F6b" |

### Pós-F2

| ID | Pendência | Resolver em | Detalhe |
|---|---|---|---|
| PF2-5 | `SUPPORT_EMAIL` provisório em `apps/web/lib/support.ts` | antes do piloto | [andamento §6](andamento.md#6-painel) · bloco "pós-F2" |

## Negócio (requisitos §5)

Pendências de negócio dos sócios. As já fechadas (P02, P05, P09, P10) não entram. P12 está em F1-1 e P15 em B1 e B2.

| ID | Pendência | Dono | Detalhe |
|---|---|---|---|
| P01 | Plano de categorias | Matheus | [requisitos §5](../requisitos.md#5-pendências-e-decisões-em-aberto) |
| P03 | Planos e preços | Matheus | [requisitos §5](../requisitos.md#5-pendências-e-decisões-em-aberto) |
| P04 | Informações essenciais (o que gera pergunta) | Matheus | [requisitos §5](../requisitos.md#5-pendências-e-decisões-em-aberto) |
| P06 | Taxa de canal × forma de pagamento | Matheus | [requisitos §5](../requisitos.md#5-pendências-e-decisões-em-aberto) |
| P07 | Padrões de formas de pagamento e canais | Matheus | [requisitos §5](../requisitos.md#5-pendências-e-decisões-em-aberto) |
| P08 | Textos do WhatsApp | Matheus | [requisitos §5](../requisitos.md#5-pendências-e-decisões-em-aberto) |
| P11 | NF-e por certificado A1 | Matheus | [requisitos §5](../requisitos.md#5-pendências-e-decisões-em-aberto) |
| P13 | Unidades de acesso por vínculo | Luís | [requisitos §5](../requisitos.md#5-pendências-e-decisões-em-aberto) |
| P14 | Revogação do opt-in e envio idempotente | Luís | [requisitos §5](../requisitos.md#5-pendências-e-decisões-em-aberto) |
| P16 | Imposto estimado: parâmetros e fórmulas | Matheus | [requisitos §5](../requisitos.md#5-pendências-e-decisões-em-aberto) |
| P17 | Reforma tributária: vigências | Matheus | [requisitos §5](../requisitos.md#5-pendências-e-decisões-em-aberto) |
| P18 | NF-e por envio manual | Matheus | [requisitos §5](../requisitos.md#5-pendências-e-decisões-em-aberto) |

## Documentação e organização

| ID | Pendência | Resolver em | Detalhe |
|---|---|---|---|
| D1 | Atualizar `arquitetura.md` (`fiscal_documents`, colunas novas, índices) | F2 | [andamento §7](andamento.md#7-documentação) |
| D2 | Levar P04 e P06 aceitos para `requisitos.md` e `escopo-por-fase.md` | Decisão | [andamento §7](andamento.md#7-documentação) |
| D3 | Limpar o que sobrou do OpenSpec | Decisão | [andamento §7](andamento.md#7-documentação) |
| D4 | Reescrever ou apagar o guia que ainda cita `/opsx:*` | Decisão | [andamento §7](andamento.md#7-documentação) |
| D5 | "Antes de iniciar a E11, reler `arquitetura.md`": provavelmente obsoleta (E11 feita) | rever | [andamento §6](andamento.md#6-painel) |
| D6 | DD-23 citada em README.md:33 e andamento.md:53, mas ausente de decisoes.md: recuperar pelo git log (Luís) | Decisão | [decisoes](../decisoes.md) |

## Fora das etapas (sócios, arquivos locais)

| ID | Pendência | Detalhe |
|---|---|---|
| S1 | Tudo que depende do Matheus: decisões de negócio, validação com restaurantes, jurídico | `matheus.md` (local, fora do git) |
| S2 | Contas, Meta, infraestrutura e custos do Luís | `luis.md` (local, fora do git) |
