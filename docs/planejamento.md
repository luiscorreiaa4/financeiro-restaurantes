# Planejamento do produto

Documento vivo. Consolida as decisões de produto tomadas na fase de planejamento.
Itens marcados com **[PENDENTE]** ainda precisam de definição.

## 1. Problema e proposta

**Problema.** Restaurantes pequenos e médios têm dificuldade em manter o controle financeiro: planilhas são trabalhosas de preencher, dependem de uma pessoa específica (dono ou contador) e muitas vezes simplesmente não existem. O resultado é que o dono não sabe quanto lucra nem para onde vai o dinheiro.

**Proposta.** Qualquer colaborador responsável por compras ou caixa registra gastos e receitas pelo WhatsApp, do jeito que falaria: texto, áudio ou foto da nota. A IA entende, registra no lugar certo e confirma. O dono acompanha tudo num painel com gráficos e pode perguntar sobre os números em linguagem natural.

**Diferenciais.**
- Praticidade extrema de lançamento (WhatsApp, que todos já usam).
- Funciona para quem já tem planilha (importação) e para quem não tem nada.
- Suporte próximo.
- Feito para colaborar com o contador, não substituí-lo.

**Cliente-alvo.** Restaurantes, bares e lanchonetes de pequeno e médio porte, com ou sem várias unidades. Familiaridade tecnológica baixa a média.

**Escopo.** Controle **gerencial**. Não emite nem concilia notas fiscais, não apura impostos.

## 2. Usuários e permissões

Uma **conta** (tenant) pode ter várias **unidades** (restaurantes). Um usuário pode participar de várias contas e unidades, com papel por unidade.

| Papel | Lança | Vê relatórios e totais | Vê folha de pagamento | Edita lançamentos de outros | Configura |
|---|---|---|---|---|---|
| Dono | sim | sim | sim | sim | sim |
| Gerente | sim | sim | não (padrão) | sim | parcial |
| Lançador | sim | só os próprios lançamentos | não | não | não |
| Contador | não | sim (leitura e exportação) | configurável | não | não |

- O dono ajusta as permissões.
- O vínculo WhatsApp ↔ usuário é pelo número de telefone, cadastrado pelo dono ou gerente.
- Se o usuário tem acesso a mais de uma unidade e não diz qual, a IA usa a unidade padrão dele ou pergunta.
- O perfil Contador pode cobrir vários clientes. Isso pode virar canal de vendas (contadores indicando a carteira).

## 3. Entrada de dados pelo WhatsApp (núcleo do produto)

**Canais de entrada:** texto, áudio e foto (NFC-e via QR Code, com OCR como reserva para notas sem QR e recibos manuscritos).

**Regras:**
- Uma mensagem pode conter **vários lançamentos** (ex.: insumo recorrente e um investimento na mesma nota).
- **Obrigatório:** valor sempre; quantidade apenas para insumos.
- **Presumido pela IA e exibido na confirmação:** data (hoje, se não dita), categoria, fornecedor, forma de pagamento, unidade.
- **Salva direto**, com correção posterior fácil.
- Na dúvida sobre algo essencial (valor ilegível, unidade ambígua), **pergunta antes** de salvar.
- Ambiente barulhento é esperado: transcrição precisa ser testada com áudios reais de cozinha.
- Limites de uso: áudio de até ~3 minutos (acima disso, pedir para dividir), limite de mensagens por hora por usuário.

**Confirmação padrão:**
```
✅ Registrado (Restaurante Centro):
1. Camarão 5 kg — R$ 450,00 — Insumos — hoje — Pix
2. Freezer horizontal — R$ 3.200,00 — Investimento — hoje — Cartão crédito

Para ajustar, responda esta mensagem dizendo o que mudar.
"desfazer" apaga o último registro.
```

**Correção:**
- Responder (reply) à confirmação com a correção em linguagem natural: "o camarão foi 400".
- "desfazer" remove o último lançamento daquele usuário (vai para a lixeira, recuperável).
- No painel: edição completa, com "ver origem" mostrando o áudio, a foto ou o texto original.

**Exemplos de mensagens esperadas** **[PENDENTE: coletar 20 a 50 reais no teste piloto]**:
- "camarão 1kg 80 reais"
- "paguei a luz 1.230 no pix"
- "vendas de hoje 3.450, 1.200 no cartão, resto pix"
- (áudio) "comprei no atacadão 2 caixas de óleo 180, 10 kg de arroz 62 e detergente 25"
- (foto) cupom fiscal de supermercado

