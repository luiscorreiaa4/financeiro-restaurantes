## ADDED Requirements

### Requirement: Campos de apoio da categoria
A categoria SHALL ter Exige Quantidade, palavras de apoio (até 30), status ATIVA ou INATIVA e origem SISTEMA ou EMPRESA; a subcategoria herda tipo, grupo e sensível da categoria-mãe, com no máximo dois níveis, e categoria da empresa é sempre filha de uma padrão (RF07).

#### Scenario: Terceiro nível
- **WHEN** se tenta criar subcategoria de uma subcategoria
- **THEN** o banco ou o domínio recusa

#### Scenario: Herança de sensível
- **WHEN** uma subcategoria é criada sob categoria sensível
- **THEN** ela é sensível, sem depender do que foi informado

### Requirement: Tipo e apelidos da forma de pagamento
A forma de pagamento SHALL ter tipo (DINHEIRO, PIX, DEBITO, CREDITO, VOUCHER, BOLETO, TRANSFERENCIA, OUTRO), apelidos (até 10), status e existir a forma "Não informada". A empresa SHALL ter uma forma de cartão padrão, usada quando a mensagem diz só "cartão" (RF08, RF12.R8).

#### Scenario: Cartão sem especificar
- **WHEN** a mensagem diz "cartão" e a empresa tem forma de cartão padrão
- **THEN** a forma padrão é usada

#### Scenario: Tipo inválido
- **WHEN** um tipo fora da lista é gravado
- **THEN** o banco recusa

### Requirement: Tipo e apelidos do canal de venda
O canal de venda SHALL ter tipo (SALAO, DELIVERY_PROPRIO, APLICATIVO, RETIRADA, OUTRO), apelidos, status e existir o canal "Não informado". Canal APLICATIVO com comissão maior que zero substitui a taxa da forma de pagamento; despesa nunca tem taxa (RF09.R4, DE-19, P06).

#### Scenario: Comissão do aplicativo
- **WHEN** uma receita é lançada num canal APLICATIVO com comissão de 12%
- **THEN** a taxa aplicada é a do canal, não a da forma de pagamento

#### Scenario: Canal inativo
- **WHEN** um canal INATIVO é usado em novo lançamento
- **THEN** é recusado; lançamentos antigos continuam legíveis

### Requirement: Catálogos isolados por empresa
Os campos novos MUST seguir o isolamento por `tenant_id`; categorias do sistema (`tenant_id` nulo) são somente leitura para o app (RNF02).

#### Scenario: Alterar categoria do sistema
- **WHEN** o papel `app` tenta alterar uma categoria do sistema
- **THEN** o banco recusa
