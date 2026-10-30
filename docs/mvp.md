# Escopo por fase

> **Papel deste documento:** diz **o que entra em cada fase**, organizado por requisito (RF). Não repete regra: a regra de cada item está em [`requisitos.md`](requisitos.md). A ordem de execução e as etapas estão nos planos [`plano-dev-canal-whatsapp.md`](plano-dev-canal-whatsapp.md) (E1 a E13) e [`plano-dev-frontend.md`](plano-dev-frontend.md) (F0 a F10).

**Objetivo da v1 (MVP):** lançamento pelo WhatsApp 100% funcional e um painel web (PWA) com lançamentos editáveis, gráficos simples e exportação. Tudo o que não está marcado MVP fica para a v1.1 ou a Fase 2.

Legenda: `[x]` feito · `[~]` feito em parte (a nota diz o que falta) · `[ ]` a fazer. Fases: **MVP** (primeira versão, usada no piloto), **v1.1** (logo depois), **Fase 2** (depende de validação ou integração externa). Etapas: E = canal WhatsApp, F = painel.

Atualizado em 29/10/2026.

## Fundação (Fase 0)

- [x] Monorepo pnpm + Turborepo (`apps/api`, `apps/web`, `packages/{db,core,ai,whatsapp,config}`)
- [x] TypeScript strict, Biome, Vitest configurados na raiz
- [x] `packages/config/env`: validação de variáveis de ambiente com Zod (RNF01.R6)
- [x] Docker Compose com Postgres 16 para desenvolvimento
- [ ] CI no GitHub Actions: lint, typecheck, testes (workflow escrito; falta rodar no GitHub)
- [x] `.env.example` completo

## MVP, por requisito

### Conta e acesso

- [ ] **RF01** Cadastro de empresa (autocadastro do dono, período de teste): F1
- [ ] **RF02** Autenticação e sessão (senha ou código): F1; seleção de empresa e unidade: F2
- [ ] **RF03** Recuperação de acesso: F1
- [ ] **RF04** Cadastro de unidades (apelidos, status): dados em E11, tela em F6
- [~] **RF05** Colaboradores e números de WhatsApp: vínculo por telefone, desativação e opt-in na primeira mensagem existem (E2, E5); faltam lista de unidades de acesso, unidade padrão, permissões adicionais e a tela (E11, F6)
- [~] **RF06** Papéis, hierarquia e permissões: `can()` com owner, manager e staff existe (E1); faltam as permissões adicionais, a matriz como teste e o filtro na API (E11, F2)

### Cadastros de apoio

- [~] **RF07** Plano de categorias: categorias padrão provisórias no seed (E2); faltam Exige Quantidade, palavras de apoio, status, subcategorias da empresa (E11, F6) **[PROVISÓRIO – P01, P02, P05]**
- [~] **RF08** Formas de pagamento e taxas: tabela e cálculo de taxa e líquido existem (E1, E2); faltam tipo, apelidos, status, cartão padrão e a tela (E6, F6) **[PROVISÓRIO – P07]**
- [~] **RF09** Canais de venda e comissões: tabela existe (E2); falta tipo, apelidos, a regra APLICATIVO × forma de pagamento e a tela (E7, F6) **[PROVISÓRIO – P06, P07]**
- [ ] **RF10** Fornecedores (criação automática, mesclagem): E7, F6

### Canal WhatsApp

