# Requisitos do produto (Financeiro Restaurantes)

> **Papel deste documento:** diz **o quê** o produto faz e quais são as regras de negócio. É a **fonte única** das regras. O porquê das escolhas fica em [`decisoes.md`](decisoes.md); o como (técnica) em [`arquitetura.md`](arquitetura.md); a ordem de execução nos planos de desenvolvimento.

- **Versão:** 1.0 (conteúdo do Documento de Requisitos v1.0, de 29/10/2026, convertido para Markdown sem resumir)
- **Data:** 29/10/2026
- **Situação:** rascunho para revisão dos sócios
- **Responsáveis:** Luís (desenvolvimento) e Matheus (produto e contabilidade)

> O `.docx` v1.0 é um retrato e não deve ser editado. Mudou regra: edite este arquivo (e suba a versão acima) depois de registrar a decisão em `decisoes.md`. Uma versão nova do `.docx` sai deste `.md` com pandoc quando os sócios pedirem.

## Como usar

- Procure o requisito pelo título: `### RF12`, `### RNF05` (por exemplo, com Grep). Não leia o arquivo inteiro: ele é grande.
- Cite regras e critérios de aceite pelo ID: `RF12.R5` (regra 5 do RF12) e `RF12.CA04` (critério de aceite 4).
- `[PROVISÓRIO – Pxx]` marca uma pendência ainda aberta (seção 5): vale a proposta escrita ao lado até a decisão final, e o valor deve ficar isolado em configuração ou constante única no código.
- Em conflito entre um plano e este arquivo, vale este arquivo.

## Índice

**Conta e acesso**

