## ADDED Requirements

### Requirement: Configuração por empresa
A empresa SHALL ter configuração de imposto estimado: opção "ver imposto estimado" (padrão desligada), regime (MEI, SIMPLES_NACIONAL, LUCRO_PRESUMIDO, LUCRO_REAL), data de início e parâmetros do regime. Só o `owner` altera. NAO_SEI MUST NOT permitir ativar (RF39.R1, R2).

#### Scenario: Ativar sem regime
- **WHEN** o Dono tenta ativar a opção sem regime definido
- **THEN** a gravação é recusada

#### Scenario: Isolamento
- **WHEN** uma empresa consulta configurações
- **THEN** só vê as próprias (RLS)

### Requirement: Regime com vigência
A troca de regime SHALL valer a partir da data informada, e meses anteriores MUST continuar com o regime vigente na época (RF39.R2).

#### Scenario: Troca de regime
- **WHEN** o regime muda em 01/01/2027
- **THEN** o cálculo de dezembro de 2026 usa o regime antigo

### Requirement: Regras versionadas por vigência
As regras de cálculo SHALL ficar em tabela global com `valid_from` e `valid_to`, nunca editadas: mudar regra cria linha nova. O app tem só leitura (RF39.R4).

#### Scenario: Regra nova (RF39.CA03)
- **WHEN** existe regra nova com vigência em 01/01/2027 e dezembro de 2026 é consultado
- **THEN** o cálculo usa a regra antiga

#### Scenario: Edição bloqueada
- **WHEN** o papel `app` tenta atualizar ou apagar uma regra
- **THEN** o banco recusa

### Requirement: Cálculo puro em centavos
O cálculo SHALL ocorrer em `packages/core`, em centavos inteiros, com arredondamento meio-para-cima, sem IA e sem acesso a infraestrutura (RF39.R5, RNF13).

#### Scenario: Cálculo conferido (RF39.CA02)
- **WHEN** um mês de empresa no Simples com parâmetros informados é calculado
- **THEN** o resultado é igual a um cálculo independente com as mesmas regras

#### Scenario: Opção desligada (RF39.CA01)
- **WHEN** a opção está desligada
- **THEN** nenhum valor é calculado nem devolvido

### Requirement: Aviso e auditoria
Todo valor devolvido SHALL vir com o aviso "Estimativa gerencial. Não substitui a apuração do contador."; ativar, desativar e alterar regime ou parâmetros SHALL gerar registro de auditoria (RF39.R7, R8).

#### Scenario: Alterar parâmetros
- **WHEN** o Dono altera um parâmetro
- **THEN** a auditoria guarda quem, quando, antes e depois
