## ADDED Requirements

### Requirement: Quatro papéis fixos
O sistema SHALL reconhecer os papéis `owner` (DONO), `manager` (GERENTE), `staff` (LANCADOR) e `accountant` (CONTADOR). Papéis personalizados MUST NOT existir (RF06.Obs1).

#### Scenario: Papel conhecido
- **WHEN** o domínio valida o papel "accountant"
- **THEN** o papel é aceito, e um papel fora dos quatro é recusado

### Requirement: Matriz de permissões como contrato
Para cada papel e cada ação da matriz da seção 2.3, o resultado de `can()` SHALL ser exatamente o da matriz, considerando o escopo de unidades, a autoria do lançamento e as permissões adicionais (RF06.R1, R2).

#### Scenario: Matriz completa (RF06.CA06)
- **WHEN** cada ação da matriz é avaliada para cada papel, com e sem permissões adicionais aplicáveis
- **THEN** o resultado (permitido ou recusado) corresponde linha a linha à matriz

#### Scenario: Contador nunca escreve (RF36.CA04)
- **WHEN** um `accountant` tenta criar, editar, excluir ou restaurar lançamento, ou lançar pelo WhatsApp
- **THEN** a ação é recusada com `PermissionDenied`

#### Scenario: Lançador fora do próprio lançamento (RF06.CA04)
- **WHEN** um `staff` tenta corrigir ou desfazer lançamento de outra pessoa
- **THEN** a ação é recusada

### Requirement: Permissões adicionais validadas
O sistema SHALL aceitar apenas VER_FOLHA, EXPORTAR_DADOS, RECEBER_RESUMO_SEMANAL e CONSULTAR_RELATORIOS_WHATSAPP, e só nos papéis em que fazem sentido (RF05.R7, RF06): VER_FOLHA, EXPORTAR_DADOS e RECEBER_RESUMO_SEMANAL para `manager`; CONSULTAR_RELATORIOS_WHATSAPP para `staff`.

#### Scenario: Permissão fora do papel
- **WHEN** CONSULTAR_RELATORIOS_WHATSAPP é atribuída a um `manager`, ou um valor desconhecido a qualquer papel
- **THEN** a validação recusa com erro tipado

#### Scenario: Gerente com VER_FOLHA lança folha (matriz)
- **WHEN** um `manager` com VER_FOLHA lança em categoria sensível numa unidade de acesso
- **THEN** a ação é permitida; sem VER_FOLHA é recusada (RF06.CA02)

### Requirement: Categoria sensível
Lançamentos de categoria sensível SHALL ser vistos, criados, editados e excluídos apenas por `owner` ou por quem tem VER_FOLHA. O `accountant` SHALL ver esses lançamentos sempre (DD-04), e nunca criar, editar ou excluir (RF06.R3).

#### Scenario: Contador vê folha
- **WHEN** um `accountant` consulta lançamento de categoria sensível
- **THEN** a visualização é permitida

#### Scenario: Staff e gerente sem permissão
- **WHEN** `staff` ou `manager` sem VER_FOLHA tenta qualquer ação de lançamento em categoria sensível
- **THEN** a ação é recusada, mesmo sendo o autor
