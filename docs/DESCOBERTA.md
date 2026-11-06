# Descoberta do produto (05/11/2026)

> **Papel deste documento:** registra o resultado da reunião de descoberta entre o Matheus (contador, idealizador) e o Luís (desenvolvedor). Resume o que foi decidido, o que continua aberto e o escopo do MVP. A regra de negócio continua em [`requisitos.md`](requisitos.md) (versão 1.1) e o porquê em [`decisoes.md`](decisoes.md) (seção 5, DD-01 a DD-16).

Contexto: o repositório já tinha requisitos v1.0 e decisões registradas. A reunião não partiu do zero: confirmou o que estava fechado e mudou o que os sócios quiseram mudar. Roteiro-base: seção 0.1 de `planos/guia/contabilidade-restaurante-plano-do-zero.md`.

## 1. Confirmado sem mudança

| Tema | Resultado |
|---|---|
| Modelo contábil | Receitas e despesas por categoria com grupo do DRE. Sem partidas dobradas (DD-01) |
| Correção de lançamento | Edição com histórico em `entry_versions` e lixeira de 30 dias. Sem estorno (DD-01) |
| Papéis | DONO, GERENTE, LANCADOR e CONTADOR, mais as quatro permissões adicionais (DD-01) |
| Exportação | XLSX e CSV, como no RF29 (DD-01) |
| Áudio e foto de cupom | No MVP, como já estava |
| Retenção | 90 dias após o cancelamento, com aviso e exportação completa antes. Os Termos dizem que a guarda fiscal de 5 anos é do contador (DD-06) |
| Quem paga | O restaurante. O contador usa de graça e entra por indicação. Números de P03 seguem provisórios (DD-07) |
| P06 e P07 | Seguem provisórias; o Matheus decide depois do piloto (DD-15) |

## 2. Decisões novas ou mudadas

Cada linha diz qual documento precisou mudar. Todas já foram aplicadas (ver seção 6).

| ID | Mudança | Contradiz | Arquivos atualizados |
|---|---|---|---|
| DD-02 | **Data de pagamento (`paid_on`)** opcional no MVP, padrão igual à data do lançamento. Contas a pagar e fluxo de caixa na v1.1 | RF12.R2 e glossário (só competência); `escopo-por-fase.md` | `decisoes.md`, `requisitos.md` (RF12.R21), `arquitetura.md`, `escopo-por-fase.md`, planos |
| DD-03 | **Contador com login no MVP**, leitura e exportação, multicliente. Resumo por empresa na v1.1 | RF36 e RF29.Obs1 (Fase 2); DN-04 | `decisoes.md`, `requisitos.md` (RF06, RF36, matriz 2.3), `escopo-por-fase.md`, planos, `CLAUDE.md`, `produto.md` |
| DD-04 | **Contador sempre vê folha**, com aviso e aceite do dono na auditoria | RF06.R3, RNF03.R2 | `decisoes.md`, `requisitos.md` (RF06, matriz, RNF03), `arquitetura.md` |
| DD-05 | **Imposto estimado opcional**, todos os regimes (MEI, Simples, Presumido, Real), regras em tabela versionada por vigência (reforma de 2027 em diante) | RF27.R3, P05, "não apura imposto" | `decisoes.md`, `requisitos.md` (RF01.R5, RF27, novo RF39, P05, P16, P17), `produto.md`, `CLAUDE.md`, `arquitetura.md`, planos |
| DD-08 | **Receita sempre com canal.** Sem canal na mensagem: canal padrão da unidade e sinal `CANAL_A_REVISAR`. Categoria única "Vendas" | RF09.Obs3 e CA03, RF12.R9, RF27.R6 (aceitavam "Não informado") | `decisoes.md`, `requisitos.md` (RF04.R6, RF09, RF12, RF27), `arquitetura.md` |
| DD-09 | **Investimento × despesa:** a IA pergunta acima de R$ 1.500 (fecha P02) | RF07.R3 (provisório) | `decisoes.md`, `requisitos.md` (RF07, RF12.R23, P02) |
| DD-10 | **OFX e planilha (RF35) no MVP.** NF-e sem captura por e-mail: XML enviado manualmente, pelo painel e pelo WhatsApp (RF31 reformulado) | RF31 (v1.1, por e-mail), RF35 (v1.1), DN-06 | `decisoes.md`, `requisitos.md` (RF31, RF35, P18), `escopo-por-fase.md`, `arquitetura.md`, planos, `produto.md` |
| DD-11 | **DRE na tela no MVP;** PDF e fluxo de caixa na v1.1 | RF28 (v1.1), D-F6 | `decisoes.md`, `requisitos.md` (RF28), `escopo-por-fase.md`, planos |
| DD-12 | **Resumos fixos de hoje, semana e mês** pelo WhatsApp no MVP (fecha P10) | RF20 (v1.1) | `decisoes.md`, `requisitos.md` (RF20, P10), `escopo-por-fase.md`, planos |
| DD-13 | **Ticket médio** (campo opcional "pedidos"), **ponto de equilíbrio** (Natureza FIXA/VARIAVEL do RF07.R4) e **imposto estimado %** no dashboard (fecha P09) | RF27.Obs5 | `decisoes.md`, `requisitos.md` (RF12.R22, RF27.R7 a R9, P09), `planos` |
| DD-14 | **Tolerância zero** de centavo na conciliação | Proposta de 1 centavo do DE-01 | `decisoes.md`, `requisitos.md` (referência) |
| DD-16 | O Luís confirmou que o prazo comporta tudo antes do piloto | — | `decisoes.md` |