## 4. Categorias e tipos de gasto

**[PENDENTE: plano de categorias com o sócio contador.]** Proposta inicial, baseada em DRE gerencial simplificada:

- **Receitas:** vendas (por canal), outras receitas.
- **Deduções:** impostos sobre faturamento, taxas de cartão, comissões de apps de delivery.
- **CMV / Insumos:** alimentos, bebidas, embalagens, descartáveis.
- **Pessoal:** salários, encargos, benefícios, pró-labore, extras/freelas.
- **Ocupação:** aluguel, condomínio, IPTU.
- **Utilidades:** energia, água, gás, internet, telefone.
- **Operacionais:** limpeza, manutenção, sistemas e assinaturas, contabilidade.
- **Marketing.**
- **Financeiras:** juros, tarifas bancárias.
- **Investimentos (não entram como despesa no resultado):** equipamentos, reformas.

O dono pode criar **subcategorias** dentro das padrão, mas não alterar a estrutura principal (para os relatórios continuarem comparáveis).

**Classificação:** fixo, variável e investimento são atributos da categoria. A IA classifica e pergunta quando estiver em dúvida.

**Recorrentes:**
- Valor idêntico todo mês (aluguel, assinatura de sistema): lançamento automático, opcional.
- Valor variável (luz, água, gás): não lança e não lembra ativamente; aparece no fechamento como "ainda sem lançamento neste mês".

**Estoque:** fora do escopo atual (apenas valor financeiro). Futuro: precificação sugerida por prato.

**Fornecedores:** cadastro automático a partir dos lançamentos; análise de histórico de preços sob pedido à IA.

## 5. Receitas

- Lançadas por WhatsApp ou importadas (relatórios de PDV, iFood, extrato).
- **Canal de venda** (opcional): salão, delivery próprio, apps de delivery, retirada. Padrão "não informado".
- **Forma de pagamento** (opcional): dinheiro, Pix, débito, crédito, voucher/VR.
- **Taxas:** configuradas uma vez por forma de pagamento e app (ex.: crédito 3,2%, iFood 23%). O sistema guarda **bruto, taxa e líquido**.

## 6. Relatórios e IA

**Relatórios fixos do MVP:** receita × despesa, despesas por categoria, evolução mensal, resultado do mês.

**Perguntas em linguagem natural (v1.1):** "quanto gastei com bebidas em setembro comparado com agosto?". A IA escolhe ferramentas de consulta parametrizadas; o banco calcula. A IA nunca soma de cabeça.

**Insights proativos (pós-MVP):** poucos e relevantes.
- Resumo semanal no WhatsApp (segunda de manhã): faturamento, gastos, resultado e comparação, em 5 ou 6 linhas.
- Alertas por exceção: insumo com alta forte de preço, categoria muito acima do padrão, queda de margem, peso crescente dos apps de delivery.
- Fechamento mensal em PDF para dono e contador.
- Configurável por usuário.

**Canais de relatório:** painel, WhatsApp, e-mail e PDF, conforme solicitado.

**Precisão:** todo registro tem feedback claro; erros devem ser fáceis de achar e corrigir.

## 7. Plataformas

- **WhatsApp** (Cloud API oficial da Meta): canal principal de lançamento.
- **Painel web** responsivo (desktop e celular), instalável como PWA.
- Sem modo offline.
- App nativo: só se houver demanda clara depois.

## 8. Integrações

| Fase | Integração |
|---|---|
| MVP | WhatsApp; QR Code da NFC-e; OCR; exportação Excel/CSV |
| v1.x | Importação de planilhas existentes (IA mapeia colunas); extrato OFX/CSV; relatórios de PDV e iFood |
| Fase 2 | Captura automática de NF-e emitidas contra o CNPJ (certificado A1) **[validar com contador]**; Open Finance via agregador (Pluggy, Belvo); API do iFood |
| Fase 3 | PDVs mais usados pelos clientes; exportação no formato de sistemas contábeis |

Hoje, em restaurantes pequenos e médios, o preenchimento é quase sempre manual. Essa é a dor central.

## 9. Fiscal, legal e segurança

**Fiscal:** apenas controle gerencial.

**Contador do cliente:** perfil Contador (leitura e exportação) e exportações padrão: Excel/CSV com todos os lançamentos, DRE gerencial mensal em PDF, pacote mensal com as notas organizadas.

