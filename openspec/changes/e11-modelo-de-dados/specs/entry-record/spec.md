## ADDED Requirements

### Requirement: Data de pagamento
O lançamento SHALL ter `paid_on` (data de pagamento ou recebimento), igual à data de competência quando não informada. Os relatórios do MVP MUST usar sempre a data de competência (RF12.R21, DD-02).

#### Scenario: Sem data de pagamento (RF12.CA11)
- **WHEN** um lançamento é gravado sem data de pagamento
- **THEN** `paid_on` é igual a `occurred_on`

#### Scenario: Vencimento dito
- **WHEN** a mensagem "paguei a carne 600, vence dia 20" é processada
- **THEN** a competência é hoje e o pagamento é dia 20

### Requirement: Pedidos
O lançamento de receita SHALL aceitar `orders` opcional e maior que zero; o ticket médio é calculado pelo servidor, nunca pela IA (RF12.R22, DD-13).

#### Scenario: Pedidos informados (RF12.CA14)
- **WHEN** "vendi 800 em 32 pedidos" é processada
- **THEN** a receita é gravada com pedidos = 32

#### Scenario: Pedidos inválidos
- **WHEN** pedidos é zero ou negativo
- **THEN** o banco recusa

### Requirement: Receita com canal e sinal de revisão
Toda receita SHALL ter canal de venda; quando chega sem canal, usa o canal padrão da unidade, recebe o sinal CANAL_A_REVISAR e a confirmação cita o canal usado (RF12.R9, DD-08).

#### Scenario: Receita sem canal (RF12.CA12)
- **WHEN** "vendi 800 hoje" é processada numa unidade com canal padrão Salão
- **THEN** a receita é gravada no Salão com CANAL_A_REVISAR

#### Scenario: Despesa sem canal
- **WHEN** uma despesa é gravada sem canal
- **THEN** é aceita, sem sinal de canal

### Requirement: Investimento acima do limite
Despesa de equipamento ou reforma acima de R$ 1.500,00 SHALL gerar pergunta antes de gravar; abaixo disso grava como despesa. O limite fica em constante única (RF12.R23, DD-09).

#### Scenario: Acima do limite (RF12.CA13)
- **WHEN** "comprei um forno 2.800" é processada
- **THEN** nada é gravado e o colaborador recebe a pergunta "equipamento (investimento) ou despesa do mês?"

#### Scenario: Abaixo do limite
- **WHEN** "ar-condicionado 1.200" é processada
- **THEN** a despesa é gravada direto

### Requirement: Sinais de revisão e revisão manual
Os sinais SHALL ser CATEGORIA_A_REVISAR, CANAL_A_REVISAR, POSSIVEL_DUPLICIDADE e DATA_ANTIGA, sem impedir a gravação, e o sistema SHALL permitir marcar como revisado (RF12.R13).

#### Scenario: Marcar como revisado
- **WHEN** um lançamento com sinais é marcado como revisado
- **THEN** os sinais saem e a mudança gera versão em `entry_versions`

### Requirement: Canal de origem e restauração no histórico
`entry_versions.channel` SHALL aceitar `email` além de `whatsapp`, `web`, `import` e `system`, e a ação `restore` SHALL continuar registrada. Toda alteração gera versão imutável (RF25.R4, RNF04).

#### Scenario: Canal email
- **WHEN** uma versão é gravada com canal `email`
- **THEN** o banco aceita; um canal fora da lista é recusado

### Requirement: Exclusão rastreável
Ao excluir, o sistema SHALL guardar quem excluiu, o motivo quando informado e até quando é restaurável; nada é apagado fisicamente (RF24, regra inegociável 4).

#### Scenario: Excluir e restaurar
- **WHEN** um lançamento é excluído e depois restaurado dentro do prazo
- **THEN** voltam a valer os dados anteriores e há duas versões novas (delete e restore)