## 3. Pendências que continuam abertas

| ID | Assunto | Responsável | Observação |
|---|---|---|---|
| P01 | Lista definitiva de categorias, com a Natureza FIXA/VARIAVEL de cada uma | Matheus | Vale a lista do seed até lá |
| P03 | Planos, preços, limites e duração do teste | Os dois | Provisório; decidir com o custo de IA do piloto |
| P04 | Informações essenciais | Matheus | Agora também canal de receita, pedidos e a pergunta de investimento |
| P06, P07 | Taxa de canal × forma de pagamento; listas padrão | Matheus | Mantidas provisórias (DD-15) |
| P08 | Textos do WhatsApp e contato de suporte | Matheus | Provisório |
| P11 | NF-e por certificado A1 (RF32, Fase 2) | Matheus | Só depois da validação legal |
| **P16** | **Imposto estimado: parâmetros e fórmulas de cada regime, aviso, e se a estimativa entra no Resultado** | Matheus | **Nova.** Hoje a estimativa é só informativa |
| **P17** | **Reforma tributária: datas e alíquotas de CBS e IBS e efeito em cada regime** | Matheus | **Nova.** As datas do texto vêm de memória e precisam de confirmação |
| **P18** | **XML manual: quem envia, CNPJ de destinatário diferente, nota de entrada × saída** | Matheus | **Nova** |
| P12 | Ajustes do plano do painel (autocadastro, senha, papel Contador) | Luís | Falta implementar na F1, F2 e F6 |
| P13 | Unidades de acesso em lista | Luís | E11 |
| P14 | Revogação do opt-in (`parar`) | Luís | E10 |
| P15 | Desbloqueios da Meta | Luís e Matheus (CNPJ) | Trava a E10 |

Fechadas nesta reunião: **P02, P05, P09, P10**.

## 4. Escopo do MVP

**Entra:**

- Lançamento pelo WhatsApp por texto, áudio e foto de cupom, com data de pagamento opcional, pedidos opcionais, canal padrão e pergunta de investimento acima de R$ 1.500.
- Resumos fixos de hoje, semana e mês pelo WhatsApp, pela hierarquia.
- Painel (PWA): lançamentos editáveis, lixeira de 30 dias, origem e histórico, dashboard (margem, CMV %, folha %, ticket médio, ponto de equilíbrio, imposto estimado) e DRE na tela.
- Imposto estimado opcional por restaurante, para os quatro regimes, com aviso de estimativa.
- Contador com login: leitura, exportação e lista de empresas; vê folha após o aviso ao dono.
- Importação de planilha, OFX e relatórios de vendas, com tolerância zero de centavo.
- Envio manual do XML da NF-e, pelo painel e pelo WhatsApp.
- Exportação XLSX e CSV, assinatura, painel interno e autocadastro do dono.

**Fica de fora (v1.1):** consultas livres pelo WhatsApp e perguntas em linguagem natural (RF20 e RF30), lançamento manual no painel (RF26), PDF do fechamento mensal, contas a pagar e fluxo de caixa, recorrentes (RF33), resumo semanal e alertas (RF34), resumo por empresa na tela do contador, pacote mensal do contador, código por WhatsApp e segundo fator.

**Fica de fora (Fase 2 ou depois):** SEFAZ com certificado A1 (RF32), Open Finance, API do iFood, precificação por prato, app nativo.

**Nunca:** emitir nota, apurar imposto ou gerar guia de pagamento; captura automática de NF-e por e-mail (decisão do Matheus).

## 5. Riscos assumidos

- **Prazo:** o MVP cresceu em cinco frentes (imposto, contador, importações, XML, indicadores). O Luís confirmou que o prazo comporta; se apertar, o primeiro corte sugerido é Lucro Presumido e Real no imposto estimado, depois OFX e planilha (DD-16).
- **Imposto de todos os regimes:** cada regime precisa de fórmulas validadas pelo Matheus (P16, P17). Como todos foram liberados no MVP com aviso, qualquer regra errada chega ao cliente como estimativa errada. A tabela por vigência e os testes por regime reduzem o risco, não o eliminam.
- **Folha para o contador (LGPD):** o dono é avisado no convite e o aceite fica na auditoria. A revogação deve ser imediata.
- **Pedidos e ticket médio:** só medem a parte da receita com "pedidos" informado; a tela mostra a cobertura da base.

## 6. Arquivos atualizados nesta rodada

`decisoes.md` (seção 5 nova, DE-01, DN-04, DN-06), `requisitos.md` (versão 1.1, RF39 novo, P16 a P18), `escopo-por-fase.md`, `arquitetura.md` (divergências), `produto.md`, `README.md` e `CLAUDE.md` (contagens e estado), `planos/canal-whatsapp.md` (E11 ampliada, E12, E13, E14 nova), `planos/painel.md` (F2, F4, F6, F12 e F13 novas), `planos/andamento.md`.

## 7. Próximos passos

1. O Matheus responde P16, P17 e P18 e revisa P01 e P04.
2. O Luís começa a **E11** (modelo de dados ampliado) e a **F0** em paralelo.
3. Rodar `pnpm typecheck && pnpm lint && pnpm test` ao abrir a E11; nesta rodada só a documentação mudou.
4. Quando os sócios pedirem, gerar o `.docx` v1.1 a partir de `requisitos.md` com pandoc.