- [~] **RF11** Identificação do remetente e consentimento: webhook, assinatura, idempotência, identificação por telefone, resposta a desconhecido, opt-in e roteamento (E3 a E5); faltam atribuição por empresa citada no texto e janela de 24 h (E7, E10). O teste com mensagem real depende de P15
- [ ] **RF12** Lançamento por mensagem de texto: extração (E6) e gravação (E7)
- [ ] **RF13** Lançamento por áudio: E9
- [ ] **RF14** Lançamento por foto de cupom ou nota (QR Code da NFC-e primeiro): E9
- [ ] **RF15** Pergunta de volta: E6 (rascunho) e E7
- [ ] **RF16** Confirmação do lançamento (envio idempotente): E7
- [ ] **RF17** Correção por resposta (reply): E7
- [ ] **RF18** Desfazer lançamento: E7 (a E5 tem só uma resposta provisória)
- [~] **RF19** Comandos, ajuda, suporte e fora do escopo: `ajuda`, tipo não suportado e recusa de remetente existem (E5); faltam `cancelar`, `trocar unidade`, `trocar empresa`, `suporte` (E7) e `parar` e `voltar` (E10) **[PROVISÓRIO – P08]**
- [ ] **RF21** Limites de uso e proteção contra abuso: limites de mídia em E9, mensagens por hora e por dia e cota mensal em E10 **[PROVISÓRIO – P03]**
- [ ] **RNF07** Evals de qualidade da IA com meta de acerto: E8
- [~] Chat de desenvolvimento no terminal (`pnpm dev:chat`): texto, `/como` e `/sair` existem (E5); `/reply` e `/custo` (E7), `/audio` e `/foto` (E9)

### Painel

- [ ] **RF22** Lista e pesquisa de lançamentos: F3
- [ ] **RF23** Edição de lançamento: F3
- [ ] **RF24** Lixeira de 30 dias: F3
- [ ] **RF25** Ver origem e histórico de versões: F3
- [ ] **RF27** Dashboard (indicadores e gráficos): F4 **[PROVISÓRIO – P05, P09]**
- [ ] **RF29** Exportação em XLSX e CSV: F5
- [ ] **RNF10** Layout responsivo e manifest PWA: F7

### Assinatura e operação

- [ ] **RF37** Assinatura, plano, período de teste e encerramento da conta: F9 **[PROVISÓRIO – P03]**
- [ ] **RF38** Painel interno de operação (custo de IA por empresa, saúde da fila, suporte): F10

### Pronto para piloto (transversal)

- [ ] Termos de Uso e Política de Privacidade publicados, aceite registrado (RF01.R13, RNF03)
- [ ] Sentry e logs estruturados sem PII (RNF11)
- [ ] Backup verificado com teste de restauração (RNF06)
- [ ] Deploy em staging e produção (E10, F8)
- [ ] **Ligar o WhatsApp real, só aqui no fim:** publicar o app da Meta, resolver o envio (erro 130497), número definitivo, `CHANNEL_MODE=whatsapp` e repetir pelo celular o roteiro do chat de dev (E10, pendência P15)

## v1.1

- [ ] **RF20** Relatórios e consultas pelo WhatsApp, por hierarquia: E12. Resumos predefinidos podem ser antecipados para o MVP **[PROVISÓRIO – P10]**
- [ ] **RF26** Lançamento manual no painel
- [ ] **RF28** DRE gerencial e fechamento mensal em PDF
- [ ] **RF30** Perguntas em linguagem natural sobre os dados (painel)
- [ ] **RF31** Captura de NF-e por e-mail: E13
- [ ] **RF33** Lançamentos recorrentes: E13
- [ ] **RF34** Resumo semanal e alertas por exceção: E13
- [ ] **RF35** Importação de planilhas, extratos e relatórios de vendas: E13
- [ ] Código de acesso por WhatsApp e segundo fator para o dono (RF02)

## Fase 2

- [ ] **RF32** Captura de NF-e pela SEFAZ com certificado A1 (só após validar P11)
- [ ] **RF36** Acesso do contador (multicliente) e papel CONTADOR
- [ ] Open Finance, API do iFood
- [ ] Precificação sugerida por prato

## Agrupamento histórico por fase de execução

Antes dos requisitos, o trabalho era dividido em fases numeradas. A tabela liga cada uma às etapas dos planos.

| Fase | Tema | Etapas |
|---|---|---|
| 0 | Fundação | feita (falta só rodar o CI) |
| 1 | Domínio e banco | E1, E2 (feitas); ajustes em E11 |
| 2 | WhatsApp: recebimento e texto | E3 a E5 (feitas), E6 a E8 |
| 3 | Áudio e foto | E9 |
| 4 | Painel web | F0 a F8 |
| 5 | Pronto para piloto | E10, F8, F9, F10 |
