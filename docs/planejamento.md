# Planejamento do produto

> **Papel deste documento:** visão de **produto e de negócio**: problema, público, negócio, custos, validação e riscos. As regras detalhadas moram em [`requisitos.md`](requisitos.md) (o quê), as decisões em [`decisoes.md`](decisoes.md) (por quê) e a técnica em [`arquitetura.md`](arquitetura.md) (como). Aqui só há referências a elas.

Documento vivo. Itens marcados com **[PENDENTE]** apontam para uma pendência (P01 a P15) da seção 5 de `requisitos.md`; a lista das que cabem aos sócios está em `TODOLIST.md`.

## 1. Problema e proposta

**Problema.** Restaurantes pequenos e médios têm dificuldade em manter o controle financeiro: planilhas são trabalhosas de preencher, dependem de uma pessoa específica (dono ou contador) e muitas vezes simplesmente não existem. O resultado é que o dono não sabe quanto lucra nem para onde vai o dinheiro.

**Proposta.** Qualquer colaborador responsável por compras ou caixa registra gastos e receitas pelo WhatsApp, do jeito que falaria: texto, áudio ou foto da nota. A IA entende, registra no lugar certo e confirma. O dono acompanha tudo num painel com gráficos e pode perguntar sobre os números em linguagem natural.

**Diferenciais.**
- Praticidade extrema de lançamento (WhatsApp, que todos já usam).
- Funciona para quem já tem planilha (importação) e para quem não tem nada.
- Suporte próximo.
- Feito para colaborar com o contador, não substituí-lo.

**Escopo.** Controle **gerencial**. Não emite nem concilia notas fiscais, não apura impostos. O que fica fora está em `requisitos.md`, seção 1.3.

## 2. Público

**Cliente-alvo.** Restaurantes, bares e lanchonetes de pequeno e médio porte, com ou sem várias unidades. Familiaridade tecnológica baixa a média (usabilidade: RNF09).

**Quem usa.** Dono, gerente, lançador (compras, caixa, cozinha) e, na Fase 2, o contador. Uma conta (empresa) pode ter várias unidades e um usuário pode participar de várias contas. Papéis, permissões adicionais e a matriz de acesso: RF05, RF06 e `requisitos.md` seção 2.3. O perfil Contador pode cobrir vários clientes e virar canal de vendas por indicação (RF36, código de indicação no RF01).

## 3. O produto em linhas gerais

Cada item abaixo tem o seu requisito. Nada aqui define regra.

- **Entrada pelo WhatsApp** (núcleo do produto): texto, áudio e foto de nota, vários lançamentos por mensagem, salvando direto e confirmando sempre. RF11 a RF19, RF21.
- **Categorias** no formato de DRE gerencial simplificado, com subcategorias do dono e lista padrão: RF07. **[PENDENTE: P01, P02, P05, com o sócio contador.]**
- **Receitas**, canal de venda, forma de pagamento e taxas (bruto, taxa e líquido): RF08 e RF09. **[PENDENTE: P06, P07.]**
- **Fornecedores**, cadastro automático a partir dos lançamentos: RF10.
- **Recorrentes**: valor fixo lança sozinho, valor variável só aparece no fechamento como "ainda sem lançamento": RF33.
- **Painel** (PWA, sem modo offline): lista, edição, lixeira, origem e histórico, dashboard e exportação. RF22 a RF27, RF29, RNF10. Cadastro da empresa pelo próprio dono, com período de teste: RF01 e RF37.
- **Relatórios e IA**: dashboard e relatórios fixos no MVP; perguntas em linguagem natural (RF30, v1.1) e relatórios pelo WhatsApp por hierarquia (RF20, v1.1; resumos predefinidos podem vir antes, P10); resumo semanal e alertas por exceção (RF34); DRE e fechamento mensal em PDF (RF28). A IA escolhe consultas parametrizadas e o banco calcula (RNF13.R3).
- **Estoque** fora do escopo; futuro: precificação sugerida por prato.

Exemplos de mensagens esperadas **[PENDENTE: coletar 20 a 50 reais no teste piloto, para os evals; ver `TODOLIST.md`]**: ver os critérios de aceite do RF12 a RF14.

## 4. Integrações por fase

| Fase | Integração | Requisito |
|---|---|---|
| MVP | WhatsApp (Cloud API oficial); QR Code da NFC-e com leitura por IA como reserva; exportação Excel/CSV; e-mail transacional | RF11 a RF19, RF14, RF29, RNF10 |
| v1.1 | Captura de NF-e por e-mail (XML); importação de planilhas, extrato OFX/CSV e relatórios de PDV e iFood; resumo semanal e alertas; DRE em PDF | RF31, RF35, RF34, RF28 |
| Fase 2 | Captura de NF-e pela SEFAZ com certificado A1 **[validar com o contador: P11]**; perfil Contador multicliente; Open Finance via agregador (Pluggy, Belvo); API do iFood | RF32, RF36 |
| Fase 3 | PDVs mais usados pelos clientes; exportação no formato de sistemas contábeis | a detalhar |