- [RF01 – Cadastro de Empresa (autocadastro)](#rf01--cadastro-de-empresa-autocadastro)
- [RF02 – Autenticação e Sessão (senha ou código)](#rf02--autenticação-e-sessão-senha-ou-código)
- [RF03 – Recuperação de Acesso](#rf03--recuperação-de-acesso)
- [RF04 – Cadastro de Unidades (restaurantes)](#rf04--cadastro-de-unidades-restaurantes)
- [RF05 – Cadastro de Colaboradores e Números de WhatsApp](#rf05--cadastro-de-colaboradores-e-números-de-whatsapp)
- [RF06 – Papéis, Hierarquia e Permissões](#rf06--papéis-hierarquia-e-permissões)

**Cadastros de apoio**

- [RF07 – Plano de Categorias](#rf07--plano-de-categorias)
- [RF08 – Formas de Pagamento e Taxas](#rf08--formas-de-pagamento-e-taxas)
- [RF09 – Canais de Venda e Comissões](#rf09--canais-de-venda-e-comissões)
- [RF10 – Fornecedores](#rf10--fornecedores)

**Canal WhatsApp**

- [RF11 – Identificação do Remetente e Consentimento no WhatsApp](#rf11--identificação-do-remetente-e-consentimento-no-whatsapp)
- [RF12 – Lançamento por Mensagem de Texto](#rf12--lançamento-por-mensagem-de-texto)
- [RF13 – Lançamento por Áudio](#rf13--lançamento-por-áudio)
- [RF14 – Lançamento por Foto de Cupom ou Nota](#rf14--lançamento-por-foto-de-cupom-ou-nota)
- [RF15 – Pergunta de Volta (informação essencial faltante)](#rf15--pergunta-de-volta-informação-essencial-faltante)
- [RF16 – Confirmação do Lançamento](#rf16--confirmação-do-lançamento)
- [RF17 – Correção por Resposta (reply)](#rf17--correção-por-resposta-reply)
- [RF18 – Desfazer Lançamento](#rf18--desfazer-lançamento)
- [RF19 – Comandos, Ajuda, Suporte e Fora do Escopo](#rf19--comandos-ajuda-suporte-e-fora-do-escopo)
- [RF20 – Relatórios e Consultas pelo WhatsApp (por hierarquia)](#rf20--relatórios-e-consultas-pelo-whatsapp-por-hierarquia)
- [RF21 – Limites de Uso e Proteção contra Abuso](#rf21--limites-de-uso-e-proteção-contra-abuso)

**Painel**

- [RF22 – Lista e Pesquisa de Lançamentos](#rf22--lista-e-pesquisa-de-lançamentos)
- [RF23 – Edição de Lançamento no Painel](#rf23--edição-de-lançamento-no-painel)
- [RF24 – Lixeira: Exclusão e Restauração de Lançamentos](#rf24--lixeira-exclusão-e-restauração-de-lançamentos)
- [RF25 – Ver Origem e Histórico de Versões](#rf25--ver-origem-e-histórico-de-versões)
- [RF26 – Lançamento Manual no Painel](#rf26--lançamento-manual-no-painel)
- [RF27 – Dashboard (indicadores e gráficos)](#rf27--dashboard-indicadores-e-gráficos)

**Relatórios**

- [RF28 – DRE Gerencial e Fechamento Mensal (PDF)](#rf28--dre-gerencial-e-fechamento-mensal-pdf)
- [RF29 – Exportação de Dados (Excel e CSV)](#rf29--exportação-de-dados-excel-e-csv)
- [RF30 – Perguntas em Linguagem Natural sobre os Dados (painel)](#rf30--perguntas-em-linguagem-natural-sobre-os-dados-painel)

**Automações e integrações**

- [RF31 – Captura Automática de Notas Fiscais por E-mail](#rf31--captura-automática-de-notas-fiscais-por-e-mail)
- [RF32 – Captura de NF-e pela SEFAZ com Certificado Digital](#rf32--captura-de-nf-e-pela-sefaz-com-certificado-digital)
- [RF33 – Lançamentos Recorrentes](#rf33--lançamentos-recorrentes)
- [RF34 – Resumo Semanal e Alertas por Exceção](#rf34--resumo-semanal-e-alertas-por-exceção)
- [RF35 – Importação de Planilhas, Extratos e Relatórios de Vendas](#rf35--importação-de-planilhas-extratos-e-relatórios-de-vendas)
- [RF36 – Acesso do Contador (multicliente)](#rf36--acesso-do-contador-multicliente)

**Assinatura e operação**

- [RF37 – Assinatura, Plano, Período de Teste e Encerramento da Conta](#rf37--assinatura-plano-período-de-teste-e-encerramento-da-conta)
- [RF38 – Painel Interno de Operação (equipe do produto)](#rf38--painel-interno-de-operação-equipe-do-produto)

**Requisitos não funcionais**

- [RNF01 – Segurança de Acesso e Credenciais](#rnf01--segurança-de-acesso-e-credenciais)
- [RNF02 – Isolamento entre Empresas (multiempresa)](#rnf02--isolamento-entre-empresas-multiempresa)
- [RNF03 – Privacidade e LGPD](#rnf03--privacidade-e-lgpd)
- [RNF04 – Auditoria e Rastreabilidade](#rnf04--auditoria-e-rastreabilidade)
- [RNF05 – Desempenho e Tempo de Resposta](#rnf05--desempenho-e-tempo-de-resposta)
- [RNF06 – Disponibilidade, Backup e Recuperação](#rnf06--disponibilidade-backup-e-recuperação)
- [RNF07 – Qualidade da Interpretação por IA](#rnf07--qualidade-da-interpretação-por-ia)
- [RNF08 – Custo Operacional de IA e Mensagens](#rnf08--custo-operacional-de-ia-e-mensagens)
- [RNF09 – Usabilidade, Acessibilidade e Idioma](#rnf09--usabilidade-acessibilidade-e-idioma)
- [RNF10 – Plataformas e Compatibilidade](#rnf10--plataformas-e-compatibilidade)
- [RNF11 – Observabilidade e Registros (logs)](#rnf11--observabilidade-e-registros-logs)
- [RNF12 – Conformidade com a Política do WhatsApp Business](#rnf12--conformidade-com-a-política-do-whatsapp-business)
- [RNF13 – Integridade de Valores Monetários e Datas](#rnf13--integridade-de-valores-monetários-e-datas)
- [RNF14 – Manutenibilidade e Testes](#rnf14--manutenibilidade-e-testes)

Seções gerais: [1 Introdução](#1-introdução) · [2 Visão geral](#2-visão-geral) · [3 Requisitos funcionais](#3-requisitos-funcionais) · [4 Requisitos não funcionais](#4-requisitos-não-funcionais) · [5 Pendências](#5-pendências-e-decisões-em-aberto)

# Controle de versões

| Versão | Data | Descrição | Autor |
|---|---|---|---|
| 1.0 | 29/10/2026 | Criação do documento a partir do planejamento, da arquitetura, do escopo do MVP e dos planos de desenvolvimento do repositório. | Luís |

# 1. Introdução

## 1.1 Objetivo do documento

Este documento descreve os requisitos funcionais e não funcionais do produto, em nível de detalhe suficiente para desenvolvimento, testes e validação com os sócios e com os restaurantes piloto. Cada requisito traz os campos com seus tipos, as regras de preenchimento numeradas, observações, o tratamento de alteração, exclusão e pesquisa e os critérios de aceite.

Protótipos de tela e fluxos detalhados (principal, alternativos e de exceção) ficam fora desta versão e serão acrescentados em versões futuras.

## 1.2 Escopo do produto

**Problema.** Restaurantes pequenos e médios têm dificuldade em manter o controle financeiro: planilhas são trabalhosas, dependem de uma pessoa específica e muitas vezes não existem. O dono não sabe quanto lucra nem para onde vai o dinheiro.

**Solução.** Qualquer colaborador responsável por compras ou caixa registra gastos e vendas pelo WhatsApp, do jeito que falaria: texto, áudio ou foto da nota. A IA interpreta, registra no lugar certo e confirma. O dono e a gerência acompanham tudo em um painel (aplicação web instalável no celular e no computador), com gráficos, relatórios, edição dos lançamentos e exportação, e podem pedir relatórios pelo próprio WhatsApp, conforme a hierarquia.

**Cliente-alvo.** Restaurantes, bares e lanchonetes de pequeno e médio porte, com uma ou várias unidades, e usuários de familiaridade tecnológica baixa a média.

**Natureza.** Controle gerencial. O produto é aliado do contador, não o substitui.

## 1.3 Fora do escopo

- Emissão, escrituração ou conciliação fiscal de notas; apuração e pagamento de impostos.
- Controle de estoque e ficha técnica de pratos (a precificação sugerida por prato é evolução futura).
- Pagamentos, cobranças a clientes do restaurante e integração com maquininhas para captura de vendas.
- Aplicativo nativo de loja no MVP (o painel é PWA).
- Funcionamento offline.
- Conversa livre com IA no WhatsApp (o assistente é de função específica).

## 1.4 Documentos de referência

| Documento (repositório) | Conteúdo |
|---|---|
| docs/planejamento.md | Decisões de produto, usuários, regras, LGPD e negócio |
| docs/arquitetura.md | Stack, decisões técnicas, fluxo e modelo de dados |
| docs/mvp.md | Escopo da primeira versão, por fases |
| docs/plano-dev-canal-whatsapp.md | Plano do canal WhatsApp (etapas E1 a E13) |
| docs/plano-dev-frontend.md | Plano do painel (etapas F0 a F10) |
| docs/decisoes.md | Registro de decisões (por quê) |
| docs/politica-meta-whatsapp.md | Política da Meta para chatbots e mensagens |
| TODOLIST.md | Responsáveis e pendências dos sócios |

## 1.5 Convenções

| Item | Convenção |
|---|---|
| **Identificação** | RFnn para requisitos funcionais e RNFnn para não funcionais. CAnn são critérios de aceite, no formato "Dado..., quando..., então...". Pnn são pendências (seção 5). |
| **Prioridade** | Essencial: sem ele o produto não cumpre o objetivo. Importante: alto valor, pode vir logo depois. Desejável: melhoria que pode esperar. |
| **Fase** | MVP: primeira versão, usada no piloto. v1.1: logo após o MVP. Fase 2: depende de validação ou integração externa. |
| **Campo obrigatório** | Nome do campo seguido de asterisco (\*). |
| **Regras numeradas** | Número sobrescrito ao lado do campo (ex.: CNPJ<sup>3</sup>) remete à regra de mesmo número logo abaixo, dentro do mesmo requisito. |
| **Tipos** | String (texto), Inteiro, Decimal, Moeda (sempre guardada em centavos inteiros), Percentual (guardado em pontos-base: 320 = 3,20%), Date (data sem hora), DateTime (data e hora com fuso), Boolean (sim/não), Enum (lista fechada de valores, escritos em MAIÚSCULAS), Lista, Referência (vínculo a outro cadastro) e Mídia (arquivo). |

> **Neste arquivo (`requisitos.md`):** os números sobrescritos viram a coluna **Regra** (`R1`, `R2`…) e as regras viram **R1, R2…**. Cada regra e cada critério de aceite tem referência estável: `RF12.R5`, `RF12.CA04`. Pendências ainda não resolvidas aparecem no texto como `[PROVISÓRIO – Pxx]`, com a proposta adotada.

## 1.6 Decisões incorporadas nesta versão

Decisões tomadas com os sócios durante a elaboração deste documento e que complementam ou alteram os documentos de referência:

| Decisão | Descrição |
|---|---|
| **Painel como PWA** | Aplicação web responsiva e instalável no celular e no computador no MVP; aplicativo nativo só com demanda clara. Mantém o que os docs já definiam. |
| **Autocadastro do dono** | O dono cria a conta sozinho no painel, com período de teste (RF01). Muda o plano do painel, que previa só usuários convidados (disableSignUp). |
| **Acesso por senha ou código** | O usuário escolhe entre código por e-mail e senha (RF02 e RF03). Amplia a decisão D-F5, que previa só código por e-mail. |
| **Relatórios pelo WhatsApp por hierarquia** | Dono, Gerente e Lançador recebem relatórios diferentes pelo WhatsApp (RF20). Interpretação livre na v1.1; resumos predefinidos podem ser antecipados (P10). |
| **Captura de notas por e-mail** | Endereço exclusivo por empresa e leitura do XML da NF-e (RF31), na v1.1; consulta pela SEFAZ com certificado A1 na Fase 2 (RF32). |
| **Papel Contador** | Mantido como quarto papel, na Fase 2 (RF36). O código atual tem três papéis (owner, manager, staff). |

## 1.7 Glossário

| Termo | Significado |
|---|---|
| **Empresa (conta)** | Cliente do produto. Agrupa unidades, colaboradores e lançamentos. No código: tenant. |
| **Unidade** | Restaurante, filial ou ponto de venda de uma empresa. Todo lançamento pertence a uma unidade. |
| **Colaborador** | Pessoa vinculada a uma empresa com um papel (Dono, Gerente, Lançador ou Contador). |
| **Lançamento** | Registro de uma despesa ou receita, com valor, data, categoria e origem. No código: entry. |
| **Data de competência** | Dia em que o gasto ou a venda aconteceu, usado nos relatórios. |
| **Valor bruto, taxa e líquido** | Valor da venda, valor retido pela maquininha ou aplicativo e o que efetivamente entra (bruto − taxa). |
| **DRE gerencial** | Demonstração do resultado simplificada: receitas, deduções, custos, despesas e resultado. |
| **CMV** | Custo da mercadoria vendida: insumos usados para produzir o que foi vendido. |
| **Categoria sensível** | Categoria de folha de pagamento e afins, com acesso restrito (RF06). |
| **NFC-e** | Nota fiscal de consumidor eletrônica (cupom), com QR Code que leva à consulta na SEFAZ. |
| **NF-e e chave de acesso** | Nota fiscal eletrônica emitida para um CNPJ; a chave de acesso (44 dígitos) a identifica de forma única. |
| **SEFAZ** | Secretaria da Fazenda estadual, onde as notas podem ser consultadas. |
| **Opt-in** | Consentimento do usuário para receber mensagens do produto no WhatsApp. |
| **Janela de 24 horas** | Período após a última mensagem do usuário em que o produto pode responder livremente; fora dela, só modelos aprovados. |
| **Modelo de mensagem (template)** | Mensagem pré-aprovada pela Meta, necessária para iniciar conversa. |
| **PWA** | Aplicação web que pode ser instalada no celular e no computador como um aplicativo. |
| **Confirmação** | Resposta enviada pelo produto após gravar, com o que foi registrado e como corrigir. |
| **Correção por resposta** | Responder (reply) à confirmação no WhatsApp para corrigir um lançamento. |
| **Lixeira** | Lugar para onde vão os lançamentos excluídos; nada é apagado de verdade. |
| **Versão** | Registro imutável de cada criação ou alteração de um lançamento. |
| **Sinal de revisão** | Marca em um lançamento que merece conferência (categoria incerta, possível duplicidade, data antiga). |
| **Pontos-base** | Forma inteira de guardar percentuais: 1% = 100 pontos-base. |

# 2. Visão geral

## 2.1 Atores e papéis

| Ator | Descrição | Canais | Fase |
|---|---|---|---|
| **Dono** | Responsável pelo restaurante. Cria a conta, cadastra colaboradores e define hierarquias. Acesso total, inclusive folha de pagamento. | WhatsApp e painel | MVP |
| **Gerente** | Lança, corrige lançamentos da equipe e acompanha relatórios das suas unidades. Sem folha, salvo permissão. | WhatsApp e painel | MVP |
| **Lançador** | Compras, caixa, cozinha. Lança pelo WhatsApp e corrige só o que lançou. | WhatsApp (painel opcional) | MVP |
| **Contador** | Contador do restaurante. Leitura e exportação em todas as unidades. | Painel | Fase 2 |
| **Administrador interno** | Equipe do produto. Opera o painel interno, sem acesso ao conteúdo financeiro sem autorização. | Painel interno | MVP |
| **Sistema** | Processos automáticos: recorrências, captura de notas, resumos. | — | v1.1 |

## 2.2 Canais do produto

- **WhatsApp (canal principal de entrada):** lançamentos por texto, áudio e foto; correção, desfazer e ajuda; relatórios conforme a hierarquia. Número único do produto; cada colaborador é identificado pelo próprio celular.
- **Painel (PWA):** cadastro da empresa, acesso por senha ou código, colaboradores e hierarquias, consulta e edição de lançamentos, gráficos, relatórios e exportação. Instalável no celular e no computador.
- **E-mail:** códigos de acesso, convites, fechamento mensal e, na v1.1, recebimento automático de notas fiscais.

## 2.3 Matriz de permissões

Referência para o RF06 e para os testes de permissão. Valores entre papéis podem ser ampliados pelo Dono com as permissões adicionais VER_FOLHA, EXPORTAR_DADOS, RECEBER_RESUMO_SEMANAL e CONSULTAR_RELATORIOS_WHATSAPP (RF05).

| Ação | Dono | Gerente | Lançador | Contador (Fase 2) |
|---|---|---|---|---|
| Lançar pelo WhatsApp | Sim | Sim | Sim | Não |
| Lançar categoria sensível (folha) | Sim | Com VER_FOLHA | Não | Não |
| Corrigir e desfazer os próprios lançamentos | Sim | Sim | Sim | Não |
| Corrigir e desfazer lançamentos de outros | Sim | Suas unidades | Não | Não |
| Pedir relatórios pelo WhatsApp | Sim | Suas unidades | Só os próprios lançamentos¹ | Não |
| Receber resumo semanal e alertas | Sim | Com permissão | Não | Não |
| Acessar o painel | Sim | Sim | Se o Dono liberar | Sim |
| Ver lançamentos no painel | Todos | Suas unidades | Só os próprios | Todos (leitura) |
| Ver categorias sensíveis | Sim | Com VER_FOLHA | Não | Com VER_FOLHA |
| Editar, excluir e restaurar no painel | Sim | Suas unidades | Só os próprios | Não |
| Ver dashboard, DRE e perguntar sobre os dados | Sim | Suas unidades | Não | Sim |
| Exportar dados | Sim | Com EXPORTAR_DADOS | Não | Sim |
| Importar planilhas e extratos | Sim | Sim | Não | Não |
| Gerenciar recorrências | Sim | Sim | Não | Não |
| Gerenciar colaboradores, papéis e permissões | Sim | Consulta | Não | Não |
| Gerenciar unidades, categorias, formas de pagamento e canais | Sim | Consulta | Não | Consulta |
| Configurar captura de notas e certificado | Sim | Não | Não | Não |
| Assinatura, plano e encerramento | Sim | Não | Não | Não |

¹ Com a permissão CONSULTAR_RELATORIOS_WHATSAPP, o Lançador recebe os relatórios das suas unidades, sem folha. "Suas unidades" = Unidades de Acesso do colaborador (RF05). Categorias sensíveis seguem o RF06, regra 3, em todas as linhas.

## 2.4 Resumo dos requisitos funcionais

| ID | Requisito | Módulo | Prioridade | Fase |
|---|---|---|---|---|
| [RF01](#rf01--cadastro-de-empresa-autocadastro) | Cadastro de Empresa (autocadastro) | Conta e acesso | Essencial | MVP |
| [RF02](#rf02--autenticação-e-sessão-senha-ou-código) | Autenticação e Sessão (senha ou código) | Conta e acesso | Essencial | MVP |
| [RF03](#rf03--recuperação-de-acesso) | Recuperação de Acesso | Conta e acesso | Essencial | MVP |
| [RF04](#rf04--cadastro-de-unidades-restaurantes) | Cadastro de Unidades (restaurantes) | Conta e acesso | Essencial | MVP |
| [RF05](#rf05--cadastro-de-colaboradores-e-números-de-whatsapp) | Cadastro de Colaboradores e Números de WhatsApp | Conta e acesso | Essencial | MVP |
| [RF06](#rf06--papéis-hierarquia-e-permissões) | Papéis, Hierarquia e Permissões | Conta e acesso | Essencial | MVP |
| [RF07](#rf07--plano-de-categorias) | Plano de Categorias | Cadastros de apoio | Essencial | MVP |
| [RF08](#rf08--formas-de-pagamento-e-taxas) | Formas de Pagamento e Taxas | Cadastros de apoio | Essencial | MVP |
| [RF09](#rf09--canais-de-venda-e-comissões) | Canais de Venda e Comissões | Cadastros de apoio | Importante | MVP |
| [RF10](#rf10--fornecedores) | Fornecedores | Cadastros de apoio | Importante | MVP |
| [RF11](#rf11--identificação-do-remetente-e-consentimento-no-whatsapp) | Identificação do Remetente e Consentimento no WhatsApp | Canal WhatsApp | Essencial | MVP |
| [RF12](#rf12--lançamento-por-mensagem-de-texto) | Lançamento por Mensagem de Texto | Canal WhatsApp | Essencial | MVP |
| [RF13](#rf13--lançamento-por-áudio) | Lançamento por Áudio | Canal WhatsApp | Essencial | MVP |
| [RF14](#rf14--lançamento-por-foto-de-cupom-ou-nota) | Lançamento por Foto de Cupom ou Nota | Canal WhatsApp | Essencial | MVP |
| [RF15](#rf15--pergunta-de-volta-informação-essencial-faltante) | Pergunta de Volta (informação essencial faltante) | Canal WhatsApp | Essencial | MVP |
| [RF16](#rf16--confirmação-do-lançamento) | Confirmação do Lançamento | Canal WhatsApp | Essencial | MVP |
| [RF17](#rf17--correção-por-resposta-reply) | Correção por Resposta (reply) | Canal WhatsApp | Essencial | MVP |
| [RF18](#rf18--desfazer-lançamento) | Desfazer Lançamento | Canal WhatsApp | Essencial | MVP |
| [RF19](#rf19--comandos-ajuda-suporte-e-fora-do-escopo) | Comandos, Ajuda, Suporte e Fora do Escopo | Canal WhatsApp | Essencial | MVP |
| [RF20](#rf20--relatórios-e-consultas-pelo-whatsapp-por-hierarquia) | Relatórios e Consultas pelo WhatsApp (por hierarquia) | Canal WhatsApp | Importante | v1.1 |
| [RF21](#rf21--limites-de-uso-e-proteção-contra-abuso) | Limites de Uso e Proteção contra Abuso | Canal WhatsApp | Essencial | MVP |
| [RF22](#rf22--lista-e-pesquisa-de-lançamentos) | Lista e Pesquisa de Lançamentos | Painel | Essencial | MVP |
| [RF23](#rf23--edição-de-lançamento-no-painel) | Edição de Lançamento no Painel | Painel | Essencial | MVP |
| [RF24](#rf24--lixeira-exclusão-e-restauração-de-lançamentos) | Lixeira: Exclusão e Restauração de Lançamentos | Painel | Essencial | MVP |
| [RF25](#rf25--ver-origem-e-histórico-de-versões) | Ver Origem e Histórico de Versões | Painel | Essencial | MVP |
| [RF26](#rf26--lançamento-manual-no-painel) | Lançamento Manual no Painel | Painel | Desejável | v1.1 |
| [RF27](#rf27--dashboard-indicadores-e-gráficos) | Dashboard (indicadores e gráficos) | Painel | Essencial | MVP |
| [RF28](#rf28--dre-gerencial-e-fechamento-mensal-pdf) | DRE Gerencial e Fechamento Mensal (PDF) | Relatórios | Importante | v1.1 |
| [RF29](#rf29--exportação-de-dados-excel-e-csv) | Exportação de Dados (Excel e CSV) | Relatórios | Essencial | MVP |
| [RF30](#rf30--perguntas-em-linguagem-natural-sobre-os-dados-painel) | Perguntas em Linguagem Natural sobre os Dados (painel) | Relatórios | Importante | v1.1 |
| [RF31](#rf31--captura-automática-de-notas-fiscais-por-e-mail) | Captura Automática de Notas Fiscais por E-mail | Automações e integrações | Importante | v1.1 |
| [RF32](#rf32--captura-de-nf-e-pela-sefaz-com-certificado-digital) | Captura de NF-e pela SEFAZ com Certificado Digital | Automações e integrações | Desejável | Fase 2 |
| [RF33](#rf33--lançamentos-recorrentes) | Lançamentos Recorrentes | Automações e integrações | Importante | v1.1 |
| [RF34](#rf34--resumo-semanal-e-alertas-por-exceção) | Resumo Semanal e Alertas por Exceção | Automações e integrações | Importante | v1.1 |
| [RF35](#rf35--importação-de-planilhas-extratos-e-relatórios-de-vendas) | Importação de Planilhas, Extratos e Relatórios de Vendas | Automações e integrações | Importante | v1.1 |
| [RF36](#rf36--acesso-do-contador-multicliente) | Acesso do Contador (multicliente) | Automações e integrações | Desejável | Fase 2 |
| [RF37](#rf37--assinatura-plano-período-de-teste-e-encerramento-da-conta) | Assinatura, Plano, Período de Teste e Encerramento da Conta | Assinatura e operação | Importante | MVP |
| [RF38](#rf38--painel-interno-de-operação-equipe-do-produto) | Painel Interno de Operação (equipe do produto) | Assinatura e operação | Importante | MVP |

# 3. Requisitos funcionais

## 3.1 Conta e acesso

### RF01 – Cadastro de Empresa (autocadastro)

**Prioridade:** Essencial · **Fase:** MVP · **Módulo:** Conta e acesso

Requisito responsável pela criação de uma nova conta (empresa cliente) pelo próprio dono do restaurante, no painel, sem intervenção da equipe do produto. Ao final, existem a empresa, a primeira unidade e o usuário Dono, e o restaurante entra no período de teste.

**Cadastro da Empresa:**

**Empresa**

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| Nome Fantasia | String | Sim | R1 |
| Razão Social | String | Não | R2 |
| CNPJ | String (xx.xxx.xxx/xxxx-xx) | Não | R3 |
| Segmento | Enum | Sim | R4 |
| Regime Tributário | Enum | Não | R5 |
| Faixa de Faturamento Mensal | Enum | Não | R6 |

**Primeira Unidade**

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| Nome da Unidade | String | Sim | R7 |
| Município | String | Sim |  |
| Estado (UF) | String (UF) | Sim | R8 |

**Responsável (Dono)**

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| Nome Completo | String | Sim | R9 |
| E-mail | String | Sim | R10 |
| Celular (WhatsApp) | String (xx) xxxxx-xxxx | Sim | R11 |
| Senha | String | Não | R12 |
| Aceite dos Termos de Uso e da Política de Privacidade | Boolean + Data/hora + Versão dos documentos | Sim | R13 |

**Acesso e Controle**

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| Código de Indicação | String | Não | R14 |
| Plano | Enum | Não | R15 |
| Início do Período de Teste | DateTime | Não |  |
| Fim do Período de Teste | DateTime | Não | R15 |
| Situação da Conta | Enum | Não | R16 |
| Data do Cadastro | DateTime (dd/mm/aaaa hh:mm) | Não |  |

**Regras e observações do preenchimento dos campos:**

- **R1** Nome Fantasia é o nome exibido no painel e nas mensagens do WhatsApp quando o usuário tem acesso a mais de uma empresa. Deve ter de 2 a 100 caracteres, sem espaços nas pontas.
- **R2** Razão Social é opcional (até 150 caracteres). Quando o CNPJ é informado, o sistema pode sugerir a razão social a partir de consulta pública, sempre editável.
- **R3** CNPJ é opcional no autocadastro, porque o dono pode ainda não tê-lo à mão. Quando informado, deve ter os dígitos verificadores válidos e sequências repetidas são recusadas. Um CNPJ só pode estar em uma conta com situação diferente de ENCERRADA, garantido por restrição de unicidade no banco de dados (inclusive em cadastros simultâneos). O CNPJ passa a ser obrigatório para habilitar a captura de notas por e-mail (RF31).
- **R4** Segmento: RESTAURANTE, BAR, LANCHONETE, PIZZARIA, PADARIA, CAFETERIA, HAMBURGUERIA, FOOD_TRUCK ou OUTRO. Usado para ajustar sugestões de categorias e para métricas internas.
- **R5** Regime Tributário é opcional: MEI, SIMPLES_NACIONAL, LUCRO_PRESUMIDO, LUCRO_REAL ou NAO_SEI. Influencia o tratamento de impostos sobre faturamento nos relatórios (ver pendência P05).
- **R6** Faixa de Faturamento Mensal é opcional: ATE_30_MIL, DE_30_A_100_MIL, DE_100_A_300_MIL, ACIMA_DE_300_MIL ou PREFIRO_NAO_INFORMAR. Usada só para segmentação comercial; nunca aparece para outros usuários da conta.
- **R7** Nome da Unidade tem de 2 a 60 caracteres e é o nome usado nas confirmações do WhatsApp (ex.: "Restaurante Centro"). Pode ser igual ao Nome Fantasia quando houver uma só unidade, e o campo vem pré-preenchido com ele.
- **R8** A UF da unidade define qual SEFAZ é consultada na leitura de cupons (RF14) e o fuso horário sugerido da unidade (RF04).
- **R9** Nome Completo tem de 3 a 120 caracteres (letras, espaços, apóstrofo e hífen). O primeiro nome é usado nas mensagens do WhatsApp.
- **R10** E-mail é o identificador de acesso ao painel. Deve ter formato válido, até 254 caracteres, ser único no sistema (uma pessoa, um e-mail) e ser verificado por código de 6 dígitos, válido por 5 minutos, antes da gravação. Cada código aceita até 3 tentativas; o reenvio é liberado 60 segundos após cada envio, com no máximo 5 envios por hora para o mesmo e-mail.
- **R11** Celular é o número que lança pelo WhatsApp. É normalizado para o formato internacional E.164 (+55 DDD número). Números brasileiros com e sem o 9º dígito são tratados como o mesmo número. Um celular pertence a uma única pessoa no sistema; se o número já pertence a outro usuário, o cadastro é interrompido (FE02) sem revelar a qual conta ele está vinculado.
- **R12** Senha é opcional, porque o acesso pode ser feito só com código por e-mail (RF02). Quando informada, deve ter de 8 a 64 caracteres, com letras e números, ser diferente do e-mail e igual à confirmação. Nunca é exibida nem armazenada em texto puro (RNF01).
- **R13** O aceite é obrigatório e sem valor pré-marcado. O sistema registra a data e a hora do aceite e a versão vigente dos Termos de Uso, da Política de Privacidade e do Acordo de Tratamento de Dados (DPA), no qual o restaurante é o controlador e o produto é o operador dos dados (LGPD).
- **R14** Código de Indicação é opcional e identifica o contador ou parceiro que indicou o produto (canal de vendas). Código inexistente é recusado com mensagem, sem bloquear o cadastro se o campo for apagado.
- **R15** Toda conta nasce com Plano = TESTE. A duração do teste é configurada pela equipe do produto (sugestão: 14 dias; pilotos podem receber 60 a 90 dias). Os demais planos são ESSENCIAL e PROFISSIONAL (RF37). **[PROVISÓRIO – P03]** Duração do teste, planos e preços ainda serão definidos pelos sócios. Proposta adotada: teste de 14 dias; pilotos com 60 a 90 dias.
- **R16** Situação da Conta pode ser ATIVA, SOMENTE_LEITURA (teste vencido ou pagamento pendente: o painel continua consultável, mas novos lançamentos são recusados com aviso), CANCELADA (encerramento solicitado; dados disponíveis por 90 dias) ou ENCERRADA (dados eliminados ou anonimizados após o prazo). As transições estão no RF37.

- **Obs1:** Atores: Visitante (futuro Dono). Sistemas externos: serviço de envio de e-mail e, opcionalmente, consulta pública de CNPJ. A tela de cadastro é acessível sem login.
- **Obs2:** A gravação acontece em uma única transação ao final: empresa, unidade, usuário Dono, vínculo do Dono com todas as unidades, formas de pagamento e canais de venda padrão (RF08 e RF09). Abandonar o cadastro ou falhar em qualquer etapa não deixa registro parcial.
- **Obs3:** Ao concluir, o sistema exibe o número de WhatsApp do produto, com link direto e QR Code, e orienta o dono a enviar a primeira mensagem, que registra o consentimento para receber mensagens (opt-in, RF11). Em seguida oferece o assistente inicial: cadastrar colaboradores (RF05) e revisar as taxas (RF08).
- **Obs4:** O autocadastro cria contas novas. Um usuário que já existe e foi convidado para outra conta entra por convite (RF05), não por este requisito.

**Alteração:**

O Dono pode alterar todos os campos da empresa, exceto Plano e Situação, que seguem o RF37. Alterar o CNPJ exige confirmação e, se a captura de notas por e-mail estiver ativa, interrompe a captura até a nova validação. Os dados do responsável são alterados no perfil (RF02). Em todos os casos deve ser mantido o histórico das alterações, contendo quem realizou a operação, o valor anterior e o novo, com data e hora.

**Exclusão:**

Não será realizada exclusão física da empresa por este requisito. O encerramento da conta e a eliminação dos dados seguem o RF37 e a LGPD.

**Pesquisa:**

Não se aplica ao cliente: cada usuário enxerga apenas as empresas às quais tem vínculo. A equipe interna localiza contas no painel interno (RF38) por nome fantasia ou CNPJ, sem acesso aos lançamentos.

**Critérios de aceite:**

- **CA01** – Dado o CNPJ 11.222.333/0001-00 (dígitos inválidos), quando o visitante tenta avançar, então o campo é destacado com a mensagem de dígito verificador e os demais dados são mantidos.
- **CA02** – Dado um e-mail não verificado, quando o visitante tenta concluir, então a conclusão é bloqueada até a digitação do código correto.
- **CA03** – Dado um código digitado após 5 minutos, quando é enviado, então é recusado e o visitante pode pedir outro depois de 60 segundos.
- **CA04** – Dadas duas requisições simultâneas com o mesmo CNPJ, quando ambas chegam à gravação, então apenas uma conta é criada e a outra recebe a mensagem de CNPJ já cadastrado.
- **CA05** – Dado um celular que já pertence a outro usuário, quando é informado, então o cadastro é interrompido com orientação para falar com o suporte, sem revelar a conta existente.
- **CA06** – Dado o aceite dos termos não marcado, quando o visitante tenta concluir, então a conclusão é bloqueada; ao marcar, a data, a hora e as versões dos documentos são registradas.
- **CA07** – Dado um cadastro concluído, quando a conta é consultada, então existem a empresa, uma unidade, o usuário com papel Dono em todas as unidades, as formas de pagamento e os canais padrão, Plano = TESTE e Situação = ATIVA.
- **CA08** – Dada uma falha no meio da gravação, quando o cadastro é interrompido, então nenhuma empresa, unidade ou usuário parcial fica no banco.
- **CA09** – Dado o celular 82 9658-5647 (sem o 9º dígito), quando é gravado, então fica no formato canônico +55 82 99658-5647.
- **CA10** – Dada uma senha "12345678" ou igual ao e-mail, quando é informada, então é recusada; e a consulta ao banco não encontra nenhuma senha em texto puro.

### RF02 – Autenticação e Sessão (senha ou código)

**Prioridade:** Essencial · **Fase:** MVP · **Módulo:** Conta e acesso

Requisito responsável pelo acesso ao painel. O usuário entra com e-mail e senha ou com um código de uso único enviado ao e-mail, escolhe a empresa e a unidade com que vai trabalhar e mantém uma sessão segura. O acesso pelo WhatsApp não usa login: é identificado pelo número (RF11).

**Acesso:**

**Credenciais**

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| E-mail | String | Sim | R1 |
| Modo de Acesso | Enum | Sim | R2 |
| Senha | String | Não | R3 |
| Código de Acesso | String (6 dígitos) | Não | R4 |
| Manter Conectado | Boolean | Não | R5 |

**Contexto da Sessão**

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| Empresa Ativa | Referência | Não | R6 |
| Unidade Ativa | Referência ou TODAS | Não | R6 |

**Controle**

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| Tentativas de Senha Malsucedidas | Inteiro | Não | R7 |
| Bloqueado Até | DateTime | Não | R7 |
| Último Acesso | DateTime | Não |  |
| Sessões Ativas | Lista | Não | R8 |

**Regras e observações do preenchimento dos campos:**

- **R1** Só entram usuários que existem e têm pelo menos um vínculo ativo (RF05). Um e-mail desconhecido ou de usuário sem vínculo ativo recebe a mesma resposta de um e-mail conhecido ("se o e-mail estiver cadastrado, você receberá o código"), para não revelar quem é cliente.
- **R2** Modo de Acesso: SENHA ou CODIGO. A tela abre no modo CODIGO, que é o mais simples para o público do produto, e oferece "Entrar com senha". Usuário sem senha definida que escolhe SENHA é orientado a usar o código ou a definir uma senha pelo fluxo de recuperação (RF03).
- **R3** Senha segue as mesmas regras do RF01 (8 a 64 caracteres, letras e números, armazenada apenas como hash forte com sal).
- **R4** Código de Acesso tem 6 dígitos numéricos, vale por 5 minutos e aceita até 3 tentativas; depois disso o código é invalidado e é preciso pedir outro. Reenvio liberado 60 segundos após cada envio, com no máximo 5 envios por hora por e-mail e 20 por hora por endereço IP. Pedir um código novo invalida o anterior. O envio do código por WhatsApp é uma evolução prevista (Fase: v1.1), dependente de modelo de mensagem aprovado pela Meta.
- **R5** Manter Conectado estende a sessão para 30 dias com renovação a cada uso; sem ele, a sessão expira após 12 horas de inatividade. A sessão é guardada em cookie httpOnly, secure e sameSite=lax.
- **R6** Ao entrar, o sistema seleciona a última empresa e unidade usadas. Usuário com vínculo em mais de uma empresa ou unidade vê um seletor sempre visível no topo do painel. A cada requisição, o servidor revalida que o vínculo com a empresa e a unidade ativas existe e está ativo; trocar o cookie para outra empresa é recusado. Unidade Ativa = TODAS só aparece para quem tem acesso a todas as unidades.
- **R7** Após 5 tentativas de senha erradas seguidas, o acesso por senha fica bloqueado por 15 minutos (o acesso por código continua disponível). O bloqueio é informado sem dizer se o e-mail existe.
- **R8** O usuário pode ver suas sessões ativas (dispositivo, data do último uso) e encerrar todas as outras. Desativar o usuário (RF05) ou trocar a senha encerra todas as sessões dele.

- **Obs1:** Atores: todos os usuários com acesso ao painel (Dono, Gerente, Contador e o Lançador, quando o dono liberar o painel para ele).
- **Obs2:** A autorização real acontece no servidor em toda leitura e ação. Esconder botões na tela é conforto, não segurança.
- **Obs3:** "Meu perfil" permite ao usuário alterar o próprio nome, definir ou trocar a senha (exige a senha atual ou um código recém-enviado) e trocar o e-mail (o novo e-mail só passa a valer depois de verificado por código; até lá vale o anterior). O celular não é alterado pelo próprio usuário: é alterado pelo Dono (RF05), porque é a identidade no WhatsApp.
- **Obs4:** Segundo fator de autenticação opcional para o Dono (código por e-mail após a senha) está previsto para a Fase: v1.1.

**Alteração:**

Toda alteração de senha, de e-mail e todo bloqueio por tentativas ficam registrados na trilha de auditoria (RNF04), com data, hora, IP e dispositivo, sem guardar a senha.

**Exclusão:**

Não se aplica. Sair (logout) encerra a sessão atual; a desativação do acesso é feita pelo Dono no RF05.

**Pesquisa:**

Não se aplica.

**Critérios de aceite:**

- **CA01** – Dado um usuário convidado e ativo, quando pede o código e o digita corretamente em até 5 minutos, então entra no painel na última empresa e unidade usadas.
- **CA02** – Dado um e-mail que não existe no sistema, quando o visitante pede o código, então a tela mostra a mesma mensagem dada a um e-mail existente e nenhum e-mail é enviado.
- **CA03** – Dado um código errado três vezes, quando é tentado pela quarta vez, então é recusado como inválido e é preciso pedir outro.
- **CA04** – Dadas 5 senhas erradas seguidas, quando o usuário tenta a sexta, então o acesso por senha fica bloqueado por 15 minutos e o acesso por código continua disponível.
- **CA05** – Dado um usuário com vínculo em duas empresas, quando troca a empresa ativa no seletor, então nenhuma informação da empresa anterior aparece na tela, inclusive após voltar com o botão do navegador.
- **CA06** – Dado um cookie de sessão alterado para apontar outra empresa, quando qualquer dado é solicitado, então o servidor recusa a requisição.
- **CA07** – Dado um usuário desativado pelo Dono, quando tenta usar uma sessão aberta antes da desativação, então é desconectado na próxima requisição.
- **CA08** – Dada uma página protegida acessada sem sessão, quando é aberta, então o visitante é levado à tela de acesso; e a API recusa a chamada mesmo que a tela seja contornada.
- **CA09** – Dada a troca de senha, quando é concluída, então todas as outras sessões do usuário são encerradas.

### RF03 – Recuperação de Acesso

**Prioridade:** Essencial · **Fase:** MVP · **Módulo:** Conta e acesso

Requisito responsável por permitir que o usuário recupere o acesso ao painel quando esqueceu a senha, ou defina uma senha pela primeira vez, usando o e-mail verificado.

**Recuperação:**

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| E-mail | String | Sim | R1 |
| Código de Recuperação | String (6 dígitos) | Sim | R2 |
| Nova Senha | String | Sim | R3 |
| Confirmação da Nova Senha | String | Sim | R3 |

**Regras e observações do preenchimento dos campos:**

- **R1** A resposta ao pedido é sempre a mesma, exista ou não o e-mail, para não revelar quem é cliente.
- **R2** O código segue as regras do RF02 (6 dígitos, 5 minutos, 3 tentativas, reenvio após 60 segundos, limites por hora).
- **R3** Nova Senha segue as regras do RF01 e não pode ser igual à senha atual.

- **Obs1:** Concluída a recuperação, todas as sessões do usuário são encerradas e ele recebe um e-mail avisando da troca de senha, com orientação para procurar o suporte caso não tenha sido ele.
- **Obs2:** Usuário que perdeu o acesso ao próprio e-mail não recupera a conta sozinho: o Dono pode trocar o e-mail de um colaborador (RF05). Se for o próprio Dono, a troca é feita pelo suporte, mediante confirmação de identidade registrada no painel interno (RF38).

**Alteração:**

Não se aplica.

**Exclusão:**

Não se aplica.

**Pesquisa:**

Não se aplica.

**Critérios de aceite:**

- **CA01** – Dado um usuário sem senha definida, quando conclui a recuperação, então passa a poder entrar com senha.
- **CA02** – Dada a recuperação concluída, quando o usuário tenta usar uma sessão antiga, então ela foi encerrada; e um e-mail de aviso foi enviado.
- **CA03** – Dado um e-mail desconhecido, quando a recuperação é pedida, então a tela mostra a mesma mensagem e nenhum e-mail é enviado.

### RF04 – Cadastro de Unidades (restaurantes)

**Prioridade:** Essencial · **Fase:** MVP · **Módulo:** Conta e acesso

Requisito responsável pelo cadastro das unidades (restaurantes, filiais ou pontos de venda) de uma empresa. Todo lançamento pertence a exatamente uma unidade, e os relatórios podem ser vistos por unidade ou consolidados.

**Cadastro da Unidade:**

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| Nome da Unidade | String | Sim | R1 |
| Apelidos | Lista de String | Não | R2 |
| CNPJ da Unidade | String (xx.xxx.xxx/xxxx-xx) | Não | R3 |
| Município | String | Sim |  |
| Estado (UF) | String (UF) | Sim |  |
| Fuso Horário | Enum | Sim | R4 |
| Status | Enum | Não | R5 |
| Data do Cadastro | DateTime | Não |  |

**Regras e observações do preenchimento dos campos:**

- **R1** Nome da Unidade tem de 2 a 60 caracteres e é único dentro da empresa (sem diferenciar maiúsculas, minúsculas e acentos).
- **R2** Apelidos são formas curtas pelas quais os colaboradores se referem à unidade no WhatsApp ("Centro", "Praia", "loja 2"), até 5 por unidade, cada um com até 30 caracteres e único dentro da empresa. A IA usa o nome e os apelidos para reconhecer a unidade citada em uma mensagem.
- **R3** CNPJ da Unidade é opcional e serve para filiais com CNPJ próprio. Quando informado, deve ser válido. É usado para associar notas fiscais recebidas por e-mail à unidade certa (RF31).
- **R4** Fuso Horário vem sugerido a partir da UF (padrão America/Sao_Paulo) e define o que é "hoje" para os lançamentos da unidade.
- **R5** Status pode ser ATIVA ou INATIVA. Unidade inativa não recebe novos lançamentos, não aparece como opção no WhatsApp e continua visível nos relatórios de períodos passados. Não é possível inativar a última unidade ativa da empresa.

- **Obs1:** Atores: Dono. Gerente apenas consulta.
- **Obs2:** A quantidade máxima de unidades depende do plano (RF37). Ao atingir o limite, o sistema oferece a mudança de plano.
- **Obs3:** Ao criar uma unidade, os colaboradores com acesso a TODAS as unidades passam a ter acesso a ela automaticamente.

**Alteração:**

O Dono pode alterar todos os campos. Mudar o fuso horário não altera a data dos lançamentos já gravados. Em todos os casos deve ser mantido o histórico das alterações, com quem realizou, valor anterior e novo, data e hora.

**Exclusão:**

Não será realizada exclusão física. A unidade é inativada (regra 5), mantendo seus lançamentos e o histórico.

**Pesquisa:**

Lista de unidades da empresa com filtro por status e busca por nome ou apelido.

**Critérios de aceite:**

- **CA01** – Dada uma unidade "Centro" existente, quando o Dono tenta criar outra chamada "centro", então o nome é recusado como duplicado.
- **CA02** – Dada a única unidade ativa da empresa, quando o Dono tenta inativá-la, então a ação é bloqueada com explicação.
- **CA03** – Dada uma unidade inativada, quando um colaborador cita o apelido dela no WhatsApp, então o lançamento não é gravado nela e o colaborador é informado de que a unidade está inativa.
- **CA04** – Dada uma unidade com fuso America/Manaus, quando um lançamento sem data chega às 23h30 de Manaus, então a data gravada é a do dia em Manaus.
- **CA05** – Dado um Gerente, quando tenta criar ou alterar uma unidade, então a ação é recusada pela API.

### RF05 – Cadastro de Colaboradores e Números de WhatsApp

**Prioridade:** Essencial · **Fase:** MVP · **Módulo:** Conta e acesso

Requisito responsável pelo cadastro das pessoas que usam o produto em uma empresa: o Dono adiciona os números de WhatsApp dos funcionários, define o papel de cada um, as unidades em que atuam e se têm acesso ao painel. É o que permite que qualquer colaborador responsável por compras ou caixa lance pelo WhatsApp sem passar pelo dono ou pelo contador.

**Cadastro do Colaborador:**

**Identificação**

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| Nome | String | Sim | R1 |
| Celular (WhatsApp) | String (xx) xxxxx-xxxx | Sim | R2 |
| E-mail | String | Não | R3 |

**Vínculo com a Empresa**

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| Papel | Enum | Sim | R4 |
| Unidades de Acesso | Lista de Referência ou TODAS | Sim | R5 |
| Unidade Padrão | Referência | Sim | R6 |
| Acesso ao Painel | Boolean | Não | R3 |
| Permissões Adicionais | Lista de Enum | Não | R7 |

**Controle**

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| Situação do Vínculo | Enum | Não | R8 |
| Consentimento para Mensagens (opt-in) | Boolean + Data/hora + Mensagem de origem | Não | R9 |
| Convidado por | Referência | Não |  |
| Data do Convite | DateTime | Não |  |
| Data de Desativação | DateTime | Não |  |

**Regras e observações do preenchimento dos campos:**

- **R1** Nome tem de 2 a 120 caracteres. É o nome que aparece no histórico dos lançamentos ("lançado por").
- **R2** Celular segue a normalização do RF01 (E.164, com e sem o 9º dígito tratados como o mesmo número). Um número pertence a uma única pessoa no sistema. Se o número já pertence a um usuário de outra empresa, o sistema cria apenas o vínculo com esta empresa, sem revelar ao Dono os dados nem a existência da outra empresa; o nome exibido nesta empresa é o informado pelo Dono. Não é permitido cadastrar o número do próprio produto nem números fora do Brasil (Fase: MVP).
- **R3** E-mail é obrigatório somente quando Acesso ao Painel = Sim, porque é o identificador de login (RF02). Segue as regras de unicidade do RF01. Para o papel Contador, o acesso ao painel é sempre Sim. Para o Lançador, o padrão é Não.
- **R4** Papel: DONO, GERENTE, LANCADOR ou CONTADOR. As permissões de cada papel estão no RF06. O papel CONTADOR está previsto para a Fase 2 e não aparece como opção no MVP.
- **R5** Unidades de Acesso: TODAS (inclui unidades criadas no futuro) ou uma lista de unidades específicas. O colaborador só lança, consulta e recebe relatórios das unidades de acesso. O Dono tem sempre acesso a TODAS.
- **R6** Unidade Padrão é a unidade usada quando o colaborador não diz em qual unidade foi o gasto ou a venda. Deve estar entre as Unidades de Acesso. Com uma única unidade de acesso, é preenchida automaticamente.
- **R7** Permissões Adicionais ajustam o papel para cima, a critério do Dono: VER_FOLHA (ver e lançar folha de pagamento), EXPORTAR_DADOS, RECEBER_RESUMO_SEMANAL e CONSULTAR_RELATORIOS_WHATSAPP. Só se aplicam aos papéis em que fazem sentido (RF06).
- **R8** Situação do Vínculo: CONVIDADO (cadastrado, ainda não enviou a primeira mensagem nem entrou no painel), ATIVO ou DESATIVADO. Desativar impede imediatamente o uso do WhatsApp e do painel naquela empresa; mensagens do número passam a receber a mesma resposta dada a um número desconhecido (RF11). Os lançamentos já feitos pelo colaborador continuam com o nome dele.
- **R9** O consentimento é registrado automaticamente quando o colaborador envia a primeira mensagem ao número do produto (exigência da política do WhatsApp Business). O sistema guarda a mensagem que serviu de prova. O colaborador pode revogar o consentimento enviando "parar" (RF19); nesse caso, deixa de receber mensagens iniciadas pelo produto (resumos e avisos), mas continua podendo lançar.

- **Obs1:** Atores: Dono (cadastra, altera e desativa). Gerente apenas consulta a lista de colaboradores das suas unidades, sem e-mail e sem celular completos.
- **Obs2:** Ao cadastrar, o sistema mostra ao Dono um texto pronto para enviar ao colaborador (e um link wa.me com mensagem pré-preenchida), explicando que ele deve mandar um "Oi" para o número do produto. O produto não inicia a conversa com o colaborador, porque isso exigiria modelo de mensagem aprovado e consentimento prévio. Quando Acesso ao Painel = Sim, o colaborador também recebe um e-mail de convite.
- **Obs3:** Deve existir sempre pelo menos um Dono com vínculo ATIVO na empresa. Transferir a posição de Dono exige que o Dono atual promova outro colaborador a Dono antes de rebaixar a si mesmo.
- **Obs4:** A quantidade máxima de colaboradores depende do plano (RF37).

**Alteração:**

O Dono pode alterar nome, celular, e-mail, papel, unidades, unidade padrão, acesso ao painel e permissões adicionais. Trocar o celular de um colaborador exige confirmação e passa a valer para a próxima mensagem; o número antigo deixa de ser reconhecido naquela empresa. Rebaixar um papel ou retirar unidades vale na próxima requisição e encerra as sessões do colaborador no painel. Vale salientar que em todos os casos deve ser mantido o histórico dos registros, contendo quem realizou a operação, o valor anterior e o novo, com data e hora.

**Exclusão:**

Não será realizada exclusão física do vínculo nem do usuário. O vínculo é desativado (regra 8) e pode ser reativado pelo Dono. Pedidos de eliminação de dados pessoais feitos pelo colaborador (LGPD) são analisados pelo Dono, que é o controlador; os lançamentos são mantidos com o nome substituído por "Colaborador removido" quando a eliminação for aceita.

**Pesquisa:**

O Dono busca colaboradores por nome, final do celular, papel, unidade e situação. O celular aparece mascarado na lista, exceto os 4 últimos dígitos.

**Critérios de aceite:**

- **CA01** – Dado um colaborador cadastrado com o celular (82) 9658-5647, quando envia mensagem do número 5582996585647, então é reconhecido como o mesmo colaborador.
- **CA02** – Dado um número que já pertence a um usuário de outra empresa, quando o Dono o cadastra, então o vínculo é criado nesta empresa e nenhuma informação da outra empresa é exibida.
- **CA03** – Dado um colaborador com Acesso ao Painel = Sim e sem e-mail, quando o Dono tenta salvar, então a gravação é bloqueada com a mensagem de e-mail obrigatório.
- **CA04** – Dada a Unidade Padrão fora das Unidades de Acesso, quando o Dono tenta salvar, então a gravação é bloqueada.
- **CA05** – Dado um colaborador desativado, quando envia uma mensagem, então recebe exatamente a mesma resposta de um número desconhecido e nada é gravado como lançamento.
- **CA06** – Dado o único Dono ativo, quando tenta rebaixar o próprio papel, então a ação é bloqueada com orientação para promover outro Dono antes.
- **CA07** – Dado um colaborador com situação CONVIDADO, quando envia a primeira mensagem, então a situação muda para ATIVO e o consentimento fica registrado com a mensagem de origem.
- **CA08** – Dado um Gerente, quando abre a lista de colaboradores, então vê apenas os das suas unidades, com celular mascarado, e não consegue alterar nenhum.
- **CA09** – Dada a troca de papel de Gerente para Lançador, quando o colaborador faz a próxima requisição no painel, então perde o acesso aos relatórios e a sessão é encerrada.

### RF06 – Papéis, Hierarquia e Permissões

**Prioridade:** Essencial · **Fase:** MVP · **Módulo:** Conta e acesso

Requisito responsável por definir o que cada papel pode fazer no WhatsApp e no painel, incluindo quem pode pedir relatórios pelo WhatsApp. Os papéis são fixos, para manter a operação simples, e o Dono pode conceder permissões adicionais a cada colaborador (RF05, regra 7).

**Papéis:**

**DONO**

Faz tudo em todas as unidades: lança, consulta, edita e exclui qualquer lançamento, inclusive de categorias sensíveis (folha de pagamento); vê todos os relatórios no painel e no WhatsApp; exporta dados; gerencia empresa, unidades, colaboradores, categorias, formas de pagamento, canais e assinatura.

**GERENTE**

Nas suas unidades de acesso: lança; consulta, edita e exclui lançamentos de qualquer colaborador; vê relatórios no painel e no WhatsApp. Não vê nem lança categorias sensíveis, não exporta, não gerencia colaboradores nem a assinatura. Permissões adicionais possíveis: VER_FOLHA, EXPORTAR_DADOS, RECEBER_RESUMO_SEMANAL.

**LANCADOR**

Nas suas unidades de acesso: lança pelo WhatsApp e corrige ou desfaz apenas os próprios lançamentos. Não vê totais, relatórios nem lançamentos de outras pessoas. Pelo WhatsApp pode pedir apenas a lista do que ele mesmo lançou ("o que eu lancei hoje?"). Se o Dono liberar o painel, vê somente os próprios lançamentos. Não lança categorias sensíveis. Permissão adicional possível: CONSULTAR_RELATORIOS_WHATSAPP (passa a receber os relatórios das suas unidades, sem folha).

**CONTADOR (Fase 2)**

Somente leitura no painel, em todas as unidades: consulta lançamentos e relatórios, vê a origem e o histórico, exporta dados e o pacote mensal. Não lança, não edita, não usa o WhatsApp. Vê folha apenas com VER_FOLHA. Pode ter vínculo com várias empresas clientes (RF36).

**Regras:**

- **R1** A matriz completa de ações por papel está na seção 2.3 deste documento e é a referência para testes.
- **R2** Toda checagem de permissão é feita no servidor, a cada ação, inclusive no processamento das mensagens do WhatsApp. A tela apenas esconde o que o usuário não pode fazer.
- **R3** Categoria sensível: lançamentos de categorias marcadas como sensíveis (RF07) só são vistos, criados, editados ou excluídos por quem é Dono ou tem VER_FOLHA. Para os demais, esses lançamentos não aparecem em listas e seus valores não entram nos totais exibidos; os relatórios mostram o aviso "inclui valores restritos" quando o total geral os contém e o usuário não pode vê-los. A restrição vale nas respostas da API, não só na tela.
- **R4** Se um colaborador sem permissão tentar lançar uma categoria sensível pelo WhatsApp (ex.: "paguei o salário do João"), o lançamento não é gravado e ele é orientado a pedir ao Dono.
- **R5** Unidade fora do acesso: pedidos de lançamento ou relatório para uma unidade fora das Unidades de Acesso são recusados com mensagem que não revela dados da unidade.
- **R6** Mudanças de papel e de permissões valem na próxima requisição e ficam registradas na trilha de auditoria (RNF04).

- **Obs1:** Papéis personalizados (criados pelo Dono) não fazem parte do escopo; a combinação de papel fixo e permissões adicionais cobre os casos levantados.

**Alteração:**

As permissões de cada papel são definidas pelo produto. O Dono altera o papel e as permissões adicionais de cada colaborador no RF05.

**Exclusão:**

Não se aplica.

**Pesquisa:**

Não se aplica.

**Critérios de aceite:**

- **CA01** – Dado um Lançador, quando pede pelo WhatsApp "quanto vendemos hoje?", então recebe a recusa padronizada para relatórios e a sugestão "o que eu lancei hoje?".
- **CA02** – Dado um Gerente sem VER_FOLHA, quando consulta a API de lançamentos, então a resposta não contém nenhum lançamento de categoria sensível, mesmo filtrando por ela.
- **CA03** – Dado um Gerente com acesso apenas à unidade Centro, quando pede o resumo da unidade Praia pelo WhatsApp, então a resposta é a recusa padronizada, sem números.
- **CA04** – Dado um Lançador, quando tenta corrigir por resposta a confirmação de um lançamento feito por outra pessoa, então a correção é recusada.
- **CA05** – Dado um Lançador com CONSULTAR_RELATORIOS_WHATSAPP, quando pede o resumo do dia, então recebe o resumo das suas unidades sem valores de folha.
- **CA06** – Para cada papel, dado o conjunto de ações da matriz 2.3, quando cada ação é tentada pela API, então o resultado (permitido ou recusado) corresponde exatamente à matriz.

## 3.2 Cadastros de apoio

### RF07 – Plano de Categorias

**Prioridade:** Essencial · **Fase:** MVP · **Módulo:** Cadastros de apoio

Requisito responsável pela classificação gerencial dos lançamentos, organizada no formato de um DRE (Demonstração do Resultado) simplificado. O produto fornece as categorias padrão, iguais para todos os clientes, e cada empresa pode criar subcategorias próprias sem alterar a estrutura principal, para que os relatórios continuem comparáveis.

**Cadastro da Categoria:**

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| Nome | String | Sim | R1 |
| Categoria Pai | Referência | Não | R2 |
| Tipo | Enum | Sim | R3 |
| Natureza | Enum | Não | R4 |
| Grupo do DRE | Enum | Sim | R5 |
| Sensível | Boolean | Não | R6 |
| Exige Quantidade | Boolean | Não | R7 |
| Palavras de Apoio | Lista de String | Não | R8 |
| Origem | Enum | Não | R9 |
| Status | Enum | Não | R10 |

**Regras e observações do preenchimento dos campos:**

- **R1** Nome tem de 2 a 60 caracteres e é único entre as categorias irmãs (mesma categoria pai), sem diferenciar maiúsculas, minúsculas e acentos.
- **R2** Categoria Pai é obrigatória nas categorias criadas pela empresa: toda categoria própria é subcategoria de uma categoria padrão. São permitidos no máximo dois níveis (categoria e subcategoria).
- **R3** Tipo: RECEITA, DESPESA, INVESTIMENTO ou DEDUCAO. Investimentos (equipamentos, reformas) não entram no resultado do mês e aparecem em quadro próprio. Deduções (taxas de cartão, comissões de aplicativos, impostos sobre faturamento) reduzem a receita bruta. Subcategoria herda o Tipo da categoria pai. **[PROVISÓRIO – P02]** A regra de separação entre investimento e despesa (valor mínimo, vida útil) e quando a IA pergunta ainda será definida pelo Matheus. Proposta adotada: equipamentos e reformas entram como INVESTIMENTO; perguntar só acima de um valor a definir.
- **R4** Natureza: FIXA ou VARIAVEL, só para despesas. Herdada da categoria pai; a subcategoria pode trocá-la.
- **R5** Grupo do DRE: RECEITA_BRUTA, DEDUCOES, CMV, PESSOAL, OCUPACAO, UTILIDADES, OPERACIONAIS, MARKETING, FINANCEIRAS, IMPOSTOS ou INVESTIMENTOS. Herdado da categoria pai e não editável na subcategoria.
- **R6** Sensível marca as categorias de folha de pagamento e afins (salários, pró-labore, encargos, benefícios). As regras de acesso estão no RF06, regra 3. Subcategoria de categoria sensível é sempre sensível.
- **R7** Exige Quantidade indica que lançamentos da categoria precisam de quantidade e unidade de medida (insumos do CMV). Herdado da categoria pai.
- **R8** Palavras de Apoio são termos que ajudam a IA a classificar (ex.: "camarão", "filé", "alcatra" em Carnes), até 30 por categoria, cada um com até 40 caracteres.
- **R9** Origem: SISTEMA (padrão do produto, somente leitura para os clientes) ou EMPRESA (criada pelo Dono).
- **R10** Status: ATIVA ou INATIVA. Categoria inativa não recebe novos lançamentos, deixa de ser sugerida pela IA e continua nos relatórios de períodos passados.

- **Obs1:** Atores: Dono (cria e altera subcategorias). Os demais papéis apenas consultam.
- **Obs2:** A lista de categorias padrão é provisória e será definida pelo sócio contador (pendência P01). A proposta atual é: Receitas (Vendas, Outras receitas); Deduções (Impostos sobre faturamento, Taxas de cartão, Comissões de aplicativos); CMV (Carnes, Hortifrúti, Bebidas, Mercearia, Embalagens e descartáveis); Pessoal (Salários, Encargos, Benefícios, Pró-labore, Extras e freelas: todas sensíveis); Ocupação (Aluguel, Condomínio, IPTU); Utilidades (Energia, Água, Gás, Internet e telefone); Operacionais (Limpeza, Manutenção, Sistemas e assinaturas, Contabilidade); Marketing; Financeiras (Juros, Tarifas bancárias); Investimentos (Equipamentos, Reformas); Outras despesas. **[PROVISÓRIO – P01]** Proposta adotada: a lista acima, até o Matheus validar o plano de categorias definitivo.
- **Obs3:** Mudanças nas categorias padrão depois que houver clientes são feitas pela equipe do produto, por script de migração, sem alterar lançamentos já classificados.
- **Obs4:** Quando a IA não tem segurança para classificar um item, usa "Outras despesas" ou "Outras receitas" e sinaliza o lançamento como "categoria a revisar" no painel, sem perguntar ao colaborador, porque categoria não é informação essencial (RF15).

**Alteração:**

O Dono pode alterar nome, natureza, palavras de apoio e status das subcategorias da empresa. Renomear não altera os lançamentos, que guardam a referência. Mudar a categoria pai de uma subcategoria não é permitido; deve-se criar outra e reclassificar. Em todos os casos deve ser mantido o histórico das alterações.

**Exclusão:**

Não será realizada exclusão física. A categoria é inativada (regra 10). A equipe do produto pode reclassificar em lote, a pedido do Dono, os lançamentos de uma categoria inativada.

**Pesquisa:**

Árvore de categorias com busca por nome e por palavra de apoio, filtro por tipo e por status.

**Critérios de aceite:**

- **CA01** – Dado o Dono, quando tenta alterar ou inativar uma categoria de Origem SISTEMA, então a ação é recusada.
- **CA02** – Dada a criação da subcategoria "Frutos do mar" em Carnes, quando é gravada, então herda Tipo DESPESA, Grupo CMV e Exige Quantidade = Sim.
- **CA03** – Dada uma subcategoria de "Salários", quando é criada, então é sensível, mesmo que o Dono tente desmarcar.
- **CA04** – Dada uma categoria inativada, quando a IA classifica uma nova mensagem, então essa categoria não é usada.
- **CA05** – Dado um lançamento classificado como INVESTIMENTO, quando o resultado do mês é calculado, então o valor não entra nas despesas do resultado e aparece no quadro de investimentos.

### RF08 – Formas de Pagamento e Taxas

**Prioridade:** Essencial · **Fase:** MVP · **Módulo:** Cadastros de apoio

Requisito responsável pelas formas de pagamento usadas nos lançamentos e pelas taxas cobradas sobre as vendas (por exemplo, a taxa da maquininha no crédito). Com as taxas configuradas uma vez, o sistema guarda para cada venda o valor bruto, a taxa e o líquido, mostrando ao dono quanto realmente entrou.

**Cadastro da Forma de Pagamento:**

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| Nome | String | Sim | R1 |
| Tipo | Enum | Sim | R2 |
| Taxa Percentual | Decimal (0,00% a 100,00%) | Não | R3 |
| Taxa Fixa por Transação | Moeda (R$) | Não | R3 |
| Apelidos | Lista de String | Não | R4 |
| Status | Enum | Não | R5 |

**Regras e observações do preenchimento dos campos:**

- **R1** Nome tem de 2 a 40 caracteres e é único na empresa.
- **R2** Tipo: DINHEIRO, PIX, DEBITO, CREDITO, VOUCHER, BOLETO, TRANSFERENCIA ou OUTRO.
- **R3** A taxa percentual é guardada em pontos-base (320 = 3,20%) e a taxa fixa em centavos, nunca em número de ponto flutuante. A taxa só se aplica a lançamentos de RECEITA; despesas pagas com cartão não recebem taxa. O cálculo é: taxa = arredondamento meio-para-cima de (valor bruto × pontos-base ÷ 10.000) + taxa fixa, limitada ao valor bruto; líquido = valor bruto − taxa. A regra de combinação com a comissão de canal de venda está no RF09, regra 3.
- **R4** Apelidos ajudam a IA a reconhecer a forma citada ("cartão", "maquininha", "no crédito", "VR"), até 10 por forma.
- **R5** Status: ATIVA ou INATIVA. Forma inativa deixa de ser usada pela IA e continua nos lançamentos antigos.

- **Obs1:** Atores: Dono (cadastra e altera). Gerente apenas consulta.
- **Obs2:** Ao criar a empresa, o sistema cadastra as formas padrão com taxa zero: Dinheiro, Pix, Débito, Crédito e Voucher. O assistente inicial convida o Dono a informar as taxas da sua maquininha. A lista padrão e as taxas típicas sugeridas são pendência do sócio contador (P07). **[PROVISÓRIO – P07]** Proposta adotada: as formas padrão acima, com taxa zero, até o Matheus definir a lista e as taxas típicas.
- **Obs3:** A tela mostra uma pré-visualização: "Uma venda de R$ 100,00 no crédito rende R$ 96,80 líquidos".
- **Obs4:** Quando o colaborador não diz a forma de pagamento, o lançamento fica com forma "Não informada" e sem taxa; a IA pode sugerir a forma mais usada para aquele tipo de lançamento, exibida na confirmação.

**Alteração:**

O Dono pode alterar todos os campos. A taxa vigente é copiada para cada lançamento no momento da gravação: mudar a taxa vale apenas para lançamentos novos e **não** recalcula os antigos. O Dono pode, explicitamente, aplicar a nova taxa a um período passado; essa ação gera nova versão de cada lançamento afetado (RF25). Em todos os casos deve ser mantido o histórico das alterações.

**Exclusão:**

Não será realizada exclusão física. A forma é inativada (regra 5).

**Pesquisa:**

Lista com filtro por tipo e status.

**Critérios de aceite:**

- **CA01** – Dada a forma Crédito com 3,20% e uma venda de R$ 100,00 no crédito, quando é gravada, então a taxa é R$ 3,20 e o líquido R$ 96,80.
- **CA02** – Dada uma taxa de 3,25% sobre R$ 10,10, quando é calculada, então o resultado é R$ 0,33 (arredondamento meio-para-cima de 32,825 centavos), sem uso de ponto flutuante.
- **CA03** – Dada a alteração da taxa do Crédito de 3,20% para 2,99%, quando a lista de lançamentos antigos é consultada, então os valores antigos continuam com 3,20%.
- **CA04** – Dada uma despesa paga no crédito, quando é gravada, então a taxa é zero e o líquido é igual ao valor.
- **CA05** – Dada uma taxa percentual de 120%, quando o Dono tenta salvar, então o valor é recusado.

### RF09 – Canais de Venda e Comissões

**Prioridade:** Importante · **Fase:** MVP · **Módulo:** Cadastros de apoio

Requisito responsável pelos canais por onde o restaurante vende (salão, delivery próprio, aplicativos de delivery, retirada) e pelas comissões cobradas pelos aplicativos. Permite ao dono ver quanto cada canal vende e quanto a comissão dos aplicativos consome da margem.

**Cadastro do Canal de Venda:**

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| Nome | String | Sim | R1 |
| Tipo | Enum | Sim | R2 |
| Comissão Percentual | Decimal (0,00% a 100,00%) | Não | R3 |
| Apelidos | Lista de String | Não |  |
| Status | Enum | Não |  |

**Regras e observações do preenchimento dos campos:**

- **R1** Nome tem de 2 a 40 caracteres e é único na empresa.
- **R2** Tipo: SALAO, DELIVERY_PROPRIO, APLICATIVO, RETIRADA ou OUTRO.
- **R3** Comissão guardada em pontos-base, como no RF08. Vale apenas para receitas.
- **R4** Regra de combinação (proposta, a validar com o sócio contador, pendência P06): quando a venda é de um canal do tipo APLICATIVO com comissão maior que zero, a taxa do lançamento é a comissão do canal, que já inclui o pagamento online; nos demais casos, vale a taxa da forma de pagamento (RF08). As duas nunca são somadas automaticamente. **[PROVISÓRIO – P06]** Proposta adotada: canal APLICATIVO com comissão substitui a taxa da forma de pagamento; decisão final do Matheus.

- **Obs1:** Atores: Dono. Gerente consulta.
- **Obs2:** Canais padrão criados com a empresa: Salão, Delivery próprio, iFood (APLICATIVO, comissão a configurar) e Retirada. Lista sujeita à pendência P07. **[PROVISÓRIO – P07]** Proposta adotada: os canais padrão acima, até o Matheus definir a lista.
- **Obs3:** Canal de venda é opcional no lançamento. Sem canal informado, a receita fica com canal "Não informado".
- **Obs4:** Hoje as categorias de receita provisórias do código (Salão, Delivery, Balcão) repetem a ideia de canal. A proposta é ter uma única categoria "Vendas" e usar o canal para a separação (pendência P01). **[PROVISÓRIO – P01]** Proposta adotada: uma única categoria "Vendas" e canal de venda para a separação.

**Alteração:**

Mesmas regras do RF08: a comissão é copiada para o lançamento na gravação e não recalcula lançamentos antigos.

**Exclusão:**

Não será realizada exclusão física; o canal é inativado.

**Pesquisa:**

Lista com filtro por tipo e status.

**Critérios de aceite:**

- **CA01** – Dado o canal iFood com 23% e uma venda de R$ 200,00 pelo iFood paga online, quando é gravada, então a taxa é R$ 46,00 e o líquido R$ 154,00.
- **CA02** – Dada uma venda no salão paga no crédito a 3,20%, quando é gravada, então vale a taxa do crédito e não a do canal.
- **CA03** – Dada uma venda sem canal informado, quando é gravada, então o canal fica "Não informado" e o lançamento é aceito.

### RF10 – Fornecedores

**Prioridade:** Importante · **Fase:** MVP · **Módulo:** Cadastros de apoio

Requisito responsável pelo cadastro de fornecedores, criado automaticamente a partir dos lançamentos. Permite comparar preços ao longo do tempo e ver quanto se gasta com cada fornecedor.

**Cadastro do Fornecedor:**

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| Nome | String | Sim | R1 |
| CNPJ ou CPF | String | Não | R2 |
| Apelidos | Lista de String | Não | R3 |
| Categoria Habitual | Referência | Não | R4 |
| Origem | Enum | Não | R5 |
| Status | Enum | Não |  |
| Data do Cadastro | DateTime | Não |  |

**Regras e observações do preenchimento dos campos:**

- **R1** Nome tem de 2 a 120 caracteres. Fornecedores de nota fiscal recebem a razão social ou o nome fantasia do emitente.
- **R2** Documento é opcional, validado pelos dígitos verificadores e único na empresa. CPF de fornecedor pessoa física é dado pessoal: exibido mascarado e incluído nas exportações apenas para quem tem EXPORTAR_DADOS ou é Dono.
- **R3** Apelidos registram as formas como o fornecedor é citado nas mensagens ("Atacadão", "o atacado", "seu Zé da verdura"), até 10 por fornecedor.
- **R4** Categoria Habitual é preenchida pelo sistema a partir do histórico e ajuda a IA a classificar novos lançamentos do mesmo fornecedor.
- **R5** Origem: MENSAGEM (citado em texto ou áudio), NOTA_FISCAL (emitente de cupom ou nota), PAINEL (criado ou ajustado pelo usuário) ou IMPORTACAO.

- **Obs1:** Atores: sistema (criação automática), Dono e Gerente (consulta, edição e mesclagem).
- **Obs2:** Antes de criar um fornecedor novo, o sistema procura um existente pelo documento e, sem documento, por nome e apelidos parecidos. Na dúvida, cria um novo; duplicatas são resolvidas pela mesclagem no painel.
- **Obs3:** Análises de preço por fornecedor (histórico de preço de um insumo, comparação entre fornecedores) são respondidas sob pedido pelas consultas do RF30.

**Alteração:**

Dono e Gerente podem alterar nome, documento e apelidos e **mesclar** dois fornecedores: os lançamentos do fornecedor de origem passam para o de destino (cada um gera nova versão) e os apelidos são somados. Em todos os casos deve ser mantido o histórico das alterações.

**Exclusão:**

Não será realizada exclusão física; o fornecedor pode ser inativado ou mesclado.

**Pesquisa:**

Busca por nome, apelido ou documento; lista com total gasto no período e data da última compra.

**Critérios de aceite:**

- **CA01** – Dadas as mensagens "comprei no Atacadão" e uma NFC-e do mesmo Atacadão com CNPJ, quando são processadas, então ficam no mesmo fornecedor depois que o CNPJ é conhecido.
- **CA02** – Dada a mesclagem de "Atacadao" em "Atacadão", quando é concluída, então todos os lançamentos passam para "Atacadão" e o histórico de cada lançamento registra a mudança.
- **CA03** – Dado um CPF de fornecedor, quando um Gerente sem EXPORTAR_DADOS vê a lista, então o CPF aparece mascarado.

## 3.3 Canal WhatsApp

### RF11 – Identificação do Remetente e Consentimento no WhatsApp

**Prioridade:** Essencial · **Fase:** MVP · **Módulo:** Canal WhatsApp

Requisito responsável por reconhecer quem enviou cada mensagem ao número do produto, em qual empresa e unidade ela deve ser registrada e se a pessoa tem permissão, antes de qualquer uso de inteligência artificial.

**Dados da Mensagem Recebida:**

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| Identificador da Mensagem (WhatsApp) | String | Não | R1 |
| Número do Remetente | String (E.164) | Não | R2 |
| Tipo | Enum | Não | R3 |
| Conteúdo | Texto, Áudio ou Imagem | Não |  |
| Mensagem Citada (resposta) | String | Não | R4 |
| Empresa Identificada | Referência | Não | R5 |
| Usuário Identificado | Referência | Não |  |
| Situação do Processamento | Enum | Não | R6 |
| Recebida em | DateTime | Não |  |

**Regras e observações do preenchimento dos campos:**

- **R1** Cada mensagem é registrada uma única vez, pelo identificador fornecido pelo WhatsApp. Reenvios do mesmo evento pela Meta são ignorados (idempotência), e o conteúdo original é guardado antes de qualquer interpretação, como origem do lançamento.
- **R2** O número é normalizado como no RF01 (com e sem o 9º dígito são o mesmo número).
- **R3** Tipo: TEXTO, AUDIO, IMAGEM ou NAO_SUPORTADO (figurinha, reação, vídeo, localização, contato, documento). Documento em PDF de nota fiscal é tratado na Fase 2 (RF31); até lá recebe a resposta de tipo não suportado.
- **R4** Quando a mensagem é resposta (reply) a uma mensagem do produto, o sistema guarda qual mensagem foi citada, para a correção do RF17.
- **R5** Usuário com vínculo ativo em mais de uma empresa: a mensagem é atribuída à empresa do vínculo mais antigo, salvo se o texto citar outra empresa ou unidade a que ele tenha acesso; a confirmação sempre exibe o nome da unidade (e da empresa, quando houver mais de uma). A pessoa pode mudar a empresa padrão enviando "trocar empresa" (RF19).
- **R6** Situação: RECEBIDA, EM_PROCESSAMENTO, AGUARDANDO_RESPOSTA (há pergunta pendente, RF15), PROCESSADA ou FALHOU (após as tentativas automáticas).

**Regras de roteamento:**

- **R7** A ordem de tratamento é: (a) remetente desconhecido ou desativado; (b) tipo não suportado; (c) comando (RF19); (d) resposta a uma confirmação (RF17); (e) resposta a uma pergunta pendente (RF15); (f) pedido de relatório (RF20); (g) lançamento (RF12 a RF14). Os itens (a) a (e) não usam IA.
- **R8** Número desconhecido, desativado ou de outro país recebe sempre a mesma resposta curta, sem revelar se o número já teve cadastro: "Olá! Este número é do [produto], controle financeiro para restaurantes. Seu número não está cadastrado. Peça ao responsável pelo restaurante para adicionar você, ou fale com o suporte: [contato]." Nada é registrado como lançamento. **[PROVISÓRIO – P08]** O texto final desta resposta, e o contato de suporte, serão revisados pelo Matheus.
- **R9** O consentimento (opt-in) é registrado na primeira mensagem de um número cadastrado (RF05, regra 9).
- **R10** Toda resposta do produto é enviada para o número com o 9º dígito e dentro da janela de 24 horas aberta pela mensagem do usuário. Mensagens iniciadas pelo produto fora dessa janela (resumos, avisos) usam modelos aprovados pela Meta (RF34).

- **Obs1:** Atores: Colaborador (qualquer papel com uso de WhatsApp). Sistema externo: WhatsApp Business Cloud API (Meta).
- **Obs2:** O recebimento responde ao WhatsApp em menos de 1 segundo, apenas validando a assinatura, gravando e enfileirando; o processamento é assíncrono (RNF05).
- **Obs3:** Enquanto processa, o sistema marca a mensagem como lida e mostra o indicador de digitação (Fase: MVP, quando suportado pela API).

**Alteração:**

Mensagens recebidas não são alteradas: são a prova de origem. A transcrição de áudio pode ser corrigida apenas por meio da correção dos lançamentos.

**Exclusão:**

Não será realizada exclusão física das mensagens durante a vigência da conta. Áudios são eliminados após 90 dias, mantida a transcrição (RNF03).

**Pesquisa:**

Não há tela de mensagens para o cliente; cada lançamento mostra a sua origem (RF25). A equipe interna vê apenas metadados (horário, situação, erro), sem o conteúdo (RF38).

**Critérios de aceite:**

- **CA01** – Dado o mesmo evento de mensagem entregue duas vezes pela Meta, quando ambos são recebidos, então existe um único registro e um único processamento.
- **CA02** – Dado um número desconhecido que escreve "paguei 50 de gás", quando a mensagem é processada, então recebe a resposta padronizada, nenhum lançamento é criado e nenhuma chamada de IA é feita.
- **CA03** – Dado um número desativado, quando envia mensagem, então a resposta é idêntica, caractere a caractere, à de um número desconhecido.
- **CA04** – Dada uma figurinha enviada por um colaborador ativo, quando é processada, então ele recebe a resposta de tipo não suportado com o que o produto aceita.
- **CA05** – Dado um usuário com vínculo em duas empresas, quando lança sem citar empresa, então o lançamento vai para a empresa do vínculo mais antigo e a confirmação mostra o nome da empresa e da unidade.
- **CA06** – Dada uma requisição ao recebimento com assinatura inválida, quando chega, então é recusada sem gravar nada.

### RF12 – Lançamento por Mensagem de Texto

**Prioridade:** Essencial · **Fase:** MVP · **Módulo:** Canal WhatsApp

Requisito responsável por transformar uma mensagem de texto livre, escrita do jeito que o colaborador falaria ("camarão 5kg 450 no pix"), em um ou mais lançamentos de despesa ou receita, gravados direto e confirmados em seguida. É o núcleo do produto. Este requisito também define os campos do lançamento, usados por todos os canais de entrada.

**Cadastro do Lançamento:**

**Dados do Lançamento**

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| Tipo | Enum | Sim | R1 |
| Data de Competência | Date (dd/mm/aaaa) | Sim | R2 |
| Descrição | String | Sim | R3 |
| Quantidade | Decimal (até 3 casas) | Não | R4 |
| Unidade de Medida | Enum | Não | R4 |
| Valor Bruto | Moeda (R$) | Sim | R5 |

**Classificação**

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| Categoria | Referência | Sim | R6 |
| Fornecedor | Referência | Não | R7 |
| Forma de Pagamento | Referência | Não | R8 |
| Canal de Venda | Referência | Não | R9 |
| Unidade (restaurante) | Referência | Sim | R10 |

**Valores Calculados pelo Sistema**

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| Taxa Percentual Aplicada | Inteiro (pontos-base) | Não | R11 |
| Taxa Fixa Aplicada | Moeda | Não | R11 |
| Valor da Taxa | Moeda | Não | R11 |
| Valor Líquido | Moeda | Não | R11 |

**Origem e Controle**

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| Canal de Origem | Enum | Não | R12 |
| Mensagem de Origem | Referência | Não | R12 |
| Posição na Mensagem | Inteiro | Não | R12 |
| Mensagem de Confirmação | Referência | Não | R12 |
| Sinais de Revisão | Lista de Enum | Não | R13 |
| Versão | Inteiro | Não | R14 |
| Lançado por | Referência | Não |  |
| Criado em | DateTime (dd/mm/aaaa hh:mm) | Não |  |
| Atualizado em | DateTime | Não |  |
| Status | Enum | Não | R15 |

**Regras e observações do preenchimento dos campos:**

- **R1** Tipo: DESPESA ou RECEITA. Investimentos e deduções são despesas classificadas em categorias de Tipo INVESTIMENTO ou DEDUCAO (RF07). A IA infere o tipo pelo verbo e pelo contexto ("paguei", "comprei" = despesa; "vendi", "entrou", "faturamos" = receita).
- **R2** Data de Competência é a data em que o gasto ou a venda aconteceu, sem hora. Se não for dita, é "hoje" no fuso da unidade. Expressões relativas ("ontem", "sexta") são resolvidas a partir de hoje no fuso da unidade. Pelo WhatsApp não são aceitas datas futuras: se a mensagem indicar data futura, o sistema pergunta (RF15). Datas com mais de 60 dias no passado são aceitas e destacadas na confirmação.
- **R3** Descrição tem de 1 a 200 caracteres e resume o item como o colaborador disse ("Camarão", "Conta de luz", "Vendas do dia"). Nunca contém CPF, número de cartão ou de conta: se a mensagem trouxer esses dados, eles são omitidos da descrição.
- **R4** Quantidade e Unidade de Medida são obrigatórias quando a categoria Exige Quantidade (insumos, RF07). Quantidade maior que zero. Unidade de Medida: KG, G, L, ML, UN, DZ, CX, PCT, FD (fardo), SC (saco) ou OUTRA. Faltando a quantidade de um insumo, o sistema pergunta antes de gravar (RF15).
- **R5** Valor Bruto é obrigatório, maior que zero e guardado em centavos inteiros, nunca em ponto flutuante. Aceita as formas "450", "450,00", "R$ 450", "1.230", "1,2 mil", "mil e duzentos". Se a mensagem trouxer quantidade, preço unitário e total, a IA apenas extrai os três e o sistema confere: diferença maior que R$ 0,01 gera pergunta (RF15). Se trouxer quantidade e preço unitário sem total, o sistema calcula o total. **A IA nunca faz contas**: quando a mensagem traz um total e partes ("vendemos 3.450, 1.200 no cartão e o resto no pix"), a IA informa o total e as partes conhecidas e o sistema calcula o restante.
- **R6** A categoria é sugerida pela IA a partir da descrição, do fornecedor, das palavras de apoio e do histórico da empresa. Sem segurança suficiente, usa "Outras despesas" ou "Outras receitas" com o sinal CATEGORIA_A_REVISAR, sem perguntar.
- **R7** Fornecedor é opcional; quando citado, é associado ou criado conforme o RF10.
- **R8** Forma de Pagamento é opcional ("Não informada" quando ausente). "Cartão" sem especificar usa a forma de cartão padrão da empresa (configurável no RF08; padrão Crédito) e aparece na confirmação para fácil correção.
- **R9** Canal de Venda só se aplica a receitas e é opcional ("Não informado" quando ausente).
- **R10** Unidade é a citada na mensagem (pelo nome ou apelido, RF04) ou, se nenhuma for citada, a Unidade Padrão do colaborador. Se a unidade citada não estiver entre as Unidades de Acesso, o lançamento é recusado (RF06, regra 5).
- **R11** Taxas e líquido são calculados pelo sistema na gravação, conforme RF08 e RF09, e copiados para o lançamento. Para despesas, taxa zero e líquido igual ao bruto. O banco garante que líquido = bruto − taxa.
- **R12** Canal de Origem: WHATSAPP, PAINEL, IMPORTACAO, EMAIL ou SISTEMA (recorrentes). Lançamentos do WhatsApp guardam a mensagem de origem (texto, transcrição ou imagem), a posição do lançamento dentro dela (uma mensagem pode gerar vários) e a mensagem de confirmação enviada (usada na correção por resposta). Reprocessar a mesma mensagem nunca duplica lançamentos: a combinação mensagem de origem + posição é única.
- **R13** Sinais de Revisão: CATEGORIA_A_REVISAR, POSSIVEL_DUPLICIDADE (mesmo valor, mesmo fornecedor ou descrição e mesma data de outro lançamento feito nas últimas 24 horas, vindo de outra mensagem) e DATA_ANTIGA. Os sinais não impedem a gravação; aparecem na confirmação e no painel como filtro "a revisar".
- **R14** Versão começa em 1 e aumenta a cada alteração (RF23 e RF25).
- **R15** Status: ATIVO ou NA_LIXEIRA (RF24). Não existe exclusão física.

**Regras de interpretação:**

- **R16** Uma mensagem pode conter vários lançamentos, inclusive de tipos e categorias diferentes ("comprei 2 caixas de óleo 180, 10 kg de arroz 62 e um freezer de 3.200"). Todos são gravados juntos, em uma única transação, e confirmados em uma única mensagem.
- **R17** Informações essenciais, cuja falta gera pergunta antes de gravar (RF15): valor; quantidade de insumo; tipo, quando não puder ser inferido; e a unidade, quando o colaborador citar uma unidade que não existe ou que seja ambígua. As demais informações são presumidas e mostradas na confirmação. A lista final de essenciais é pendência do sócio contador (P04). **[PROVISÓRIO – P04]** Proposta adotada: essenciais = valor; quantidade de insumo; tipo não inferível; unidade inexistente ou ambígua. Decisão final do Matheus.
- **R18** A interpretação usa um modelo de linguagem com saída estruturada validada por esquema. O sistema valida cada campo antes de gravar; saída inválida é tentada mais uma vez e, se persistir, o sistema pergunta ao colaborador em vez de gravar algo errado. A IA recebe apenas o contexto da empresa (categorias, unidades, formas de pagamento, fornecedores frequentes) e nunca dados de outra empresa.
- **R19** Mensagens que não são lançamento, comando nem pedido de relatório recebem a resposta de fora do escopo (RF19). Conversa livre não é atendida, por regra da política do WhatsApp para provedores de IA.
- **R20** Cada chamada de IA registra o consumo (tokens, modelo, custo estimado) por empresa (RNF08).

- **Obs1:** Atores: Dono, Gerente e Lançador. Sistemas externos: WhatsApp Business Cloud API e provedor do modelo de linguagem.
- **Obs2:** O lançamento é salvo direto, sem pedir confirmação prévia, e a correção posterior é fácil (RF16 a RF18).

**Alteração:**

Pelo WhatsApp, conforme RF17 (correção por resposta). No painel, conforme RF23. Toda alteração gera versão, com quem, quando, canal e valores anterior e novo.

**Exclusão:**

Não será realizada exclusão física. "Desfazer" (RF18) e a exclusão no painel (RF24) levam o lançamento para a lixeira.

**Pesquisa:**

No painel, conforme RF22. Pelo WhatsApp, o colaborador pode pedir "o que eu lancei hoje?" (RF20).

**Critérios de aceite:**

- **CA01** – Dada a mensagem "camarão 5kg 450 no pix", quando é processada, então é gravada uma despesa de R$ 450,00, quantidade 5 KG, categoria de carnes ou frutos do mar, forma Pix, data de hoje, unidade padrão, e a confirmação é enviada.
- **CA02** – Dada a mensagem "vendas de hoje 3.450, 1.200 no cartão, resto pix", quando é processada, então são gravadas duas receitas, R$ 1.200,00 no cartão padrão e R$ 2.250,00 no Pix, e o valor de R$ 2.250,00 é calculado pelo sistema.
- **CA03** – Dada a mensagem "comprei 2 caixas de óleo 180, 10 kg de arroz 62 e detergente 25", quando é processada, então são gravados três lançamentos na mesma transação e confirmados em uma única mensagem.
- **CA04** – Dada a mensagem "camarão 450", quando é processada, então nada é gravado ainda e o colaborador recebe a pergunta da quantidade.
- **CA05** – Dada a mensagem "3 kg de alcatra a 45 o quilo, total 140", quando é processada, então o sistema pergunta qual valor está certo, porque 3 × 45 = 135.
- **CA06** – Dada uma falha de gravação no meio de uma mensagem com três lançamentos, quando o processamento é retomado, então existem exatamente três lançamentos, sem duplicidade e sem lançamento pela metade.
- **CA07** – Dada a mensagem "paguei 80 de gás amanhã", quando é processada, então o sistema pergunta a data, porque datas futuras não são aceitas pelo WhatsApp.
- **CA08** – Dados dois lançamentos "gás 80" enviados em mensagens diferentes com 5 minutos de intervalo, quando o segundo é gravado, então recebe o sinal POSSIVEL_DUPLICIDADE e a confirmação avisa "parece repetido; responda 'desfazer' se for o caso".
- **CA09** – Dada uma resposta do modelo de linguagem que não passa no esquema duas vezes seguidas, quando o processamento termina, então nada é gravado e o colaborador recebe uma pergunta pedindo para reformular.
- **CA10** – Dada qualquer mensagem processada, quando o consumo é consultado, então existe registro de uso de IA ligado à empresa e à mensagem.

### RF13 – Lançamento por Áudio

**Prioridade:** Essencial · **Fase:** MVP · **Módulo:** Canal WhatsApp

Requisito responsável por aceitar mensagens de voz do WhatsApp, inclusive gravadas em ambiente barulhento como a cozinha, transcrevê-las e tratá-las como uma mensagem de texto (RF12).

**Dados do Áudio:**

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| Arquivo de Áudio | Mídia (OGG/Opus) | Não | R1 |
| Duração | Inteiro (segundos) | Não | R2 |
| Transcrição | String | Não | R3 |
| Prazo de Retenção do Áudio | Date | Não | R4 |

**Regras e observações do preenchimento dos campos:**

- **R1** O áudio é baixado da Meta, guardado em armazenamento privado com chave por empresa e nunca exposto por endereço público.
- **R2** Áudios de até 180 segundos são aceitos. Acima disso, o áudio não é transcrito e o colaborador recebe: "Seu áudio tem mais de 3 minutos. Pode mandar em partes menores?". O limite evita custo excessivo (RF21).
- **R3** A transcrição é feita por serviço especializado de voz para texto, em português do Brasil, guardada junto à mensagem e usada como texto de entrada do RF12. Todas as regras do RF12 valem, inclusive vários lançamentos por áudio.
- **R4** O arquivo de áudio é eliminado 90 dias após o recebimento; a transcrição permanece como origem do lançamento (RNF03).

- **Obs1:** Se a transcrição vier vazia ou ininteligível (ruído, áudio mudo), nada é gravado e o colaborador recebe: "Não consegui entender o áudio. Pode repetir ou mandar por texto?".
- **Obs2:** A confirmação de lançamentos feitos por áudio inclui um trecho curto do que foi entendido ("Entendi: 'duas caixas de óleo cento e oitenta'"), para o colaborador perceber erros de transcrição.
- **Obs3:** O consumo de transcrição (segundos) é registrado por empresa (RNF08).

**Alteração:**

Como no RF12.

**Exclusão:**

Como no RF12. O arquivo de áudio segue a retenção da regra 4.

**Pesquisa:**

No painel, "ver origem" mostra o player do áudio, enquanto existir, e a transcrição (RF25).

**Critérios de aceite:**

- **CA01** – Dado um áudio de 20 segundos dizendo "comprei dez quilos de arroz sessenta e dois reais", quando é processado, então é gravada uma despesa de R$ 62,00 com 10 KG e a confirmação traz o trecho entendido.
- **CA02** – Dado um áudio de 200 segundos, quando é recebido, então não é transcrito, nenhuma IA é chamada e o colaborador recebe o pedido para dividir.
- **CA03** – Dado um áudio só com ruído, quando é processado, então nada é gravado e o colaborador recebe o pedido para repetir.
- **CA04** – Dado um áudio recebido há mais de 90 dias, quando a origem é aberta no painel, então o player não aparece e a transcrição continua disponível.
- **CA05** – Dado o conjunto de áudios reais de cozinha usado nos testes de qualidade, quando é processado, então a taxa de lançamentos corretos atende ao RNF07.

### RF14 – Lançamento por Foto de Cupom ou Nota

**Prioridade:** Essencial · **Fase:** MVP · **Módulo:** Canal WhatsApp

Requisito responsável por aceitar fotos de cupons fiscais (NFC-e), notas, recibos e comprovantes. Quando a foto tem QR Code de NFC-e, os dados oficiais são lidos na SEFAZ, com precisão total; sem QR Code, a imagem é lida por inteligência artificial.

**Dados do Documento Fiscal:**

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| Imagem | Mídia (JPEG/PNG) | Não | R1 |
| Chave de Acesso | String (44 dígitos) | Não | R2 |
| Emitente (CNPJ e Nome) | String | Não | R3 |
| Data de Emissão | Date | Não |  |
| Itens | Lista (descrição, quantidade, unidade, valor) | Não | R4 |
| Valor Total | Moeda | Não |  |
| Forma de Pagamento | String | Não |  |
| Método de Leitura | Enum | Não | R5 |
| Legenda da Foto | String | Não | R6 |

**Regras e observações do preenchimento dos campos:**

- **R1** Imagens até 5 MB. A imagem fica guardada como comprovante enquanto a conta existir, em armazenamento privado.
- **R2** A chave de acesso identifica a nota de forma única. Uma mesma nota (mesma chave) nunca gera lançamentos duas vezes na mesma empresa, venha por foto, por e-mail (RF31) ou por importação; na segunda tentativa, o colaborador recebe "Essa nota já foi registrada em dd/mm por [nome]".
- **R3** O emitente vira o fornecedor do lançamento (RF10), associado pelo CNPJ.
- **R4** Os itens da nota são agrupados por categoria: cada categoria gera um lançamento cuja descrição resume a nota ("Atacadão – 8 itens"), e os itens detalhados ficam guardados no documento, visíveis em "ver origem". Assim, um cupom de supermercado com 30 itens não gera 30 lançamentos. Itens de categoria INVESTIMENTO sempre geram lançamento próprio.
- **R5** Método de Leitura: QRCODE_SEFAZ (consulta à página pública da NFC-e na SEFAZ do estado) ou LEITURA_IA (modelo de linguagem com visão). A consulta à SEFAZ é implantada primeiro para os estados dos restaurantes piloto; nos demais, usa-se LEITURA_IA. Se a SEFAZ estiver fora do ar, o sistema usa LEITURA_IA e marca o lançamento para nova conferência automática quando a SEFAZ voltar.
- **R6** A legenda enviada junto com a foto complementa a leitura ("foi no pix", "loja 2").

- **Obs1:** Foto de nota com valores ilegíveis gera pergunta (RF15), nunca valor inventado.
- **Obs2:** Recibos manuscritos e comprovantes de Pix ou transferência são lidos por LEITURA_IA e seguem as regras do RF12.
- **Obs3:** Fotos que não são documentos financeiros recebem a resposta de fora do escopo (RF19).
- **Obs4:** A Data de Competência do lançamento é a data de emissão da nota.

**Alteração:**

Como no RF12. A correção de um lançamento vindo de nota não altera o documento lido.

**Exclusão:**

Como no RF12. Ao mandar para a lixeira todos os lançamentos de uma nota, a chave de acesso é liberada para novo registro.

**Pesquisa:**

No painel, pela chave de acesso, pelo emitente ou pela data de emissão (RF22).

**Critérios de aceite:**

- **CA01** – Dada a foto de uma NFC-e com QR Code legível de um estado habilitado, quando é processada, então os valores gravados são idênticos aos da SEFAZ, sem chamada de IA para os valores.
- **CA02** – Dada a mesma NFC-e enviada duas vezes, quando a segunda é processada, então nenhum lançamento novo é criado e o colaborador recebe a mensagem de nota já registrada.
- **CA03** – Dado um cupom com 30 itens de 3 categorias, quando é processado, então são gravados 3 lançamentos e os 30 itens aparecem em "ver origem".
- **CA04** – Dada a foto de um recibo manuscrito "Frete R$ 120,00", quando é processada, então é gravada uma despesa de R$ 120,00 com Método LEITURA_IA.
- **CA05** – Dada uma foto borrada em que o total não é legível, quando é processada, então nada é gravado e o colaborador recebe a pergunta do valor.
- **CA06** – Dada a foto de uma paisagem, quando é processada, então recebe a resposta de fora do escopo e nada é gravado.

### RF15 – Pergunta de Volta (informação essencial faltante)

**Prioridade:** Essencial · **Fase:** MVP · **Módulo:** Canal WhatsApp

Requisito responsável por perguntar ao colaborador quando falta uma informação essencial ou há contradição na mensagem, em vez de gravar algo possivelmente errado. A regra geral do produto é gravar direto; a pergunta é a exceção.

**Pergunta Pendente:**

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| Rascunho dos Lançamentos | Estrutura | Não | R1 |
| Pergunta | String | Não | R2 |
| Campos Faltantes | Lista de Enum | Não |  |
| Expira em | DateTime | Não | R3 |
| Situação | Enum | Não | R4 |

**Regras e observações do preenchimento dos campos:**

- **R1** Os lançamentos já entendidos ficam guardados como rascunho, sem aparecer no painel nem nos relatórios, até a resposta.
- **R2** A pergunta é única e objetiva, citando o item ("Quantos kg de camarão foram?"; "O valor do arroz foi 135 ou 140?"). Quando faltar mais de uma informação, o sistema pergunta tudo em uma só mensagem, numerada.
- **R3** A pergunta vale por 24 horas. Ao expirar, o rascunho é descartado e nada é gravado; o colaborador não é avisado fora da janela de conversa.
- **R4** Situação: ABERTA, RESPONDIDA, CANCELADA ou EXPIRADA.

**Regras de resposta:**

- **R5** A próxima mensagem do colaborador é interpretada primeiro como resposta à pergunta aberta. Se completar o que faltava, os lançamentos são gravados e confirmados (RF16), inclusive os que não dependiam da resposta.
- **R6** Se a próxima mensagem for claramente um novo lançamento, a pergunta é cancelada, o colaborador é avisado em uma linha ("Deixei de lado o lançamento do camarão.") e a nova mensagem é processada normalmente.
- **R7** "cancelar" descarta o rascunho (RF19).
- **R8** Cada colaborador tem no máximo uma pergunta aberta por vez.

- **Obs1:** Quando a mensagem tem vários lançamentos e só um está incompleto, o sistema grava os completos imediatamente e pergunta apenas sobre o incompleto, informando isso na confirmação.

**Alteração:**

Não se aplica.

**Exclusão:**

Rascunhos expirados ou cancelados não aparecem em nenhum relatório.

**Pesquisa:**

Não se aplica.

**Critérios de aceite:**

- **CA01** – Dada a pergunta "Quantos kg de camarão?" e a resposta "5", quando é processada, então o lançamento é gravado com 5 KG e confirmado.
- **CA02** – Dada uma pergunta aberta e a mensagem seguinte "paguei 50 de gás", quando é processada, então a pergunta é cancelada com aviso e o gás é lançado.
- **CA03** – Dada uma pergunta sem resposta por 24 horas, quando expira, então nada é gravado.
- **CA04** – Dada a mensagem "óleo 180, camarão 450" (camarão sem quantidade), quando é processada, então o óleo é gravado e confirmado e só o camarão fica pendente.

### RF16 – Confirmação do Lançamento

**Prioridade:** Essencial · **Fase:** MVP · **Módulo:** Canal WhatsApp

Requisito responsável pelo retorno claro, enviado logo após cada gravação, com tudo o que foi registrado e como corrigir. É o que torna seguro gravar direto sem confirmação prévia.

**Conteúdo da Confirmação:**

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| Cabeçalho | String | Não | R1 |
| Itens Registrados | Lista | Não | R2 |
| Avisos | Lista | Não | R3 |
| Instruções de Correção | String | Não | R4 |

**Regras e observações do preenchimento dos campos:**

- **R1** "✅ Registrado (Restaurante Centro):". Inclui o nome da empresa quando o colaborador tem mais de uma.
- **R2** Uma linha por lançamento, numerada: descrição, quantidade (se houver), valor em reais, categoria, data ("hoje", "ontem" ou dd/mm), forma de pagamento e, nas receitas com taxa, o líquido. Exemplo: "1. Camarão 5 kg — R$ 450,00 — Carnes — hoje — Pix".
- **R3** Avisos aparecem quando houver: categoria a revisar, possível duplicidade, data antiga, item ainda pendente de pergunta, trecho entendido do áudio.
- **R4** Última linha: "Para ajustar, responda esta mensagem dizendo o que mudar. 'desfazer' apaga este registro." Os textos finais são revisados pelo sócio contador (P08). **[PROVISÓRIO – P08]** Textos finais a revisar pelo Matheus.

- **Obs1:** A confirmação é enviada uma única vez por mensagem de origem, mesmo que o processamento seja repetido por falha (envio idempotente).
- **Obs2:** O identificador da confirmação enviada é guardado em cada lançamento, para a correção por resposta (RF17).
- **Obs3:** Valores em formato brasileiro (R$ 1.234,56), sempre calculados pelo sistema, nunca escritos pela IA.
- **Obs4:** Mensagens longas (mais de 10 itens) mostram os 10 primeiros e o total de itens, com indicação de que o restante está no painel.

**Alteração:**

Não se aplica: mensagens enviadas não são alteradas.

**Exclusão:**

Não se aplica.

**Pesquisa:**

Não se aplica.

**Critérios de aceite:**

- **CA01** – Dado um lançamento gravado, quando a confirmação é enviada, então contém valor, categoria, data, forma de pagamento e as instruções de correção.
- **CA02** – Dada uma falha após o envio da confirmação e antes do fim do processamento, quando o processamento é repetido, então o colaborador não recebe a confirmação duas vezes.
- **CA03** – Dada uma receita de R$ 100,00 no crédito a 3,20%, quando é confirmada, então a linha mostra "líquido R$ 96,80".
- **CA04** – Dado um texto de confirmação, quando é comparado aos lançamentos gravados, então todos os valores exibidos são idênticos aos do banco.

### RF17 – Correção por Resposta (reply)

**Prioridade:** Essencial · **Fase:** MVP · **Módulo:** Canal WhatsApp

Requisito responsável por permitir corrigir um lançamento respondendo (reply) à sua mensagem de confirmação, em linguagem natural: "o camarão foi 400", "era débito", "foi ontem", "é da loja 2".

**Correção:**

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| Confirmação Citada | Referência | Sim | R1 |
| Texto ou Áudio da Correção | String ou Mídia | Sim |  |
| Lançamentos Afetados | Lista de Referência | Não | R2 |
| Campos Alterados | Lista (campo, valor anterior, valor novo) | Não | R3 |

**Regras e observações do preenchimento dos campos:**

- **R1** A correção vale para os lançamentos da confirmação citada, mesmo que seja antiga, e não necessariamente para o último lançamento. Resposta a uma mensagem do produto que não é confirmação (ajuda, aviso) é tratada como mensagem nova.
- **R2** Quando a confirmação tem vários itens e a correção não deixa claro qual ("foi 400"), o sistema pergunta qual item (RF15). O colaborador pode citar o número da linha ("o 2 foi 400").
- **R3** Podem ser corrigidos: valor, quantidade, unidade de medida, descrição, data, categoria, fornecedor, forma de pagamento, canal de venda e unidade (restaurante). Taxa e líquido são recalculados pelo sistema com as taxas vigentes na gravação original, salvo mudança da forma de pagamento ou do canal, quando valem as taxas atuais da nova forma.

- **Obs1:** Permissão: Lançador corrige apenas os próprios lançamentos; Gerente e Dono corrigem os de qualquer pessoa das suas unidades (RF06). Lançamento de categoria sensível só por quem pode vê-lo.
- **Obs2:** Cada correção gera uma nova versão do lançamento (canal WHATSAPP) e uma nova confirmação curta: "✏️ Corrigido: Camarão 5 kg — R$ 400,00 (antes R$ 450,00)".
- **Obs3:** Lançamento que já está na lixeira não é corrigido; o colaborador é orientado a restaurá-lo no painel.
- **Obs4:** Se o lançamento foi alterado no painel depois da confirmação citada, a correção é aplicada sobre a versão atual, e a resposta mostra o valor atual como "antes".

**Alteração:**

É o próprio requisito.

**Exclusão:**

Não se aplica.

**Pesquisa:**

O histórico de versões fica visível no painel (RF25).

**Critérios de aceite:**

- **CA01** – Dada a resposta "foi 400" a uma confirmação com um único item de R$ 450,00, quando é processada, então o valor passa a R$ 400,00, a versão aumenta e a confirmação de correção é enviada.
- **CA02** – Dada uma resposta a uma confirmação de três dias atrás, quando é processada, então corrige os lançamentos daquela confirmação e não o último lançamento.
- **CA03** – Dada a resposta "foi 400" a uma confirmação com três itens, quando é processada, então o sistema pergunta qual item.
- **CA04** – Dado um Lançador que responde à confirmação de outra pessoa, quando a correção é processada, então é recusada sem alterar nada.
- **CA05** – Dada a correção da forma de pagamento de Pix para Crédito em uma receita, quando é gravada, então a taxa e o líquido são recalculados com a taxa atual do Crédito.

### RF18 – Desfazer Lançamento

**Prioridade:** Essencial · **Fase:** MVP · **Módulo:** Canal WhatsApp

Requisito responsável pelo comando "desfazer", que manda para a lixeira o último registro feito pelo colaborador. Resolve rapidamente a maioria dos erros sem precisar do painel.

**Regras:**

- **R1** "desfazer" enviado sozinho manda para a lixeira todos os lançamentos da última mensagem registrada pelo próprio colaborador, nas últimas 24 horas, que ainda estejam ativos.
- **R2** "desfazer" enviado como resposta a uma confirmação desfaz os lançamentos daquela confirmação, respeitando as permissões do RF06 e sem limite de 24 horas.
- **R3** Enviar "desfazer" de novo desfaz o registro anterior ao já desfeito, seguindo a mesma regra, até o limite de 24 horas.
- **R4** Sem nada a desfazer, a resposta é: "Não encontrei lançamento seu nas últimas 24 horas para desfazer. Pelo painel você pode ver e apagar lançamentos mais antigos."
- **R5** O comando é reconhecido com tolerância a maiúsculas, acentos e espaços ("Desfazer", "desfaz", "DESFAZER ") e não usa IA.
- **R6** A resposta lista o que foi desfeito: "↩️ Desfeito: Camarão 5 kg — R$ 450,00. Se foi engano, dá para recuperar pela lixeira do painel."

- **Obs1:** Desfazer gera versão com ação EXCLUSAO e canal WHATSAPP. O lançamento vai para a lixeira e pode ser restaurado por 30 dias (RF24).

**Alteração:**

Não se aplica.

**Exclusão:**

É o próprio requisito (exclusão lógica).

**Pesquisa:**

Não se aplica.

**Critérios de aceite:**

- **CA01** – Dada uma mensagem que gerou três lançamentos, quando o colaborador envia "desfazer", então os três vão para a lixeira e a resposta lista os três.
- **CA02** – Dados dois registros seguidos, quando o colaborador envia "desfazer" duas vezes, então os dois são desfeitos, do mais recente para o mais antigo.
- **CA03** – Dado um último registro feito há 30 horas, quando o colaborador envia "desfazer", então nada é desfeito e ele recebe a orientação de usar o painel.
- **CA04** – Dado um Gerente que responde "desfazer" à confirmação de um Lançador da sua unidade, quando é processado, então os lançamentos daquela confirmação vão para a lixeira.
- **CA05** – Dado "DESFAZER " com espaço, quando é recebido, então é reconhecido como comando sem chamada de IA.

### RF19 – Comandos, Ajuda, Suporte e Fora do Escopo

**Prioridade:** Essencial · **Fase:** MVP · **Módulo:** Canal WhatsApp

Requisito responsável pelos comandos fixos do WhatsApp, pela mensagem de ajuda com saída para atendimento humano (exigência da política do WhatsApp) e pela recusa de assuntos fora do controle financeiro.

**Comandos:**

**ajuda**

Explica em até 8 linhas o que dá para mandar (texto, áudio, foto), dá 3 exemplos, lista os comandos e informa o contato de suporte humano.

**desfazer**

RF18.

**cancelar**

Descarta a pergunta pendente (RF15).

**trocar unidade / trocar empresa**

Lista as unidades ou empresas de acesso, numeradas, e o colaborador escolhe a nova padrão respondendo com o número. Vale para os próximos lançamentos até nova troca.

**parar / voltar**

Revoga e restaura o consentimento para mensagens iniciadas pelo produto (resumos, alertas). Lançar continua possível.

**suporte**

Informa o canal de atendimento humano (WhatsApp de suporte separado do número do produto, e-mail e horário).

**Regras:**

- **R1** Comandos são reconhecidos sem IA, com tolerância a maiúsculas, acentos e espaços. Um comando enviado como resposta a uma confirmação continua sendo comando.
- **R2** Mensagens fora do escopo (conversa livre, perguntas gerais, pedidos que não são lançamento nem relatório) recebem resposta curta e padronizada: "Eu cuido só do controle financeiro do restaurante: lançar gastos e vendas e mostrar resumos. Mande 'ajuda' para ver exemplos." Nenhum conteúdo fora do escopo é gerado.
- **R3** Tipos não suportados (RF11) recebem: "Por aqui eu entendo texto, áudio e foto de nota. Mande 'ajuda' para ver exemplos."
- **R4** Mensagens de erro do sistema (falha após todas as tentativas) informam que a mensagem não pôde ser registrada, pedem para tentar de novo e trazem o contato do suporte. A falha nunca é silenciosa.
- **R5** Todos os textos são em português do Brasil, em tom simples, revisados pelo sócio contador (P08). **[PROVISÓRIO – P08]** Textos finais a revisar pelo Matheus.

- **Obs1:** Atores: todos os colaboradores com uso de WhatsApp.

**Alteração:**

Os textos são configurados pela equipe do produto.

**Exclusão:**

Não se aplica.

**Pesquisa:**

Não se aplica.

**Critérios de aceite:**

- **CA01** – Dado "Ajuda", quando é recebido, então a resposta contém exemplos, comandos e o contato do suporte, sem chamada de IA.
- **CA02** – Dada a pergunta "qual a capital da França?", quando é processada, então a resposta é a recusa padronizada e nada é gravado.
- **CA03** – Dado "trocar unidade" e a resposta "2", quando o colaborador lança em seguida sem citar unidade, então o lançamento vai para a unidade 2.
- **CA04** – Dado "parar", quando o resumo semanal é enviado, então esse colaborador não o recebe e continua podendo lançar.
- **CA05** – Dada uma mensagem que falhou após todas as tentativas, quando a falha é definitiva, então o colaborador recebe o aviso com o contato do suporte.

### RF20 – Relatórios e Consultas pelo WhatsApp (por hierarquia)

**Prioridade:** Importante · **Fase:** v1.1 · **Módulo:** Canal WhatsApp

Requisito responsável por permitir que o colaborador peça relatórios pelo WhatsApp, em linguagem natural, recebendo apenas o que o seu papel permite: o Dono vê tudo; o Gerente vê as suas unidades sem folha; o Lançador vê só o que ele próprio lançou.

**Pedido de Relatório:**

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| Texto ou Áudio do Pedido | String ou Mídia | Sim |  |
| Tipo de Consulta Identificado | Enum | Não | R1 |
| Período | Intervalo de Datas | Não | R2 |
| Unidades | Lista de Referência | Não | R3 |
| Filtros | Categoria, Fornecedor, Forma de Pagamento, Canal | Não |  |

**Regras e observações do preenchimento dos campos:**

- **R1** Consultas disponíveis: RESUMO (receita, despesas, resultado e comparação com o período anterior), POR_CATEGORIA, POR_FORNECEDOR, POR_FORMA_PAGAMENTO, POR_CANAL, EVOLUCAO (mês a mês), PRECO_INSUMO (histórico de preço de um item) e MEUS_LANCAMENTOS. A IA apenas escolhe a consulta e os parâmetros; os números são calculados pelo banco de dados e formatados pelo sistema. A IA nunca soma, subtrai nem estima valores.
- **R2** Sem período citado, vale o mês corrente até hoje. Expressões como "hoje", "semana passada", "setembro", "este mês comparado com o anterior" são aceitas.
- **R3** Sem unidade citada, vale a unidade padrão; "todas" ou "geral" consolida as unidades de acesso.

**Regras de permissão:**

- **R4** Dono: todas as consultas, todas as unidades, inclusive valores de folha.
- **R5** Gerente: todas as consultas, apenas nas unidades de acesso, sem valores de categorias sensíveis (exceto com VER_FOLHA). Os totais avisam "não inclui valores restritos".
- **R6** Lançador: apenas MEUS_LANCAMENTOS (o que ele lançou, com totais só dos próprios lançamentos). Com a permissão CONSULTAR_RELATORIOS_WHATSAPP, passa a ter as consultas do Gerente nas suas unidades.
- **R7** Contador: não usa o WhatsApp (RF06).

- **Obs1:** A resposta sempre informa o período e as unidades considerados ("Resumo de 01/10 a 29/10, Restaurante Centro:"), para o usuário perceber se o pedido foi entendido.
- **Obs2:** A resposta tem até 12 linhas; relatórios maiores trazem os principais itens e um link para a tela correspondente do painel.
- **Obs3:** Pedidos ambíguos geram pergunta (por exemplo, quando "vendas da loja" pode ser mais de uma unidade).
- **Obs4:** Os resumos predefinidos ("resumo de hoje", "resumo da semana", "resumo do mês") podem ser antecipados para o MVP sem a interpretação livre, por decisão dos sócios (pendência P10). **[PROVISÓRIO – P10]** Proposta adotada: antecipar os resumos predefinidos para o MVP se couber no prazo; interpretação livre na v1.1.
- **Obs5:** Cada consulta conta na cota mensal de consultas do plano (RF21).

**Alteração:**

Não se aplica.

**Exclusão:**

Não se aplica.

**Pesquisa:**

Não se aplica.

**Critérios de aceite:**

- **CA01** – Dado o Dono, quando pergunta "quanto gastei com bebidas em setembro comparado com agosto?", então recebe os dois totais e a variação, idênticos a uma consulta independente ao banco.
- **CA02** – Dado um Gerente sem VER_FOLHA, quando pede "resumo do mês", então o total de despesas não contém folha e a resposta traz o aviso de valores restritos.
- **CA03** – Dado um Lançador, quando pede "o que eu lancei hoje?", então recebe só os próprios lançamentos do dia; e, ao pedir "quanto vendemos hoje?", recebe a recusa padronizada.
- **CA04** – Dado um pedido sem período, quando é respondido, então a resposta indica o mês corrente até hoje como período considerado.
- **CA05** – Dada uma resposta de relatório, quando o texto é comparado ao resultado da consulta no banco, então todos os números coincidem.

### RF21 – Limites de Uso e Proteção contra Abuso

**Prioridade:** Essencial · **Fase:** MVP · **Módulo:** Canal WhatsApp

Requisito responsável por limitar o uso do WhatsApp e da IA para manter o custo previsível dentro da assinatura, sem prejudicar o uso normal de um restaurante.

**Limites:**

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| Duração Máxima do Áudio | 180 segundos | Não | R1 |
| Tamanho Máximo da Imagem | 5 MB | Não |  |
| Mensagens por Usuário por Hora | Inteiro | Não | R2 |
| Mensagens por Empresa por Dia | Inteiro | Não | R2 |
| Consultas de Relatório por Empresa por Mês | Inteiro | Não | R3 |
| Limite de Custo de IA por Empresa por Mês | Moeda (US$) | Não | R4 |

**Regras e observações do preenchimento dos campos:**

- **R1** Conforme RF13.
- **R2** Valores iniciais sugeridos: 60 mensagens por usuário por hora e 1.000 por empresa por dia, configuráveis por plano. Acima do limite, o usuário recebe uma única vez por hora: "Recebi muitas mensagens seguidas. Aguarde alguns minutos e tente de novo." As mensagens excedentes são guardadas e não processadas.
- **R3** Cota mensal generosa por plano (sugestão: 300 consultas no Essencial, 1.000 no Profissional). Ao atingir 80%, o Dono recebe aviso no painel; ao atingir 100%, as consultas pelo WhatsApp são recusadas com orientação para usar o painel, que não tem cota. **[PROVISÓRIO – P03]** Cotas por plano dependem da definição dos planos.
- **R4** Ao ultrapassar o limite de custo configurado pela equipe do produto, a equipe é alertada (RF38). O cliente não é bloqueado automaticamente por custo.

- **Obs1:** Os limites e a contagem ficam visíveis à equipe interna (RF38); o Dono vê apenas a cota de consultas.

**Alteração:**

A equipe do produto ajusta os limites por plano ou por empresa.

**Exclusão:**

Não se aplica.

**Pesquisa:**

Não se aplica.

**Critérios de aceite:**

- **CA01** – Dadas 61 mensagens de um usuário em uma hora, quando a 61ª chega, então não é processada e o usuário recebe o aviso uma única vez.
- **CA02** – Dada a cota de consultas esgotada, quando o Dono pede um resumo pelo WhatsApp, então recebe a orientação de usar o painel, e o lançamento por WhatsApp continua funcionando.
- **CA03** – Dado um áudio de 181 segundos, quando é recebido, então segue o CA02 do RF13.

## 3.4 Painel

### RF22 – Lista e Pesquisa de Lançamentos

**Prioridade:** Essencial · **Fase:** MVP · **Módulo:** Painel

Requisito responsável pela tela principal de consulta dos lançamentos no painel, com filtros, ordenação e totais, usada no celular e no computador.

**Filtros:**

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| Período | Intervalo de Datas | Sim | R1 |
| Tipo | Enum (DESPESA, RECEITA, TODOS) | Não |  |
| Unidades | Lista de Referência | Não | R2 |
| Categorias | Lista de Referência | Não |  |
| Fornecedor | Referência | Não |  |
| Forma de Pagamento | Referência | Não |  |
| Canal de Venda | Referência | Não |  |
| Lançado por | Referência | Não | R3 |
| Canal de Origem | Enum | Não |  |
| Sinais de Revisão | Lista de Enum | Não | R4 |
| Busca Livre | String | Não | R5 |

**Colunas exibidas:**

Data, Descrição, Quantidade, Valor Bruto, Valor Líquido (receitas), Categoria, Fornecedor, Forma de Pagamento, Unidade, Lançado por, Canal de Origem e indicadores de revisão.

**Regras e observações do preenchimento dos campos:**

- **R1** Período padrão: mês corrente. Atalhos: hoje, ontem, últimos 7 dias, mês corrente, mês anterior, personalizado (até 24 meses por consulta).
- **R2** Somente as unidades de acesso do usuário. Padrão: unidade ativa no seletor do topo (RF02).
- **R3** Lançador vê apenas os próprios lançamentos e não tem este filtro.
- **R4** O filtro "a revisar" reúne CATEGORIA_A_REVISAR, POSSIVEL_DUPLICIDADE e DATA_ANTIGA. Marcar um lançamento como revisado remove o sinal e gera versão.
- **R5** Busca por descrição, fornecedor, valor exato ("450" ou "450,00") e chave de acesso de nota.

- **Obs1:** Os filtros ficam na URL: recarregar a página ou usar o botão voltar mantém a consulta, e o endereço pode ser compartilhado com outro usuário da mesma empresa (que verá apenas o que o seu papel permite).
- **Obs2:** Totais do filtro (receitas, despesas, resultado) são calculados pelo servidor, nunca pela tela.
- **Obs3:** Paginação contínua por cursor, ordenada por data e hora de criação decrescentes, sem pular nem repetir lançamentos quando entram novos durante a consulta.
- **Obs4:** No celular, cada lançamento aparece como cartão, e os filtros abrem em folha lateral, sem rolagem horizontal.
- **Obs5:** Lançamentos de categorias sensíveis seguem o RF06, regra 3. Lançamentos na lixeira não aparecem (ver RF24).
- **Obs6:** Estados de tela previstos: carregando, vazio com orientação ("Nenhum lançamento neste período. Que tal mandar o primeiro pelo WhatsApp?") e erro com opção de tentar de novo.

**Alteração:**

A partir da lista, o usuário abre a edição (RF23) conforme a permissão.

**Exclusão:**

A partir da lista, conforme RF24.

**Pesquisa:**

É o próprio requisito.

**Critérios de aceite:**

- **CA01** – Dados filtros de período e categoria, quando a página é recarregada, então os mesmos filtros e resultados são mostrados.
- **CA02** – Dado o seed de referência, quando o filtro de outubro é aplicado, então os totais da tela coincidem com uma consulta SQL independente.
- **CA03** – Dado um Lançador com painel liberado, quando abre a lista, então vê apenas os próprios lançamentos, mesmo manipulando os parâmetros da URL.
- **CA04** – Dado um novo lançamento gravado pelo WhatsApp enquanto o usuário rola a lista, quando a próxima página carrega, então nenhum lançamento aparece repetido ou é pulado.
- **CA05** – Dada a busca "450,00", quando é aplicada, então aparecem os lançamentos de valor exatamente R$ 450,00.

### RF23 – Edição de Lançamento no Painel

**Prioridade:** Essencial · **Fase:** MVP · **Módulo:** Painel

Requisito responsável pela edição completa de um lançamento no painel, com validação, recálculo de taxas e proteção contra edições simultâneas.

**Campos editáveis:**

Tipo, Data de Competência, Descrição, Quantidade, Unidade de Medida, Valor Bruto, Categoria, Fornecedor, Forma de Pagamento, Canal de Venda e Unidade (restaurante), com as regras do RF12. (R1)

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| Marcar como Revisado | Boolean | Não | R2 |

**Regras e observações do preenchimento dos campos:**

- **R1** Os valores em reais são digitados com máscara brasileira e convertidos para centavos sem ponto flutuante. Taxa e líquido são recalculados pelo sistema; não são editáveis diretamente. No painel, a data de competência pode ser futura em até 60 dias (despesas programadas).
- **R2** Remove os sinais de revisão do lançamento.

- **Obs1:** Permissão: Dono e Gerente editam lançamentos das suas unidades (exceto sensíveis sem VER_FOLHA); Lançador edita só os próprios, se tiver painel; Contador não edita (RF06).
- **Obs2:** Controle de concorrência: a edição envia a versão que o usuário abriu. Se o lançamento mudou nesse meio tempo (por outro usuário ou por correção no WhatsApp), a gravação é recusada com a mensagem "Este lançamento foi alterado por [nome] às hh:mm. Recarregar?", mostrando a versão atual.
- **Obs3:** Cada edição gera uma versão com canal PAINEL, contendo os valores anteriores e novos.
- **Obs4:** Lançamentos com taxas copiadas de configurações antigas mantêm essas taxas, salvo troca de forma de pagamento ou canal (RF17, regra 3).

**Alteração:**

É o próprio requisito.

**Exclusão:**

RF24.

**Pesquisa:**

Não se aplica.

**Critérios de aceite:**

- **CA01** – Dado o valor "1.234,56" digitado, quando é salvo, então o banco guarda 123456 centavos.
- **CA02** – Dadas duas abas editando o mesmo lançamento, quando a segunda tenta salvar depois da primeira, então recebe o aviso de alteração e nada é sobrescrito.
- **CA03** – Dada uma edição de valor, quando o histórico é consultado, então aparece a nova versão com quem, quando, canal PAINEL, valor anterior e novo.
- **CA04** – Dado um Contador, quando tenta editar pela API, então a requisição é recusada.

### RF24 – Lixeira: Exclusão e Restauração de Lançamentos

**Prioridade:** Essencial · **Fase:** MVP · **Módulo:** Painel

Requisito responsável por excluir lançamentos sem apagá-los de verdade: eles vão para a lixeira, de onde podem ser restaurados.

**Dados da Exclusão:**

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| Excluído por | Referência | Não |  |
| Excluído em | DateTime | Não |  |
| Motivo | String | Não | R1 |
| Restaurável até | Date | Não | R2 |

**Regras e observações do preenchimento dos campos:**

- **R1** Motivo é opcional no painel (até 200 caracteres); pelo "desfazer" do WhatsApp fica "Desfeito pelo WhatsApp".
- **R2** A lixeira mostra os lançamentos excluídos nos últimos 30 dias, restauráveis pelo Dono e pelo Gerente (e pelo Lançador, nos próprios). Após 30 dias, o lançamento sai da lixeira visível, mas continua guardado com status NA_LIXEIRA para auditoria e só é eliminado no encerramento da conta (RF37).

- **Obs1:** Excluir e restaurar geram versão (ações EXCLUSAO e RESTAURACAO).
- **Obs2:** Lançamentos na lixeira não entram em totais, gráficos, relatórios nem exportações, exceto na exportação completa para auditoria (RF29).
- **Obs3:** Exclusão em lote: o Dono e o Gerente podem selecionar vários lançamentos da lista e excluí-los de uma vez, com confirmação que mostra a quantidade e a soma dos valores.

**Alteração:**

Restaurar devolve o lançamento ao status ATIVO, com os valores da última versão.

**Exclusão:**

É o próprio requisito. Não existe exclusão física pelo cliente.

**Pesquisa:**

Tela "Lixeira" com filtros de período de exclusão, unidade e quem excluiu.

**Critérios de aceite:**

- **CA01** – Dado um lançamento excluído, quando o total do mês é consultado, então o valor não é somado.
- **CA02** – Dado um lançamento excluído há 10 dias, quando o Gerente o restaura, então volta a aparecer na lista e nos totais, e o histórico mostra a exclusão e a restauração.
- **CA03** – Dado o banco de dados, quando é consultado após uma exclusão, então a linha do lançamento continua existindo com status NA_LIXEIRA.

### RF25 – Ver Origem e Histórico de Versões

**Prioridade:** Essencial · **Fase:** MVP · **Módulo:** Painel

Requisito responsável por mostrar, para cada lançamento, de onde ele veio (o texto, o áudio ou a foto original) e tudo o que aconteceu com ele depois. É o que dá confiança ao dono e ao contador para aceitar lançamentos feitos por IA.

**Origem:**

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| Canal de Origem | Enum | Não |  |
| Texto Original | String | Não | R1 |
| Áudio e Transcrição | Mídia + String | Não | R2 |
| Imagem e Dados Lidos | Mídia + Estrutura | Não | R3 |
| Enviado por e em | Referência + DateTime | Não |  |

**Histórico**

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| Versões | Lista (número, ação, quem, quando, canal, campos alterados com valor anterior e novo) | Não | R4 |

**Regras e observações do preenchimento dos campos:**

- **R1** O texto original é exibido como texto puro, nunca interpretado como HTML.
- **R2** O áudio é tocado no próprio painel enquanto existir (90 dias, RF13), por endereço assinado de curta duração; a transcrição fica ao lado.
- **R3** A imagem da nota é exibida por endereço assinado de curta duração, junto com os itens lidos e a chave de acesso, quando houver.
- **R4** Ações: CRIACAO, ALTERACAO, EXCLUSAO, RESTAURACAO. Canais: WHATSAPP, PAINEL, IMPORTACAO, EMAIL, SISTEMA. As versões nunca são alteradas nem apagadas.

- **Obs1:** Quem vê o lançamento vê a origem, com uma exceção: se a mensagem de origem gerou vários lançamentos e algum deles é de categoria sensível, quem não pode ver sensíveis vê a origem com o aviso "contém informação restrita" e sem o conteúdo.
- **Obs2:** Endereços assinados expiram em até 10 minutos e nunca revelam o local real do arquivo.

**Alteração:**

Não se aplica: origem e histórico são somente leitura.

**Exclusão:**

Não se aplica.

**Pesquisa:**

Não se aplica.

**Critérios de aceite:**

- **CA01** – Dado um lançamento criado por áudio e corrigido no painel, quando o histórico é aberto, então mostra a criação pelo WhatsApp e a alteração pelo painel, com os valores antes e depois.
- **CA02** – Dado o endereço de uma imagem de nota copiado, quando é aberto 15 minutos depois, então o acesso é negado.
- **CA03** – Dado um texto original contendo "&lt;script>", quando a origem é exibida, então aparece como texto, sem executar nada.
- **CA04** – Dado o banco de dados, quando se tenta alterar ou apagar uma versão com o usuário da aplicação, então a operação é recusada pelo banco.

### RF26 – Lançamento Manual no Painel

**Prioridade:** Desejável · **Fase:** v1.1 · **Módulo:** Painel

Requisito responsável por permitir criar lançamentos diretamente no painel, por formulário, para quem prefere o computador ou precisa lançar algo fora do dia a dia (por exemplo, um gasto antigo).

**Cadastro:**

Os mesmos campos do Lançamento (RF12), com Canal de Origem = PAINEL. (R1)

**Regras e observações do preenchimento dos campos:**

- **R1** Campos obrigatórios: Tipo, Data de Competência, Descrição, Valor Bruto, Categoria e Unidade; Quantidade e Unidade de Medida quando a categoria exigir. O formulário sugere categoria a partir da descrição, como no WhatsApp. Taxas e líquido são calculados pelo sistema.

- **Obs1:** Permissão: quem pode lançar pelo WhatsApp e tem acesso ao painel (RF06).
- **Obs2:** Formulário de lançamentos em sequência ("salvar e lançar outro") para digitar várias notas de uma vez.

**Alteração:**

RF23.

**Exclusão:**

RF24.

**Pesquisa:**

RF22.

**Critérios de aceite:**

- **CA01** – Dado o formulário sem valor, quando o usuário tenta salvar, então a gravação é bloqueada com mensagem no campo.
- **CA02** – Dado um lançamento criado no painel, quando o histórico é aberto, então a criação aparece com canal PAINEL.

### RF27 – Dashboard (indicadores e gráficos)

**Prioridade:** Essencial · **Fase:** MVP · **Módulo:** Painel

Requisito responsável pela tela inicial do painel, que mostra ao dono, em poucos segundos e no celular, como está o restaurante no período.

**Parâmetros:**

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| Período | Intervalo de Datas | Sim | R1 |
| Unidades | Lista de Referência ou TODAS | Não |  |
| Comparar com | Enum | Não | R2 |

**Indicadores:**

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| Receita Bruta | Moeda | Não |  |
| Deduções (taxas e comissões) | Moeda | Não |  |
| Receita Líquida | Moeda | Não |  |
| Despesas Operacionais | Moeda | Não | R3 |
| Resultado do Período | Moeda | Não | R3 |
| Margem | Percentual | Não | R4 |
| CMV sobre a Receita | Percentual | Não | R4 |
| Folha sobre a Receita | Percentual | Não | R5 |
| Investimentos no Período | Moeda | Não | R3 |

**Gráficos:**

Receita × Despesa por mês (últimos 6 meses);

Despesas por categoria (grupo do DRE);

Evolução do resultado mensal;

Receita por canal de venda e por forma de pagamento. (R6)

**Regras e observações do preenchimento dos campos:**

- **R1** Padrão: mês corrente até hoje.
- **R2** Comparar com: PERIODO_ANTERIOR (mesmo número de dias imediatamente antes) ou MESMO_PERIODO_ANO_ANTERIOR. Cada indicador mostra a variação percentual e a direção.
- **R3** Resultado = Receita Bruta − Deduções − Despesas Operacionais. Investimentos não entram no resultado e aparecem em indicador próprio. O tratamento dos impostos sobre faturamento depende da pendência P05. **[PROVISÓRIO – P05]** Proposta adotada: impostos sobre faturamento lançados como despesa da categoria própria, sem cálculo automático no MVP.
- **R4** Margem = Resultado ÷ Receita Bruta. CMV sobre a Receita = despesas do grupo CMV ÷ Receita Bruta. Percentuais são calculados pelo servidor e exibidos com uma casa decimal. Sem receita no período, os percentuais aparecem como "—".
- **R5** Somente para quem pode ver categorias sensíveis. Para os demais, o indicador não é enviado pela API (não basta esconder na tela).
- **R6** Receitas sem canal ou forma aparecem como "Não informado".

- **Obs1:** Todos os números vêm de consultas de agregação no servidor; a tela nunca soma valores.
- **Obs2:** Cada gráfico tem alternativa em tabela, para acessibilidade e para quem prefere números.
- **Obs3:** Os blocos carregam de forma independente: um bloco lento não trava os demais.
- **Obs4:** Estado vazio útil: "Ainda não há lançamentos neste período", com o número de WhatsApp do produto.
- **Obs5:** Lançador não tem acesso ao dashboard, salvo a visão "meus lançamentos" (RF22). Indicadores adicionais desejados pelo dono (ticket médio, ponto de equilíbrio) dependem de dados que o produto ainda não coleta e são pendência P09. **[PROVISÓRIO – P09]** Proposta adotada: margem, CMV % e folha % no MVP; demais indicadores dependem do Matheus.

**Alteração:**

Não se aplica.

**Exclusão:**

Não se aplica.

**Pesquisa:**

Não se aplica.

**Critérios de aceite:**

- **CA01** – Dado o seed de referência, quando o dashboard de outubro é aberto, então cada indicador é idêntico a uma consulta SQL independente sobre os mesmos dados.
- **CA02** – Dado um Gerente sem VER_FOLHA, quando a API do dashboard é consultada, então a resposta não contém o indicador de folha.
- **CA03** – Dado um investimento de R$ 3.200,00 no mês, quando o resultado é calculado, então o valor não reduz o resultado e aparece em Investimentos.
- **CA04** – Dado um período sem receitas, quando o dashboard é aberto, então margem e CMV aparecem como "—", sem erro de divisão.
- **CA05** – Dado um celular com largura de 360 pixels, quando o dashboard é aberto, então não há rolagem horizontal.

## 3.5 Relatórios

### RF28 – DRE Gerencial e Fechamento Mensal (PDF)

**Prioridade:** Importante · **Fase:** v1.1 · **Módulo:** Relatórios

Requisito responsável pelo relatório de resultado do mês no formato de DRE gerencial simplificado, visível no painel e exportável em PDF para o dono e para o contador.

**Parâmetros:**

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| Mês de Referência | Mês/Ano | Sim |  |
| Unidades | Lista de Referência ou TODAS | Não |  |
| Detalhamento | Enum | Não | R1 |

**Estrutura do DRE:**

Receita Bruta (por canal); (−) Deduções; (=) Receita Líquida; (−) CMV; (=) Lucro Bruto; (−) Pessoal; (−) Ocupação; (−) Utilidades; (−) Operacionais; (−) Marketing; (−) Financeiras; (=) Resultado Operacional; Investimentos do mês (informativo); Despesas recorrentes ainda sem lançamento no mês (informativo). (R2)

**Regras e observações do preenchimento dos campos:**

- **R1** Detalhamento: GRUPOS (só os grupos do DRE) ou CATEGORIAS (abre as categorias e subcategorias).
- **R2** Lista as despesas recorrentes de valor variável que costumam aparecer todo mês e ainda não foram lançadas (por exemplo, "Energia: sem lançamento em outubro"), de forma informativa, sem lembrete ativo (RF33).

- **Obs1:** Cada linha mostra o valor, o percentual sobre a Receita Bruta e a comparação com o mês anterior.
- **Obs2:** O PDF tem cabeçalho com a empresa, as unidades, o mês, a data de geração e o aviso "Relatório gerencial, sem valor fiscal".
- **Obs3:** A estrutura final e o tratamento de impostos dependem das pendências P01 e P05 (sócio contador). **[PROVISÓRIO – P05]** Mesma proposta do RF27.R3.
- **Obs4:** Folha aparece consolidada como "Pessoal (restrito)" para quem não pode ver sensíveis.

**Alteração:**

Não se aplica. Um mês fechado continua refletindo correções posteriores; o PDF gerado registra a data e a hora em que foi emitido.

**Exclusão:**

Não se aplica.

**Pesquisa:**

Lista dos PDFs gerados, por mês e unidade.

**Critérios de aceite:**

- **CA01** – Dado o seed de referência, quando o DRE de outubro é gerado, então o Resultado Operacional coincide com o Resultado do dashboard (RF27) para o mesmo período.
- **CA02** – Dado um Gerente sem VER_FOLHA, quando gera o PDF, então a folha aparece só como linha consolidada restrita, sem valor.

### RF29 – Exportação de Dados (Excel e CSV)

**Prioridade:** Essencial · **Fase:** MVP · **Módulo:** Relatórios

Requisito responsável por exportar os lançamentos em planilha, para o dono, para o contador ou para qualquer outro sistema. Também atende ao direito do cliente de levar seus dados a qualquer momento.

**Pedido de Exportação:**

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| Formato | Enum | Sim | R1 |
| Filtros | os mesmos do RF22 | Não | R2 |
| Conteúdo | Enum | Não | R3 |
| Situação | Enum | Não | R4 |
| Link para Download | URL assinada | Não | R5 |
| Solicitado por e em | Referência + DateTime | Não |  |

**Regras e observações do preenchimento dos campos:**

- **R1** Formato: XLSX ou CSV. O CSV usa separador ponto e vírgula e codificação UTF-8 com BOM, para abrir corretamente no Excel em português. No XLSX, valores são números com formato de moeda e datas são datas, nunca texto.
- **R2** A exportação respeita os filtros aplicados na lista e as permissões do usuário (categorias sensíveis fora para quem não pode vê-las).
- **R3** Conteúdo: LANCAMENTOS (uma linha por lançamento ativo: data, tipo, descrição, quantidade, unidade de medida, valor bruto, taxa, líquido, categoria, subcategoria, grupo do DRE, fornecedor, documento do fornecedor, forma de pagamento, canal, unidade, lançado por, canal de origem, criado em) ou COMPLETO (inclui os lançamentos na lixeira, com coluna de status, e o histórico de versões; só para o Dono).
- **R4** Situação: NA_FILA, GERANDO, PRONTO, FALHOU. A geração acontece em segundo plano; o usuário pode sair da tela e é avisado quando ficar pronta.
- **R5** O link vale por 1 hora e o arquivo é eliminado após 7 dias. Só o usuário que pediu pode baixá-lo.

- **Obs1:** Permissão: Dono sempre; Gerente com EXPORTAR_DADOS; Contador sempre (Fase 2). Toda exportação é registrada na trilha de auditoria (quem, quando, filtros e quantidade de linhas).
- **Obs2:** O pacote mensal para o contador (planilha + DRE em PDF + imagens das notas do mês, em um arquivo compactado) é evolução da Fase: v1.1, com conteúdo definido pelo sócio contador.

**Alteração:**

Não se aplica.

**Exclusão:**

Arquivos gerados são eliminados automaticamente após 7 dias.

**Pesquisa:**

Lista das exportações dos últimos 7 dias do próprio usuário, com situação e link.

**Critérios de aceite:**

- **CA01** – Dado o seed de referência, quando o XLSX de outubro é aberto no Excel, então a soma da coluna de valor bruto e a quantidade de linhas coincidem com o painel para o mesmo filtro.
- **CA02** – Dado um CSV com a descrição "Pão de açúcar", quando é aberto no Excel em português, então os acentos aparecem corretamente e cada campo fica em sua coluna.
- **CA03** – Dado um Gerente sem EXPORTAR_DADOS, quando tenta exportar pela API, então é recusado.
- **CA04** – Dado o link de exportação de outro usuário ou de outra empresa, quando é aberto, então o acesso é negado.
- **CA05** – Dado um link gerado há mais de 1 hora, quando é aberto, então o acesso é negado.

### RF30 – Perguntas em Linguagem Natural sobre os Dados (painel)

**Prioridade:** Importante · **Fase:** v1.1 · **Módulo:** Relatórios

Requisito responsável por permitir que o usuário faça perguntas sobre os números do restaurante em uma caixa de conversa no painel ("quanto gastei com bebidas em setembro comparado com agosto?", "qual fornecedor de carne ficou mais caro?"), com respostas em texto, tabela e gráfico.

**Pergunta:**

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| Texto da Pergunta | String (até 500 caracteres) | Sim |  |
| Consultas Executadas | Lista (consulta, parâmetros) | Não | R1 |
| Resposta | Texto + Tabela + Gráfico | Não | R2 |

**Regras e observações do preenchimento dos campos:**

- **R1** A IA escolhe entre as consultas predefinidas e parametrizadas do RF20 (e outras que forem acrescentadas), podendo encadear até 3 consultas para uma comparação. Os números vêm sempre do banco de dados. A IA não escreve consultas livres ao banco, não soma, não estima e não inventa valores.
- **R2** A resposta mostra os números calculados, os parâmetros usados ("Período: 01/09 a 30/09; Unidades: todas") e um link para a tela correspondente com os filtros aplicados, para o usuário conferir.

- **Obs1:** As permissões são as mesmas do RF20 e do RF06: a IA recebe apenas dados que o usuário pode ver.
- **Obs2:** Perguntas que nenhuma consulta disponível responde recebem "Ainda não sei responder isso com os dados do sistema" e a sugestão de perguntas próximas. Perguntas fora do controle financeiro são recusadas (RF19).
- **Obs3:** As perguntas são guardadas por 90 dias no histórico do próprio usuário. A equipe usa amostras anonimizadas, com consentimento, para melhorar as consultas disponíveis.
- **Obs4:** Sem cota no painel para o Dono; o custo é acompanhado pela equipe (RF38).

**Alteração:**

Não se aplica.

**Exclusão:**

O usuário pode limpar o próprio histórico de perguntas.

**Pesquisa:**

Histórico das perguntas do próprio usuário.

**Critérios de aceite:**

- **CA01** – Dada a pergunta "quanto gastei com bebidas em setembro comparado com agosto?", quando é respondida, então os dois valores coincidem com consultas independentes e a resposta indica os períodos usados.
- **CA02** – Dado um Gerente sem VER_FOLHA, quando pergunta "quanto paguei de salário em setembro?", então recebe a recusa por permissão, sem valores.
- **CA03** – Dada uma pergunta que nenhuma consulta cobre, quando é processada, então nenhum número é exibido.

## 3.6 Automações e integrações

### RF31 – Captura Automática de Notas Fiscais por E-mail

**Prioridade:** Importante · **Fase:** v1.1 · **Módulo:** Automações e integrações

Requisito responsável por lançar automaticamente as compras cujas notas fiscais (NF-e) são emitidas no CNPJ do restaurante e enviadas por e-mail. Cada empresa recebe um endereço de e-mail exclusivo; o fornecedor envia a nota para ele, ou o restaurante encaminha automaticamente, e o sistema lê o arquivo XML da nota e lança sem ninguém precisar lembrar.

**Configuração da Captura:**

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| Endereço de Recebimento | String (gerado pelo sistema) | Não | R1 |
| CNPJs Aceitos | Lista de String | Não | R2 |
| Responsável pelos Avisos | Referência | Não | R3 |
| Situação da Captura | Enum | Não | R4 |

**Dados de Cada Nota Recebida**

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| Remetente do E-mail | String | Não |  |
| Arquivos Recebidos | Lista (XML, PDF) | Não |  |
| Chave de Acesso | String (44 dígitos) | Não |  |
| Emitente | CNPJ + Razão Social | Não |  |
| Destinatário | CNPJ | Não | R2 |
| Data de Emissão | Date | Não |  |
| Itens | Lista (descrição, NCM, quantidade, unidade, valor) | Não |  |
| Valor Total | Moeda | Não |  |
| Duplicatas (vencimentos) | Lista (número, data, valor) | Não | R5 |
| Situação da Nota | Enum | Não | R6 |

**Regras e observações do preenchimento dos campos:**

- **R1** Endereço exclusivo e difícil de adivinhar por empresa, no domínio do produto (ex.: notas.centro-8k3f@dominio.com.br). O Dono pode gerar um novo endereço, invalidando o anterior.
- **R2** Só são aceitas notas cujo destinatário seja o CNPJ da empresa ou de uma das suas unidades (RF01 e RF04). Notas de outro destinatário ficam em QUARENTENA, visíveis ao Dono, que pode descartá-las ou aceitá-las. A captura só pode ser ativada com pelo menos um CNPJ cadastrado.
- **R3** Colaborador que recebe pelo WhatsApp o aviso de cada nota lançada (padrão: Dono). O aviso usa modelo de mensagem aprovado e respeita o consentimento (RF19).
- **R4** Situação: INATIVA, ATIVA ou SUSPENSA (conta em SOMENTE_LEITURA).
- **R5** Duplicatas são guardadas para uma futura funcionalidade de contas a pagar; no lançamento, a data de competência é a data de emissão.
- **R6** Situação: LANCADA, DUPLICADA (chave já registrada por foto, e-mail ou importação: nada é lançado), QUARENTENA, ILEGIVEL (sem XML e PDF não legível) ou IGNORADA (e-mail sem nota).

**Regras de lançamento:**

- **R7** Com o XML, os dados são lidos de forma determinística, sem IA; a IA é usada apenas para classificar os itens nas categorias. Sem XML, apenas com o PDF (DANFE), a IA lê o PDF e o lançamento recebe o sinal CATEGORIA_A_REVISAR.
- **R8** Os itens são agrupados por categoria, como no RF14, regra 4. O lançamento vai para a unidade cujo CNPJ é o destinatário; se o CNPJ for da empresa e houver várias unidades, vai para a unidade principal configurada, com sinal para revisão.
- **R9** Canal de Origem = EMAIL; "Lançado por" = Sistema (captura de notas). A origem guarda o XML e o PDF.
- **R10** Mensagem de aviso: "📩 Nota recebida por e-mail: Atacadão, R$ 1.240,00, 8 itens (Carnes, Limpeza). Responda para ajustar." A resposta a esse aviso permite correção, como no RF17.

- **Obs1:** Atores: Dono (configura); fornecedores (enviam); sistema (lança). Sistema externo: serviço de recebimento de e-mails com encaminhamento para a API.
- **Obs2:** Cupons do dia a dia (NFC-e de supermercado) normalmente não chegam por e-mail e continuam entrando pela foto (RF14).
- **Obs3:** Anexos aceitos: XML e PDF, até 10 MB por e-mail. Outros anexos são ignorados e nunca abertos.

**Alteração:**

O Dono pode mudar os CNPJs aceitos, o responsável pelos avisos e gerar novo endereço. Notas lançadas são corrigidas como qualquer lançamento.

**Exclusão:**

Notas em quarentena podem ser descartadas pelo Dono (ficam registradas como descartadas).

**Pesquisa:**

Tela "Notas recebidas" com filtros por situação, emitente, período e chave de acesso.

**Critérios de aceite:**

- **CA01** – Dado um e-mail com o XML de uma NF-e destinada ao CNPJ da empresa, quando é recebido, então os lançamentos são criados com valores idênticos ao XML e o responsável recebe o aviso.
- **CA02** – Dada uma nota já registrada por foto, quando chega por e-mail, então fica DUPLICADA e nada é lançado.
- **CA03** – Dada uma nota destinada a outro CNPJ, quando é recebida, então fica em QUARENTENA e nada é lançado.
- **CA04** – Dado um e-mail com anexo .exe, quando é recebido, então o anexo é ignorado sem ser aberto.

### RF32 – Captura de NF-e pela SEFAZ com Certificado Digital

**Prioridade:** Desejável · **Fase:** Fase 2 · **Módulo:** Automações e integrações

Requisito responsável por buscar diretamente na SEFAZ todas as NF-e emitidas contra o CNPJ do restaurante, usando o certificado digital A1 da empresa, para que as compras de fornecedores formais entrem mesmo quando a nota não chega por e-mail.

**Configuração:**

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| Certificado Digital A1 | Arquivo (.pfx) + Senha | Não | R1 |
| Validade do Certificado | Date | Não | R2 |
| CNPJs Monitorados | Lista de String | Não |  |
| Última Consulta | DateTime | Não |  |
| Situação | Enum (ATIVA, CERTIFICADO_VENCIDO, ERRO_SEFAZ, INATIVA) | Não |  |

**Regras e observações do preenchimento dos campos:**

- **R1** O certificado e a senha são guardados cifrados em cofre de segredos, nunca no banco em texto puro nem em logs, e usados apenas para a consulta de notas. Só o Dono envia ou remove o certificado.
- **R2** O Dono é avisado 30 e 7 dias antes do vencimento.

- **Obs1:** As notas obtidas seguem as mesmas regras do RF31 (leitura do XML, deduplicação pela chave de acesso, agrupamento por categoria, aviso ao responsável), com Canal de Origem = SISTEMA.
- **Obs2:** Viabilidade legal, custódia do certificado e frequência de consulta permitida pela SEFAZ são pendências do sócio contador (P11). O requisito só é implementado após essa validação. **[PROVISÓRIO – P11]** O requisito só é implementado após a validação do Matheus.

**Alteração:**

Troca do certificado pelo Dono.

**Exclusão:**

Remover o certificado interrompe a captura e o apaga do cofre.

**Pesquisa:**

Mesma tela do RF31.

**Critérios de aceite:**

- **CA01** – Dada uma NF-e emitida contra o CNPJ e não recebida por e-mail, quando a consulta periódica roda, então a nota é lançada uma única vez.
- **CA02** – Dado o banco de dados e os logs, quando são inspecionados, então não contêm o certificado nem a senha em texto puro.

### RF33 – Lançamentos Recorrentes

**Prioridade:** Importante · **Fase:** v1.1 · **Módulo:** Automações e integrações

Requisito responsável pelos gastos que se repetem todo mês. Gastos de valor fixo (aluguel, mensalidade de sistema) podem ser lançados automaticamente; gastos de valor variável (energia, água, gás) não são lançados nem cobrados, apenas aparecem no fechamento como "ainda sem lançamento neste mês".

**Cadastro da Recorrência:**

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| Descrição | String | Sim |  |
| Unidade | Referência | Sim |  |
| Categoria | Referência | Sim |  |
| Fornecedor | Referência | Não |  |
| Forma de Pagamento | Referência | Não |  |
| Tipo de Valor | Enum | Sim | R1 |
| Valor | Moeda | Não | R1 |
| Dia do Mês | Inteiro (1 a 31) | Sim | R2 |
| Lançar Automaticamente | Boolean | Não | R3 |
| Início | Mês/Ano | Sim |  |
| Fim | Mês/Ano | Não |  |
| Status | Enum (ATIVA, PAUSADA, ENCERRADA) | Não |  |

**Regras e observações do preenchimento dos campos:**

- **R1** Tipo de Valor: FIXO (valor obrigatório) ou VARIAVEL (valor vazio).
- **R2** Em meses mais curtos, dia 29, 30 ou 31 vira o último dia do mês.
- **R3** Só para Tipo FIXO. No dia configurado, o sistema cria o lançamento com Canal de Origem = SISTEMA, uma única vez por mês, mesmo que o processo rode de novo. Tipo VARIAVEL nunca gera lançamento automático.

- **Obs1:** Atores: Dono e Gerente (sem categorias sensíveis para o Gerente, salvo VER_FOLHA).
- **Obs2:** O sistema sugere recorrências ao perceber o mesmo fornecedor e categoria em 3 meses seguidos ("Parece que a conta de luz é mensal. Quer acompanhar?"), no painel, nunca por mensagem.
- **Obs3:** Recorrências VARIAVEL sem lançamento no mês aparecem no DRE (RF28) e no resumo semanal (RF34) como informação, sem lembrete insistente.
- **Obs4:** Se um lançamento recorrente automático já tiver sido lançado manualmente no mês (mesma categoria e fornecedor, valor igual), o automático não é criado.

**Alteração:**

Alterar valor ou dia vale a partir do próximo mês. Lançamentos já gerados são corrigidos como qualquer lançamento.

**Exclusão:**

Não será realizada exclusão física; a recorrência é encerrada, mantendo os lançamentos gerados.

**Pesquisa:**

Lista de recorrências com próximo lançamento previsto.

**Critérios de aceite:**

- **CA01** – Dado o aluguel FIXO de R$ 5.000,00 no dia 5 com lançamento automático, quando chega o dia 5, então existe exatamente um lançamento de aluguel no mês, mesmo que o processo rode duas vezes.
- **CA02** – Dada uma recorrência no dia 31, quando o mês é fevereiro, então o lançamento é criado no último dia de fevereiro.
- **CA03** – Dada a energia VARIAVEL sem lançamento em outubro, quando o DRE de outubro é gerado, então aparece "Energia: sem lançamento em outubro" e nenhum valor é inventado.

### RF34 – Resumo Semanal e Alertas por Exceção

**Prioridade:** Importante · **Fase:** v1.1 · **Módulo:** Automações e integrações

Requisito responsável pelas mensagens proativas: um resumo curto toda semana e poucos alertas, só quando algo foge do padrão. Poucos e relevantes, para não virarem ruído.

**Configuração por Colaborador:**

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| Receber Resumo Semanal | Boolean | Não | R1 |
| Dia e Horário do Resumo | Enum + Hora (padrão: segunda, 8h) | Não |  |
| Receber Alertas | Boolean | Não | R1 |
| Tipos de Alerta | Lista de Enum | Não | R2 |
| Canal | Enum (WHATSAPP, EMAIL, AMBOS) | Não |  |

**Regras e observações do preenchimento dos campos:**

- **R1** Disponível para o Dono e para quem tem a permissão RECEBER_RESUMO_SEMANAL. Exige consentimento ativo (RF19, "parar").
- **R2** Tipos de alerta: ALTA_PRECO_INSUMO (item com preço unitário pelo menos 20% acima da média dos últimos 90 dias), CATEGORIA_ACIMA_DO_PADRAO (categoria no mês pelo menos 30% acima da média dos 3 meses anteriores, considerando os dias decorridos), QUEDA_DE_MARGEM (margem da semana pelo menos 5 pontos percentuais abaixo da média de 4 semanas), PESO_DOS_APLICATIVOS (comissões de aplicativos acima de 15% da receita bruta no mês). Os limites são parâmetros configuráveis pela equipe e serão calibrados no piloto.

**Conteúdo do Resumo Semanal:**

Até 6 linhas: receita, despesas, resultado e variação em relação à semana anterior, maior gasto da semana, recorrentes variáveis sem lançamento no mês e link para o painel. Os números são calculados pelo banco; a IA não escreve valores.

- **Obs1:** Mensagens fora da janela de 24 horas usam modelos aprovados pela Meta, na categoria de utilidade.
- **Obs2:** No máximo 1 alerta por tipo por semana e 3 alertas por colaborador por semana.
- **Obs3:** Respeita as permissões: o Gerente recebe só as suas unidades e sem folha.
- **Obs4:** O fechamento mensal (RF28) pode ser enviado por e-mail ao Dono e ao Contador no dia 1 de cada mês.

**Alteração:**

Cada colaborador ajusta as próprias preferências no perfil; o Dono ajusta as de todos.

**Exclusão:**

Não se aplica.

**Pesquisa:**

Histórico de resumos e alertas enviados, no painel.

**Critérios de aceite:**

- **CA01** – Dado um Gerente da unidade Centro com resumo ativo, quando o resumo é enviado, então contém apenas dados do Centro e nenhum valor de folha.
- **CA02** – Dado um colaborador que enviou "parar", quando chega o horário do resumo, então ele não recebe nada.
- **CA03** – Dado o camarão comprado a R$ 110,00/kg com média de R$ 85,00/kg nos últimos 90 dias, quando o lançamento é gravado, então o alerta de alta de preço é enviado uma vez na semana.
- **CA04** – Dado o resumo enviado, quando seus números são comparados ao dashboard da mesma semana, então coincidem.

### RF35 – Importação de Planilhas, Extratos e Relatórios de Vendas

**Prioridade:** Importante · **Fase:** v1.1 · **Módulo:** Automações e integrações

Requisito responsável por trazer dados que o restaurante já tem: planilhas antigas de controle, extratos bancários e relatórios de vendas exportados de PDV ou de aplicativos de delivery. Atende tanto quem já tem planilha quanto quem quer começar com histórico.

**Importação:**

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| Tipo de Arquivo | Enum | Sim | R1 |
| Arquivo | XLSX, CSV ou OFX (até 10 MB) | Sim |  |
| Unidade | Referência | Sim |  |
| Mapeamento de Colunas | Lista (coluna do arquivo → campo do lançamento) | Não | R2 |
| Pré-visualização | Lista | Não | R3 |
| Situação | Enum (ANALISANDO, AGUARDANDO_CONFIRMACAO, IMPORTANDO, CONCLUIDA, FALHOU, DESFEITA) | Não |  |
| Resultado | Inteiros (importados, ignorados por duplicidade, com erro) | Não |  |

**Regras e observações do preenchimento dos campos:**

- **R1** Tipo: PLANILHA_LANCAMENTOS (planilha de controle do próprio restaurante), EXTRATO_BANCARIO (OFX ou CSV do banco), RELATORIO_VENDAS (PDV ou aplicativo de delivery).
- **R2** A IA sugere o mapeamento das colunas (data, descrição, valor, categoria, forma de pagamento) e o usuário confirma ou ajusta. A IA só mapeia colunas e classifica categorias; os valores vêm do arquivo, convertidos sem ponto flutuante.
- **R3** Antes de importar, o usuário vê as primeiras linhas como ficarão, os totais por mês e os problemas encontrados (data inválida, valor vazio). Nada é gravado sem a confirmação.

- **Obs1:** Canal de Origem = IMPORTACAO. Cada importação tem identificador próprio e pode ser **desfeita inteira** em até 30 dias, mandando todos os seus lançamentos para a lixeira.
- **Obs2:** Duplicidade: linhas iguais (data, valor, descrição) a lançamentos já existentes são sinalizadas e, por padrão, ignoradas. Em extratos, créditos e débitos podem corresponder a lançamentos já feitos pelo WhatsApp; o sistema propõe a conciliação em vez de duplicar.
- **Obs3:** Permissão: Dono e Gerente.
- **Obs4:** Formatos de PDV e aplicativos suportados serão definidos com base nos sistemas mais usados pelos clientes (pendência do sócio contador).

**Alteração:**

Lançamentos importados são corrigidos como qualquer lançamento.

**Exclusão:**

Desfazer a importação inteira (Obs1).

**Pesquisa:**

Lista de importações com resultado e opção de desfazer.

**Critérios de aceite:**

- **CA01** – Dada uma planilha com 120 linhas, quando o usuário confirma a pré-visualização, então são criados 120 lançamentos e a soma coincide com a da planilha.
- **CA02** – Dada a mesma planilha importada duas vezes, quando a segunda é analisada, então as 120 linhas são sinalizadas como duplicadas e ignoradas por padrão.
- **CA03** – Dada uma importação desfeita, quando os totais são consultados, então nenhum lançamento dela é somado.

### RF36 – Acesso do Contador (multicliente)

**Prioridade:** Desejável · **Fase:** Fase 2 · **Módulo:** Automações e integrações

Requisito responsável por dar ao contador do restaurante acesso de leitura e exportação, com uma visão única de todas as empresas clientes que o convidaram. Também apoia o canal de vendas por indicação de contadores.

**Cadastro do Contador:**

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| Nome | String | Sim |  |
| E-mail | String | Sim | R1 |
| Escritório de Contabilidade | String | Não |  |
| CRC | String | Não | R2 |
| Código de Indicação | String | Não | R3 |
| Empresas Vinculadas | Lista | Não | R4 |

**Regras e observações do preenchimento dos campos:**

- **R1** O contador é convidado pelo Dono (RF05, papel CONTADOR) e entra pelo RF02. O mesmo e-mail pode estar em várias empresas.
- **R2** CRC é opcional e informativo.
- **R3** Código para indicar o produto a outros clientes (RF01, regra 14).
- **R4** A tela inicial do contador lista as empresas vinculadas com o último lançamento, o resultado do mês e pendências de revisão de cada uma. Ao entrar em uma empresa, valem as permissões do papel CONTADOR (RF06).

- **Obs1:** O Dono pode revogar o acesso do contador a qualquer momento (RF05).
- **Obs2:** O contador nunca lança nem edita; observações sobre lançamentos são uma evolução futura (comentários).

**Alteração:**

O próprio contador altera nome, escritório e CRC.

**Exclusão:**

Revogação do vínculo pelo Dono.

**Pesquisa:**

Busca das empresas vinculadas por nome ou CNPJ.

**Critérios de aceite:**

- **CA01** – Dado um contador vinculado a 3 empresas, quando entra no painel, então vê as 3 e nenhuma outra.
- **CA02** – Dado o acesso revogado por um Dono, quando o contador recarrega a tela, então essa empresa deixa de aparecer e seus dados ficam inacessíveis.

## 3.7 Assinatura e operação

### RF37 – Assinatura, Plano, Período de Teste e Encerramento da Conta

**Prioridade:** Importante · **Fase:** MVP · **Módulo:** Assinatura e operação

Requisito responsável pelo ciclo de vida comercial da conta: período de teste, escolha de plano, situação de pagamento, limites por plano e encerramento com devolução e eliminação dos dados conforme a LGPD.

**Assinatura:**

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| Plano | Enum | Sim | R1 |
| Ciclo de Cobrança | Enum (MENSAL, ANUAL) | Não |  |
| Quantidade de Unidades Contratadas | Inteiro | Não | R2 |
| Situação do Pagamento | Enum | Não | R3 |
| Próxima Cobrança | Date | Não |  |
| Meio de Pagamento | Referência ao provedor de pagamentos | Não | R4 |

**Encerramento**

| Campo | Tipo | Obrig. | Regra |
|---|---|---|---|
| Solicitado por e em | Referência + DateTime | Não |  |
| Motivo do Cancelamento | Enum + String | Não | R5 |
| Dados Disponíveis até | Date | Não | R6 |

**Regras e observações do preenchimento dos campos:**

- **R1** Plano: TESTE, ESSENCIAL, PROFISSIONAL ou FUNDADOR (preço especial para os pilotos). Limites por plano (usuários, unidades, cota de consultas) e preços são pendência dos sócios (P03). **[PROVISÓRIO – P03]** Limites por plano e preços são decisão dos sócios.
- **R2** Cobrança por restaurante (unidade), com desconto por unidade adicional.
- **R3** Situação: EM_DIA, PENDENTE (até 7 dias após o vencimento, com avisos ao Dono), ATRASADO (após 7 dias: conta em SOMENTE_LEITURA, RF01 regra 16).
- **R4** Os dados de cartão ficam exclusivamente no provedor de pagamentos; o produto nunca os recebe nem armazena. A escolha do provedor (Pix recorrente, boleto, cartão) é pendência dos sócios.
- **R5** Motivo: PRECO, NAO_USEI, FALTOU_FUNCIONALIDADE, FECHOU_O_RESTAURANTE, MUDEI_DE_SISTEMA ou OUTRO, com texto opcional.
- **R6** Após o cancelamento, o Dono mantém acesso de leitura e exportação por 90 dias. Depois disso, os dados da empresa são eliminados ou anonimizados de forma irreversível, exceto o que houver obrigação legal de guardar (dados de cobrança), e a situação passa a ENCERRADA.

- **Obs1:** Atores: Dono. Só o Dono vê a assinatura e os valores cobrados.
- **Obs2:** Ao fim do teste sem plano escolhido, a conta vai para SOMENTE_LEITURA: o painel continua consultável e as mensagens de lançamento recebem "O período de teste terminou. Peça ao responsável para escolher um plano." O lançamento volta a funcionar no momento da contratação.
- **Obs3:** Mensagens recebidas enquanto a conta está em SOMENTE_LEITURA são guardadas, mas não viram lançamentos.
- **Obs4:** O Dono pode exportar todos os dados a qualquer momento (RF29, conteúdo COMPLETO), inclusive durante os 90 dias após o cancelamento.
- **Obs5:** O cancelamento pode ser revertido pelo Dono enquanto a situação não for ENCERRADA.

**Alteração:**

Mudança de plano: para cima, imediata; para baixo, no próximo ciclo, desde que os limites do novo plano sejam atendidos (o sistema mostra o que precisa ser ajustado).

**Exclusão:**

Encerramento conforme regra 6. A eliminação gera registro de quando e o que foi eliminado.

**Pesquisa:**

Histórico de cobranças e faturas para o Dono.

**Critérios de aceite:**

- **CA01** – Dada uma conta em teste que venceu, quando um colaborador lança pelo WhatsApp, então recebe o aviso de fim do teste e nenhum lançamento é criado; e o painel continua consultável.
- **CA02** – Dada uma conta cancelada há 91 dias, quando o processo de eliminação roda, então os lançamentos, mensagens e arquivos da empresa não existem mais e a situação é ENCERRADA.
- **CA03** – Dada uma conta cancelada há 30 dias, quando o Dono pede a exportação completa, então o arquivo é gerado.
- **CA04** – Dada uma tentativa de mudar para um plano com menos unidades do que as ativas, quando é solicitada, então o sistema bloqueia e mostra quantas unidades precisam ser inativadas.

### RF38 – Painel Interno de Operação (equipe do produto)

**Prioridade:** Importante · **Fase:** MVP · **Módulo:** Assinatura e operação

Requisito responsável pela área restrita à equipe do produto (os sócios e, no futuro, o suporte), usada para acompanhar o custo de IA por cliente, a saúde do processamento de mensagens e as contas, com acesso mínimo a dados dos clientes.

**Funcionalidades:**

**Contas**

Lista de empresas com plano, situação, data de criação, unidades, usuários ativos e último lançamento; sem acesso aos lançamentos.

**Custo e Uso**

Custo de IA por empresa e por mês (modelo de linguagem e transcrição), mensagens processadas, custo médio por mensagem, consumo das cotas. (R1)

**Saúde do Processamento**

Mensagens em fila, tempo médio de processamento, mensagens em falha definitiva (fila de mensagens mortas) com o código do erro, falhas de envio pelo WhatsApp. (R2)

**Suporte**

Ações administrativas registradas: estender teste, ajustar limites, trocar o e-mail do Dono após confirmação de identidade (RF03), reprocessar mensagens com falha. (R3)

**Regras e observações do preenchimento dos campos:**

- **R1** Alerta quando o custo de uma empresa passar do limite configurado (RF21) ou o custo médio por mensagem passar do valor de referência (RNF08).
- **R2** A equipe vê apenas metadados das mensagens (horário, tipo, situação, erro), nunca o texto, a transcrição, o áudio ou a imagem.
- **R3** Acesso ao conteúdo financeiro de um cliente só com autorização registrada do Dono (por exemplo, para suporte), por tempo limitado (24 horas), com registro de cada visualização na trilha de auditoria.

- **Obs1:** Atores: Administrador interno. Acesso com senha forte e segundo fator obrigatório, a partir de lista de e-mails autorizados.
- **Obs2:** Toda ação do painel interno é registrada (quem, quando, o quê, em qual empresa).

**Alteração:**

Conforme as ações administrativas listadas, sempre registradas.

**Exclusão:**

Não se aplica.

**Pesquisa:**

Busca de contas por nome, CNPJ ou final do celular do Dono.

**Critérios de aceite:**

- **CA01** – Dado um administrador interno, quando abre uma mensagem com falha, então vê horário, tipo e código do erro, sem o conteúdo.
- **CA02** – Dado um administrador sem autorização do Dono, quando tenta ver os lançamentos de uma empresa, então o acesso é negado.
- **CA03** – Dada uma empresa cujo custo de IA passou do limite, quando o processamento seguinte termina, então a equipe recebe o alerta.

# 4. Requisitos não funcionais

### RNF01 – Segurança de Acesso e Credenciais

**Prioridade:** Essencial · **Fase:** MVP · **Módulo:** Requisito não funcional

- **R1** Senhas armazenadas apenas como hash forte com sal (scrypt ou Argon2id); nunca em texto puro, nunca em logs, nunca enviadas por e-mail.
- **R2** Códigos de uso único com 6 dígitos, validade de 5 minutos, até 3 tentativas e limites de envio por e-mail e por IP (RF02).
- **R3** Sessão em cookie httpOnly, secure e sameSite=lax; expiração por inatividade (12 horas) ou 30 dias com "manter conectado".
- **R4** Toda comunicação com HTTPS (TLS 1.2 ou superior). Dados em repouso cifrados (banco, armazenamento de arquivos e backups).
- **R5** Comparações de segredos (assinatura do WhatsApp, tokens) em tempo constante. A assinatura de toda requisição recebida do WhatsApp é validada sobre os bytes recebidos; requisição sem assinatura válida é recusada.
- **R6** Segredos (chaves de API, senhas de banco, certificados) somente em variáveis de ambiente ou cofre de segredos, validados na inicialização; nunca no código nem no repositório.
- **R7** Arquivos de clientes (áudios, imagens, exportações) em armazenamento privado, acessados apenas por endereços assinados com validade de até 10 minutos (exportações: 1 hora).
- **R8** Cabeçalhos de segurança e política de conteúdo (CSP) no painel; textos vindos de mensagens são sempre exibidos como texto, nunca como HTML.
- **R9** Dependências verificadas automaticamente quanto a vulnerabilidades conhecidas, com atualização periódica.

**Critérios de aceite:**

- **CA01** – Dado o banco de dados, quando é inspecionado, então não contém senhas, códigos de acesso nem certificados em texto puro.
- **CA02** – Dada uma requisição ao recebimento do WhatsApp com 1 byte alterado no corpo, quando chega, então é recusada.

### RNF02 – Isolamento entre Empresas (multiempresa)

**Prioridade:** Essencial · **Fase:** MVP · **Módulo:** Requisito não funcional

- **R1** Toda tabela com dados de cliente tem a identificação da empresa e política de segurança em nível de linha (Row Level Security) no PostgreSQL, de modo que uma empresa nunca lê, altera ou insere dados de outra, mesmo com erro na aplicação.
- **R2** A aplicação conecta ao banco com um usuário sem permissão de ignorar essas políticas. Migrações e tarefas administrativas usam um usuário separado.
- **R3** Toda consulta da aplicação roda dentro de uma transação com a empresa definida de forma parametrizada.
- **R4** Referências entre tabelas usam chaves que incluem a empresa, impedindo que um lançamento aponte para unidade, fornecedor ou categoria de outra empresa.
- **R5** Um teste automatizado percorre todas as tabelas e falha se alguma tabela com dados de cliente estiver sem a política ligada.
- **R6** Nenhum dado de empresa é guardado em cache compartilhado do servidor; chaves de cache no navegador incluem empresa e unidade.
- **R7** A IA recebe apenas o contexto da empresa da mensagem.

**Critérios de aceite:**

- **CA01** – Dadas as empresas A e B, quando um usuário de A tenta, pela API, ler, alterar ou excluir um lançamento de B conhecendo o identificador, então a resposta é "não encontrado" e nada muda.
- **CA02** – Dada uma consulta executada sem empresa definida, quando roda, então não retorna nenhuma linha.

### RNF03 – Privacidade e LGPD

**Prioridade:** Essencial · **Fase:** MVP · **Módulo:** Requisito não funcional

- **R1** Papéis: o restaurante (empresa cliente) é o controlador dos dados; o produto é o operador. Isso consta dos Termos de Uso, da Política de Privacidade e do Acordo de Tratamento de Dados (DPA), aceitos no cadastro (RF01).
- **R2** Dados pessoais tratados: nome, celular e e-mail de colaboradores; CPF de fornecedores pessoa física; valores de salário (folha de pagamento); conteúdo de mensagens, áudios e imagens. Folha de pagamento é acessível só ao Dono e a quem ele autorizar (RF06).
- **R3** Minimização: a descrição dos lançamentos nunca guarda CPF, número de cartão ou de conta bancária (RF12, regra 3). O produto nunca pede esses dados pelo WhatsApp.
- **R4** Retenção: áudios por 90 dias (depois, só a transcrição); imagens de notas enquanto a conta existir; arquivos de exportação por 7 dias; dados da conta até 90 dias após o cancelamento, quando são eliminados ou anonimizados (RF37).
- **R5** Portabilidade: o Dono exporta todos os dados a qualquer momento (RF29).
- **R6** Provedores de IA e de transcrição contratados por API, configurados para não usar os dados para treinamento. Os dados de mensagens do WhatsApp não são usados para treinar ou melhorar modelos (política da Meta).
- **R7** Hospedagem preferencialmente no Brasil (região de São Paulo). Transferências internacionais (provedores de IA) cobertas por cláusulas contratuais e informadas na Política de Privacidade.
- **R8** Benchmarks entre restaurantes, se existirem no futuro, apenas com dados agregados e anonimizados e com consentimento explícito.
- **R9** Plano de resposta a incidentes documentado, com responsáveis pela comunicação à ANPD e aos clientes. Encarregado (DPO) definido entre os sócios.

**Critérios de aceite:**

- **CA01** – Dado um áudio recebido há 91 dias, quando o armazenamento é consultado, então o arquivo não existe mais e a transcrição sim.
- **CA02** – Dada a mensagem "paguei 300 ao João, CPF 123.456.789-09", quando é lançada, então a descrição não contém o CPF.

### RNF04 – Auditoria e Rastreabilidade

**Prioridade:** Essencial · **Fase:** MVP · **Módulo:** Requisito não funcional

- **R1** Nenhum lançamento é apagado fisicamente pelo cliente; exclusões são lógicas (lixeira).
- **R2** Toda criação, alteração, exclusão e restauração de lançamento gera uma versão imutável com quem, quando, canal e valores anteriores e novos (RF25). O usuário de banco da aplicação só pode inserir e ler versões, nunca alterar ou apagar.
- **R3** Todo lançamento guarda a origem (mensagem, áudio, imagem, arquivo importado ou e-mail).
- **R4** Trilha de auditoria imutável para ações sensíveis: login, bloqueios, troca de senha ou e-mail, mudança de papel e permissões, cadastro e desativação de colaboradores, exportações, alterações de taxas, importações e ações do painel interno.
- **R5** A trilha guarda data e hora, autor, ação, alvo e metadados (IP e dispositivo, quando aplicável), sem conteúdo de mensagens nem senhas.

**Critérios de aceite:**

- **CA01** – Dada a troca de papel de um colaborador, quando a trilha é consultada, então aparecem quem trocou, quando, o papel anterior e o novo.

### RNF05 – Desempenho e Tempo de Resposta

**Prioridade:** Essencial · **Fase:** MVP · **Módulo:** Requisito não funcional

- **R1** O recebimento de mensagens do WhatsApp responde em menos de 1 segundo em 99% dos casos, apenas validando, gravando e enfileirando.
- **R2** Tempo entre o envio da mensagem e a chegada da confirmação no WhatsApp (95% dos casos): texto até 15 segundos; áudio de até 60 segundos de duração até 30 segundos; foto até 30 segundos (sujeito à disponibilidade da SEFAZ).
- **R3** Painel em celular de gama média com 4G: maior conteúdo visível em até 2,5 segundos, resposta a interações em até 200 milissegundos e estabilidade visual (CLS) até 0,1.
- **R4** Consultas de lista e dashboard respondem em até 2 segundos para empresas com até 100 mil lançamentos.
- **R5** O processamento é assíncrono, com novas tentativas automáticas (até 5, com intervalo crescente) e fila de mensagens mortas para falhas definitivas, que geram aviso ao colaborador (RF19, regra 4).
- **R6** Reprocessar uma mensagem nunca duplica lançamentos nem confirmações.

**Critérios de aceite:**

- **CA01** – Dada uma rajada de 200 mensagens em 10 segundos, quando chegam, então todas recebem resposta do recebimento em menos de 1 segundo e são processadas sem perda.
- **CA02** – Dado o processo de trabalho interrompido no meio de uma mensagem, quando é reiniciado, então a mensagem é concluída sem duplicidade.

### RNF06 – Disponibilidade, Backup e Recuperação

**Prioridade:** Essencial · **Fase:** MVP · **Módulo:** Requisito não funcional

- **R1** Disponibilidade mensal alvo de 99,5% para o recebimento de mensagens e para o painel, excluídas manutenções programadas avisadas com 48 horas de antecedência.
- **R2** Mensagens recebidas durante uma indisponibilidade do processamento são processadas quando o serviço volta (a Meta reenvia por até 7 dias e o recebimento grava antes de processar).
- **R3** Backup diário do banco com recuperação para qualquer ponto no tempo dos últimos 7 dias. Perda máxima de dados (RPO) de 5 minutos e tempo máximo de recuperação (RTO) de 4 horas.
- **R4** Teste de restauração do backup pelo menos a cada 3 meses, com registro do resultado.
- **R5** Ambientes separados de desenvolvimento, homologação e produção, com números de WhatsApp diferentes.

**Critérios de aceite:**

- **CA01** – Dado o teste trimestral de restauração, quando é executado, então um banco restaurado a partir do backup sobe e os totais de uma empresa de referência coincidem com os de produção no instante escolhido.

### RNF07 – Qualidade da Interpretação por IA

**Prioridade:** Essencial · **Fase:** MVP · **Módulo:** Requisito não funcional

- **R1** Conjunto de avaliação versionado, com mensagens reais anonimizadas de texto, áudio e foto e o resultado esperado de cada uma, incluindo casos fáceis, ambíguos, com erros de digitação, com vários lançamentos e fora do escopo.
- **R2** Métricas medidas por campo (tipo, valor, quantidade, data, categoria, forma de pagamento, fornecedor, unidade) e por lançamento completo, além da precisão das perguntas de volta (perguntou quando devia e só quando devia) e da recusa correta de fora do escopo.
- **R3** Meta para o piloto: pelo menos 90% dos lançamentos sem necessidade de correção; valor e tipo corretos em pelo menos 98% dos lançamentos gravados.
- **R4** Toda mudança de instrução (prompt), de modelo ou de esquema de extração só é aceita se o conjunto de avaliação não piorar além da tolerância definida; a verificação roda automaticamente.
- **R5** Em produção, a taxa de lançamentos corrigidos ou desfeitos em até 24 horas é acompanhada como indicador real de precisão.

**Critérios de aceite:**

- **CA01** – Dada uma mudança de prompt que reduz a precisão de valor abaixo da tolerância, quando a verificação automática roda, então a mudança é bloqueada.

### RNF08 – Custo Operacional de IA e Mensagens

**Prioridade:** Importante · **Fase:** MVP · **Módulo:** Requisito não funcional

- **R1** Todo uso de IA (tokens de entrada e saída, leitura de cache, segundos de áudio, modelo e custo estimado) é registrado por empresa e por mensagem.
- **R2** Referência de custo variável: até US$ 5 por restaurante por mês no uso típico (cerca de 300 lançamentos, metade por áudio, 60 fotos e 30 consultas). O custo médio por mensagem é acompanhado no painel interno (RF38), com alerta acima do valor de referência.
- **R3** Uso do modelo mais barato por padrão e do modelo mais capaz apenas por sinais objetivos (saída inválida, mensagem longa, foto difícil), não pela "confiança" declarada pelo próprio modelo.
- **R4** Cache de instruções por empresa para reduzir custo (parte estável primeiro, mensagem e data depois).
- **R5** Mensagens iniciadas pelo produto usam a categoria de utilidade do WhatsApp; nunca a de marketing para avisos operacionais.

**Critérios de aceite:**

- **CA01** – Dado um mês de uso de uma empresa, quando o painel interno é consultado, então o custo total de IA da empresa é a soma dos registros individuais.

### RNF09 – Usabilidade, Acessibilidade e Idioma

**Prioridade:** Essencial · **Fase:** MVP · **Módulo:** Requisito não funcional

- **R1** Público com familiaridade tecnológica baixa a média: textos curtos, sem jargão técnico, em português do Brasil; o colaborador deve conseguir lançar pela primeira vez sem treinamento, apenas com a mensagem de ajuda.
- **R2** Painel projetado primeiro para o celular (o dono usa principalmente o celular; o contador, o computador), sem rolagem horizontal em larguras a partir de 360 pixels.
- **R3** Acessibilidade conforme WCAG 2.2 nível AA nas telas principais: contraste, navegação por teclado, textos alternativos, alvos de toque confortáveis e alternativa em tabela para todo gráfico.
- **R4** Moeda, números e datas no padrão brasileiro (R$ 1.234,56; 29/10/2026), fuso da unidade.
- **R5** Toda tela tem estados de carregando, vazio (com orientação) e erro (com opção de tentar de novo).

**Critérios de aceite:**

- **CA01** – Dada a verificação automática de acessibilidade nas telas principais, quando roda, então não há violações graves.

### RNF10 – Plataformas e Compatibilidade

**Prioridade:** Essencial · **Fase:** MVP · **Módulo:** Requisito não funcional

- **R1** Canal de lançamento: WhatsApp, por meio da API oficial (WhatsApp Business Cloud API da Meta). Não são usadas APIs não oficiais.
- **R2** Painel: aplicação web responsiva instalável no celular e no computador (PWA), com ícone na tela inicial, nas versões atuais de Chrome, Safari, Edge e Firefox e nos dois últimos anos de Android e iOS. Um aplicativo nativo de loja só será avaliado se houver demanda clara depois do piloto.
- **R3** Sem funcionamento offline: sem conexão, o painel exibe uma tela de aviso.
- **R4** E-mail: envio de códigos, convites e relatórios por serviço de e-mail transacional com domínio próprio autenticado (SPF, DKIM e DMARC).

**Critérios de aceite:**

- **CA01** – Dado um celular Android e um iPhone, quando o painel é aberto, então pode ser instalado na tela inicial e abre em tela cheia.

### RNF11 – Observabilidade e Registros (logs)

**Prioridade:** Importante · **Fase:** MVP · **Módulo:** Requisito não funcional

- **R1** Logs estruturados com identificador da mensagem, empresa, etapa e duração.
- **R2** Nunca são registrados em log: texto de mensagens, transcrições, CPF, valores de salário, senhas, códigos, tokens nem a query string do handshake do WhatsApp.
- **R3** Monitoramento de erros com alerta para a equipe; métricas de tempo de recebimento, tamanho da fila, falhas definitivas, tempo e custo da IA e falhas de envio do WhatsApp.

**Critérios de aceite:**

- **CA01** – Dado o processamento de uma mensagem com o texto "salário Maria 2.500", quando os logs são pesquisados por "Maria" e por "2.500", então nada é encontrado.

### RNF12 – Conformidade com a Política do WhatsApp Business

**Prioridade:** Essencial · **Fase:** MVP · **Módulo:** Requisito não funcional

- **R1** O assistente é de função específica (controle financeiro do restaurante); assuntos fora do escopo são recusados (RF19). A IA é auxiliar ao serviço, nunca um assistente de propósito geral.
- **R2** Consentimento (opt-in) registrado antes de qualquer mensagem iniciada pelo produto, com possibilidade de revogação ("parar").
- **R3** Saída para atendimento humano sempre disponível na ajuda e nas mensagens de erro.
- **R4** Mensagens iniciadas pelo produto fora da janela de 24 horas apenas com modelos aprovados.
- **R5** Nunca pedir nem divulgar números de cartão, conta financeira ou documentos de identidade.
- **R6** Perfil comercial com contato de suporte correto; número verificado da empresa; nome de exibição coerente com o produto.
- **R7** Revisão dos termos da Meta antes do piloto e a cada atualização relevante.

### RNF13 – Integridade de Valores Monetários e Datas

**Prioridade:** Essencial · **Fase:** MVP · **Módulo:** Requisito não funcional

- **R1** Valores monetários guardados e calculados em centavos inteiros; percentuais em pontos-base inteiros. Nunca é usado ponto flutuante em dinheiro, no servidor, no banco ou na tela.
- **R2** Arredondamento meio-para-cima, documentado e testado, aplicado apenas no cálculo de taxas.
- **R3** A IA nunca calcula valores: extrai números da mensagem; o sistema valida, calcula e grava. Somas, médias e comparações de relatórios são feitas pelo banco de dados.
- **R4** Datas de competência sem hora, tratadas como texto AAAA-MM-DD e exibidas no fuso da unidade, para nunca "voltarem um dia" por conversão de fuso.
- **R5** O banco garante, por restrição, que valor bruto é maior que zero, taxa está entre zero e o valor bruto e líquido = bruto − taxa.

**Critérios de aceite:**

- **CA01** – Dado um lançamento com data 01/11/2026, quando é exibido em qualquer tela às 23h no fuso de São Paulo, então aparece como 01/11/2026.

### RNF14 – Manutenibilidade e Testes

**Prioridade:** Importante · **Fase:** MVP · **Módulo:** Requisito não funcional

- **R1** Código em TypeScript estrito em todas as camadas; regras de negócio em módulo de domínio sem dependência de infraestrutura, testadas sem simulações (mocks).
- **R2** Testes de integração com PostgreSQL real; testes de ponta a ponta do canal (mensagem simulada até lançamento confirmado) e do painel (navegador, em tamanho de celular e de computador), incluindo a matriz de permissões por papel.
- **R3** Teste de reconciliação: todo total exibido no painel é comparado a uma consulta independente ao banco.
- **R4** Integração contínua executando formatação, verificação de tipos, testes e avaliação da IA quando o módulo de IA muda.
- **R5** Simulador de WhatsApp em terminal para desenvolvimento e testes sem depender da Meta.

# 5. Pendências e decisões em aberto

Itens que precisam de decisão antes ou durante o desenvolvimento dos requisitos indicados. A coluna "Proposta" registra o que este documento assume até a decisão.

| ID | Tema | O que decidir | Proposta deste documento | Resp. | Afeta |
|---|---|---|---|---|---|
| P01 | Plano de categorias | Lista definitiva de categorias e subcategorias, natureza e grupo do DRE; uma categoria "Vendas" com separação por canal no lugar de Salão/Delivery/Balcão. | Proposta do RF07, Obs2. | Matheus | RF07, RF27, RF28 |
| P02 | Investimento × despesa | Regra para separar investimento de despesa (valor mínimo, vida útil) e quando a IA deve perguntar. | Itens de equipamento e reforma como INVESTIMENTO; perguntar só acima de um valor a definir. | Matheus | RF07, RF12 |
| P03 | Planos e preços | Preços, limites de usuários, unidades e consultas por plano; duração do teste; preço de fundador. | Essencial e Profissional, R$ 99 a 199 por restaurante; teste de 14 dias; piloto de 60 a 90 dias. | Ambos | RF01, RF21, RF37 |
| P04 | Informações essenciais | Quais faltas geram pergunta antes de gravar (D6 do plano do canal). | Valor; quantidade de insumo; tipo não inferível; unidade inexistente ou ambígua (RF12, regra 17). | Matheus | RF12, RF15 |
| P05 | Impostos sobre faturamento | Como tratar impostos por regime (Simples na maioria) e se entram como dedução calculada ou lançada. | Lançados como despesa da categoria Impostos sobre faturamento, sem cálculo automático no MVP. | Matheus | RF27, RF28 |
| P06 | Taxa de canal × forma de pagamento | Se comissão do aplicativo e taxa do cartão se combinam. | Canal APLICATIVO com comissão substitui a taxa da forma de pagamento (RF09, regra 4). | Matheus | RF08, RF09 |
| P07 | Padrões de formas de pagamento e canais | Listas padrão e taxas típicas (crédito, débito, voucher, iFood, 99Food, Keeta). | Dinheiro, Pix, Débito, Crédito, Voucher; Salão, Delivery próprio, iFood, Retirada. | Matheus | RF08, RF09 |
| P08 | Textos do WhatsApp | Revisão de confirmação, ajuda, erros, recusas e avisos; contato de suporte real. | Textos-base deste documento e de messages.ts. | Matheus | RF11, RF16, RF19 |
| P09 | Indicadores do dono | Quais indicadores além de margem, CMV e folha (ticket médio exige número de vendas, hoje não coletado). | Margem, CMV % e folha % no MVP. | Matheus | [RF27](#rf27--dashboard-indicadores-e-gráficos) |
| P10 | Relatórios no MVP | Antecipar ou não os resumos predefinidos pelo WhatsApp para o MVP. | Antecipar "resumo de hoje/semana/mês" se couber no prazo; interpretação livre na v1.1. | Ambos | [RF20](#rf20--relatórios-e-consultas-pelo-whatsapp-por-hierarquia) |
| P11 | NF-e por certificado A1 | Viabilidade legal, custódia do certificado e frequência de consulta. | Implementar só após validação (RF32, Fase 2). | Matheus | [RF32](#rf32--captura-de-nf-e-pela-sefaz-com-certificado-digital) |
| P12 | Ajustes no plano do painel | Autocadastro (hoje disableSignUp: true), login por senha (hoje só código) e papel Contador. | Atualizar plano-dev-frontend.md (F1, F2, F6) e o core (papéis). | Luís | RF01, RF02, RF06 |
| P13 | Unidades de acesso | O schema atual permite uma unidade ou todas por vínculo; o RF05 pede uma lista de unidades. | Tabela de vínculo colaborador × unidade, mantendo "todas". | Luís | [RF05](#rf05--cadastro-de-colaboradores-e-números-de-whatsapp) |
| P14 | Revogação do opt-in e envio idempotente | Comando "parar" e prova de consentimento; não repetir confirmação em reprocessamento. | RF19 e RF16, Obs1. | Luís | RF16, RF19 |
| P15 | Desbloqueios da Meta | Publicar o app (P1) e resolver o erro 130497 (P2), número definitivo e verificação da empresa. | Seguir docs/plano-dev-canal-whatsapp.md, E10. | Luís e Matheus (CNPJ) | Todo o canal WhatsApp |

# Notas de conversão

## Inconsistências do `.docx` v1.0 (a resolver na próxima versão)

1. RF11.R3 diz que o PDF de nota fiscal é tratado "na Fase 2 (RF31)", mas o RF31 é da v1.1.
2. RF21.R2 chama 60 mensagens por usuário por hora e 1.000 por empresa por dia de "valores iniciais sugeridos". Adotados como padrão provisório, configurável por plano.
3. RF12.R8 usa uma "forma de cartão padrão da empresa" (padrão Crédito), mas o RF08 não lista esse campo de configuração.
4. Os nomes dos enums do documento (português, MAIÚSCULAS) diferem dos do código (inglês, minúsculas). Mapeamento: DONO = `owner`, GERENTE = `manager`, LANCADOR = `staff`, CONTADOR = `accountant` (futuro); DESPESA = `expense`, RECEITA = `revenue`; WHATSAPP = `whatsapp`, PAINEL = `web`, IMPORTACAO = `import`, SISTEMA = `system`, EMAIL (novo). As divergências do modelo de dados estão em [`arquitetura.md`](arquitetura.md).
