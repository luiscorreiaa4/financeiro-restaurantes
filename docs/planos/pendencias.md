# Pendências (índice)

> **Só índice.** Cada linha aponta para o arquivo que explica a pendência; o texto, o contexto e a decisão moram lá. Ao fechar uma pendência, marque na fonte e **tire a linha daqui**. Pendência nova entra primeiro na fonte e depois ganha uma linha aqui, na etapa de origem.
>
> Atualizado em 10/11/2026 (DD-28 fechado, F1c-1 resolvida). Só entram itens abertos. Não entram: `escopo-por-fase.md` (é escopo, não pendência) e os planos das etapas.

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
| F0-2 | Destino do `apps/web/AGENTS.md` | Decisão | [andamento §6](andamento.md#6-painel) · bloco "F0" |
| F0-3 | Base do shadcn (`@base-ui/react`) serve à F3? | F3 | [andamento §6](andamento.md#6-painel) · bloco "F0" |
| F0-4 | Itens com ⚠️ no `painel.md` (PWA, CSP, TanStack Table…) | F1 a F8 | [andamento §6](andamento.md#6-painel) · bloco "F0" |

### F1 (geral)

| ID | Pendência | Resolver em | Detalhe |
|---|---|---|---|
| F1-1 | P12: ajustes do plano (autocadastro, senha, papel Contador) | F1, F2, F6 | [andamento §6](andamento.md#6-painel) · [requisitos §5](../requisitos.md#5-pendências-e-decisões-em-aberto) |
| F1-2 | D-F7 (biblioteca de planilha) e outras D-F em aberto | Decisão | [andamento §6](andamento.md#6-painel) |
| F1-3 | Reunião de 05/11: contador, canal padrão, ticket médio, F12 e F13 | F2, F4, F6, F12, F13 | [andamento §6](andamento.md#6-painel) |

### F1a

| ID | Pendência | Resolver em | Detalhe |
|---|---|---|---|
| F1a-1 | Renovar cookie de "manter conectado"; 401 redireciona ao login | F2 | [andamento §6](andamento.md#6-painel) · bloco "F1a" |
| F1a-2 | `trustProxy`/IP real; produção só com autenticação real | F8 | [andamento §6](andamento.md#6-painel) · bloco "F1a" |
| F1a-3 | Fila persistente de e-mail | F8 | [andamento §6](andamento.md#6-painel) · bloco "F1a" |
| F1a-4 | Minors do review (juntar 0011 e 0012, índices de `auth_audit`…) | antes de produção | [andamento §6](andamento.md#6-painel) · bloco "F1a" |

### F1b

| ID | Pendência | Resolver em | Detalhe |
|---|---|---|---|
| F1b-1 | Roteiro à mão do cadastro | F1b | [andamento §6](andamento.md#6-painel) · bloco "F1b" |
| F1b-2 | `NEXT_PUBLIC_WHATSAPP_NUMBER` no deploy | F8, E10 | [andamento §6](andamento.md#6-painel) · bloco "F1b" |
| F1b-3 | P07: lista padrão de formas e canais | Decisão (Matheus) | [andamento §6](andamento.md#6-painel) · [requisitos §5](../requisitos.md#5-pendências-e-decisões-em-aberto) |
| F1b-4 | Texto final de Termos e Política; `LEGAL_VERSIONS` | Decisão (sócios) | [andamento §6](andamento.md#6-painel) · bloco "F1b" |
| F1b-5 | `trustProxy` para cadastro e login | F8 | [andamento §6](andamento.md#6-painel) · bloco "F1b" |
| F1b-6 | Limpeza de `signup_verifications` vencidas | F8 | [andamento §6](andamento.md#6-painel) · bloco "F1b" |
| F1b-7 | Sondagem de celular e CNPJ em uso | F8 | [andamento §6](andamento.md#6-painel) · bloco "F1b" |
| F1b-8 | Conferência de `Origin` no cadastro | F8 | [andamento §6](andamento.md#6-painel) · bloco "F1b" |
| F1b-9 | `tax_settings.valid_from` e fusos fora de São Paulo | F10 | [andamento §6](andamento.md#6-painel) · bloco "F1b" |
| F1b-10 | GRANT de `membership_units` sem uso (menor privilégio) | migration futura | [andamento §6](andamento.md#6-painel) · bloco "F1b" |
| F1b-11 | Consulta pública de CNPJ | sem etapa | [andamento §6](andamento.md#6-painel) · bloco "F1b" |
| F1b-12 | `/api/me` ignora `preferred_at` | F2 | [andamento §6](andamento.md#6-painel) · bloco "F1b" |
| F1b-13 | Mapa `timezoneForUf` vs RF04.R4 | F10 | [andamento §6](andamento.md#6-painel) · bloco "F1b" |
| F1b-14 | Usuário só com vínculos desativados não cria empresa | Decisão | [andamento §6](andamento.md#6-painel) · bloco "F1b" |
| F1b-15 | API falsa do E2E não espelha todos os erros do cadastro | F1b | [andamento §6](andamento.md#6-painel) · bloco "F1b" |
| F1b-16 | Constantes duplicadas a juntar no `core` | refatoração | [andamento §6](andamento.md#6-painel) · bloco "F1b" |
| F1b-17 | CNPJ alfanumérico na chave da NFC-e e no chat de dev; roteiro com leitor de tela | E9, E13 | [andamento §6](andamento.md#6-painel) · bloco "DD-28" |

### F1c

| ID | Pendência | Resolver em | Detalhe |
|---|---|---|---|
| F1c-4 | Troca do próprio e-mail (RF02.Obs3) | F6 | [andamento §6](andamento.md#6-painel) · bloco "F1c" |
| F1c-5 | Sem limite de tentativas na senha atual | F8 | [andamento §6](andamento.md#6-painel) · bloco "F1c" |
| F1c-6 | `/api/profile` lido no navegador | F2 | [andamento §6](andamento.md#6-painel) · bloco "F1c" |
| F1c-7 | Aviso real de troca de senha e IP real | F8 | [andamento §6](andamento.md#6-painel) · bloco "F1c" |
| F1c-8 | `/api/profile/*` sem checagem de `Origin` | F8 | [andamento §6](andamento.md#6-painel) · bloco "F1c" |
| F1c-9 | Nome do perfil aceita caracteres invisíveis | F2 | [andamento §6](andamento.md#6-painel) · bloco "F1c" |
| F1c-10 | Nome no menu só atualiza ao recarregar | F2 | [andamento §6](andamento.md#6-painel) · bloco "F1c" |
| F1c-11 | Lint acusa CRLF no checkout do Windows | ambiente | [andamento §6](andamento.md#6-painel) · bloco "F1c" |
| F1c-12 | E2E local em paralelo: "Sair" instável | F2 | [andamento §6](andamento.md#6-painel) · bloco "F1c" |
| F1c-13 | Cota de envio compartilhada entre link e código | F8 | [andamento §6](andamento.md#6-painel) · bloco "F1c" |
| F1c-14 | Fila de segundo plano descarta tarefas quando enche | F8 | [andamento §6](andamento.md#6-painel) · bloco "F1c" |
| F1c-16 | `peekResetToken` não usa o relógio injetado | refatoração | [andamento §6](andamento.md#6-painel) · bloco "F1c" |
| F1c-17 | Testes de borda do `AuthStore` | F2 | [andamento §6](andamento.md#6-painel) · bloco "F1c" |

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

## Fora das etapas (sócios, arquivos locais)

| ID | Pendência | Detalhe |
|---|---|---|
| S1 | Tudo que depende do Matheus: decisões de negócio, validação com restaurantes, jurídico | `matheus.md` (local, fora do git) |
| S2 | Contas, Meta, infraestrutura e custos do Luís | `luis.md` (local, fora do git) |