Hoje, em restaurantes pequenos e médios, o preenchimento é quase sempre manual. Essa é a dor central.

## 5. Fiscal, legal e segurança

- **Fiscal:** apenas controle gerencial.
- **Contador do cliente:** perfil Contador (leitura e exportação, Fase 2) e exportações padrão: Excel/CSV com todos os lançamentos (RF29), DRE gerencial mensal em PDF (RF28) e pacote mensal com as notas organizadas (RF29.Obs2).
- **LGPD e propriedade dos dados:** o restaurante é o **controlador**; nós somos **operadores**, o que consta nos Termos de Uso e no DPA aceitos no cadastro (RF01.R13). O cliente exporta tudo a qualquer momento, e depois do cancelamento os dados ficam disponíveis por 90 dias antes de serem eliminados (RF37, RNF03). Benchmarks anonimizados só com consentimento explícito. Dados pessoais tratados: telefones de colaboradores, CPFs em notas, salários (o mais sensível, só o dono por padrão). Detalhe: RNF03.
- **Segurança, auditoria e backup:** RNF01 (acesso e credenciais), RNF02 (isolamento entre empresas), RNF04 (auditoria e lixeira), RNF06 (backup, recuperação e ambientes). O texto jurídico (Termos, Política, DPA) vem do advogado.
- **Política do WhatsApp:** RNF12 e [`politica-meta-whatsapp.md`](politica-meta-whatsapp.md).

## 6. Negócio

**Monetização:** assinatura por restaurante, com custo de IA embutido.
- Planos por porte (ex.: Essencial e Profissional), desconto por unidade adicional. **[PENDENTE: P03, preços e limites; faixa estimada R$ 99 a 199/mês]**
- Limites técnicos discretos contra abuso e cota generosa de consultas de relatório com aviso: RF21.
- Roteamento de modelos: o mais barato para lançamentos simples, o mais capaz só quando necessário (RNF08.R3).
- Ciclo de vida da conta (teste, plano, encerramento): RF37.

**Custos estimados (outubro de 2026):**
- Variável: ~US$ 3 a 5 por restaurante/mês (WhatsApp de serviço é gratuito dentro da janela de 24 h; utilidade ~R$ 0,035 por mensagem; transcrição US$ 0,003–0,006/min; modelos pequenos custam centavos). Referência de acompanhamento: RNF08.R2.
- Fixo inicial: ~R$ 200 a 950/mês (infra, provedor, domínio, monitoramento).
- Abertura: CNPJ, termos e política de privacidade com advogado, identidade visual: R$ 3 a 10 mil.
- Desenvolvimento: feito pelos sócios.

**Responsáveis:** produto, testes com usuários, suporte, vendas e marketing: os dois sócios.

**Métricas de sucesso (iniciais):**
- Precisão: % de lançamentos sem correção (meta > 90%; RNF07.R3).
- Uso: restaurantes que lançam em pelo menos 4 dias por semana.
- Retenção em 30, 60 e 90 dias.
- Valor percebido: uso de relatórios e perguntas por mês.
- Negócio: clientes pagantes, churn, custo de IA por restaurante.

## 7. Validação

1. Entrevistas com conhecidos do ramo: como controlam hoje, quanto pagariam.
2. Teste "mágico de Oz" (2 a 4 semanas, 2 ou 3 restaurantes): número de WhatsApp operado manualmente com ajuda de IA. Objetivo: confirmar que eles enviam os gastos no dia a dia e coletar exemplos reais de mensagens.
3. Piloto do MVP com 5 a 10 restaurantes, gratuito por 60 a 90 dias, depois preço de fundador (RF37, plano FUNDADOR).

## 8. Riscos

- **Política do WhatsApp:** a Meta restringe chatbots de IA de uso geral na API. Nosso bot é de função específica (RNF12), mas as regras precisam ser confirmadas antes de construir.
- **Consulta da NFC-e:** cada SEFAZ estadual tem página própria; o parsing varia por estado e pode quebrar. Começar pelos estados dos pilotos (RF14.R5).
- **Precisão da transcrição** em ambiente barulhento (RF13, RNF07).
- **Adoção:** o maior risco é o colaborador não criar o hábito de enviar. Validar cedo.
- **Custo por mensagem** crescendo com uso intenso: monitorar desde o dia 1 (RNF08, RF38).
- **Liberação da Meta** (app não publicado e erro 130497, pendência P15): o desenvolvimento segue pelo chat de terminal até a E10.

## 9. Pendências com o sócio contador

As decisões que cabem ao Matheus estão na seção 5 de `requisitos.md` (P01 a P11). Até a decisão final vale a proposta do documento, marcada `[PROVISÓRIO – Pxx]`; nenhuma bloqueia as etapas de desenvolvimento. Acompanhamento e responsáveis: `TODOLIST.md`.