**LGPD e propriedade dos dados:**
- O restaurante é o **controlador**; nós somos **operadores**. Isso consta nos Termos de Uso e no DPA.
- O cliente exporta tudo a qualquer momento. Após cancelamento, dados disponíveis por 90 dias e depois apagados.
- Não usamos dados do cliente para outros fins sem autorização. Benchmarks anonimizados só com consentimento explícito.
- Dados pessoais tratados: telefones de colaboradores, CPFs em notas, salários (o mais sensível, visível só ao Dono por padrão).

**Segurança (padrão adotado):**
- Criptografia em trânsito e em repouso.
- Isolamento por tenant garantido no banco (RLS).
- Login por código (OTP), segundo fator opcional para o dono.
- Mínimo privilégio via papéis.
- Fornecedores de IA configurados para não treinar com nossos dados.
- Hospedagem preferencialmente no Brasil (região São Paulo).
- Retenção: áudio original por 90 dias; depois, só a transcrição.
- Plano de resposta a incidentes (inclui comunicação à ANPD e aos clientes).
- Encarregado (DPO): um dos sócios inicialmente.

**Auditoria e backup:**
- Cada lançamento guarda quem lançou, quando, por qual canal e o material original.
- Edições geram versões; nada é sobrescrito.
- Exclusão vai para lixeira (30 dias).
- Backup diário com recuperação point-in-time e teste de restauração periódico.

## 10. Negócio

**Monetização:** assinatura por restaurante, com custo de IA embutido.
- Planos por porte (ex.: Essencial e Profissional), desconto por unidade adicional. **[PENDENTE: preços, faixa estimada R$ 99 a 199/mês]**
- Limites técnicos discretos contra abuso (duração de áudio, mensagens por hora, cota generosa de perguntas de relatório com aviso).
- Roteamento de modelos: o mais barato para lançamentos simples, o mais capaz só quando necessário.

**Custos estimados (outubro de 2026):**
- Variável: ~US$ 3 a 5 por restaurante/mês (WhatsApp de serviço é gratuito dentro da janela de 24 h; utilidade ~R$ 0,035 por mensagem; transcrição US$ 0,003–0,006/min; modelos pequenos custam centavos).
- Fixo inicial: ~R$ 200 a 950/mês (infra, provedor, domínio, monitoramento).
- Abertura: CNPJ, termos e política de privacidade com advogado, identidade visual: R$ 3 a 10 mil.
- Desenvolvimento: feito pelos sócios.

**Responsáveis:** produto, testes com usuários, suporte, vendas e marketing: os dois sócios.

**Métricas de sucesso (iniciais):**
- Precisão: % de lançamentos sem correção (meta > 90%).
- Uso: restaurantes que lançam em pelo menos 4 dias por semana.
- Retenção em 30, 60 e 90 dias.
- Valor percebido: uso de relatórios e perguntas por mês.
- Negócio: clientes pagantes, churn, custo de IA por restaurante.

## 11. Validação

1. Entrevistas com conhecidos do ramo: como controlam hoje, quanto pagariam.
2. Teste "mágico de Oz" (2 a 4 semanas, 2 ou 3 restaurantes): número de WhatsApp operado manualmente com ajuda de IA. Objetivo: confirmar que eles enviam os gastos no dia a dia e coletar exemplos reais de mensagens.
3. Piloto do MVP com 5 a 10 restaurantes, gratuito por 60 a 90 dias, depois preço de fundador.

## 12. Riscos

- **Política do WhatsApp:** a Meta restringe chatbots de IA de uso geral na API. Nosso bot é de função específica, mas as regras precisam ser confirmadas antes de construir.
- **Consulta da NFC-e:** cada SEFAZ estadual tem página própria; o parsing varia por estado e pode quebrar. Começar pelos estados dos pilotos.
- **Precisão da transcrição** em ambiente barulhento.
- **Adoção:** o maior risco é o colaborador não criar o hábito de enviar. Validar cedo.
- **Custo por mensagem** crescendo com uso intenso: monitorar desde o dia 1.

## 13. Pendências com o sócio contador

1. Plano de categorias definitivo.
2. Tratamento de impostos sobre faturamento por regime (Simples na maioria).
3. Regras de separação entre investimento e despesa.
4. Viabilidade da captura automática de NF-e via certificado A1.
