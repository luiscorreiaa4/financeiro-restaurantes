## ADDED Requirements

### Requirement: Dados da unidade
A unidade SHALL ter nome (2 a 60 caracteres, único na empresa sem diferenciar maiúsculas e acentos), apelidos (até 5, até 30 caracteres, únicos na empresa), CNPJ opcional e válido quando informado, município, UF, fuso e status ATIVA ou INATIVA (RF04.R1 a R5).

#### Scenario: Nome duplicado (RF04.CA01)
- **WHEN** existe "Centro" e se tenta criar "centro"
- **THEN** o nome é recusado como duplicado

#### Scenario: Apelido repetido
- **WHEN** um apelido já usado por outra unidade da empresa é informado
- **THEN** a gravação é recusada

#### Scenario: CNPJ inválido
- **WHEN** um CNPJ com dígitos verificadores errados é informado
- **THEN** a gravação é recusada

### Requirement: Não inativar a última unidade ativa
O sistema SHALL impedir inativar a última unidade ativa da empresa (RF04.R5).

#### Scenario: Única unidade ativa (RF04.CA02)
- **WHEN** se tenta inativar a única unidade ativa
- **THEN** a ação é bloqueada com explicação

### Requirement: Unidade inativa não recebe lançamento
Unidade INATIVA SHALL permanecer nos relatórios de períodos passados e MUST NOT receber novos lançamentos.

#### Scenario: Lançamento em unidade inativa
- **WHEN** um novo lançamento aponta para unidade inativa
- **THEN** é recusado com erro tipado

### Requirement: Canal padrão da receita
Cada unidade SHALL ter um canal padrão da receita (`default_sales_channel_id`) da própria empresa, trocável sem alterar lançamentos antigos (RF04.R6, DD-08).

#### Scenario: Canal de outra empresa
- **WHEN** o canal padrão aponta para canal de outra empresa
- **THEN** o banco recusa

#### Scenario: Troca do padrão
- **WHEN** o Dono troca o canal padrão
- **THEN** lançamentos já gravados mantêm o canal que tinham

### Requirement: Só o Dono altera
Criar ou alterar unidade SHALL ser permitido apenas ao `owner` (RF04.CA05).

#### Scenario: Gerente tenta alterar
- **WHEN** um `manager` tenta criar ou alterar unidade
- **THEN** a ação é recusada
