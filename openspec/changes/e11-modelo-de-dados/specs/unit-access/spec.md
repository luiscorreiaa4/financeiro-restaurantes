## ADDED Requirements

### Requirement: Lista de unidades de acesso
Cada vínculo (colaborador × empresa) SHALL ter as Unidades de Acesso como lista de unidades da mesma empresa ou como TODAS, que inclui unidades criadas no futuro. O `owner` MUST ter sempre TODAS (RF05.R5, RF04.Obs3).

#### Scenario: Unidade criada depois
- **WHEN** uma unidade nova é criada e um colaborador tem acesso TODAS
- **THEN** ele passa a ter acesso a ela sem alteração manual

#### Scenario: Unidade de outra empresa
- **WHEN** se tenta incluir na lista uma unidade de outra empresa
- **THEN** o banco recusa (isolamento entre empresas, RNF02)

### Requirement: Unidade padrão dentro da lista
O vínculo SHALL ter unidade padrão, que MUST estar entre as Unidades de Acesso; com uma única unidade de acesso, é preenchida automaticamente (RF05.R6).

#### Scenario: Padrão fora da lista (RF05.CA04)
- **WHEN** se tenta salvar um vínculo com unidade padrão fora das Unidades de Acesso
- **THEN** a gravação é recusada

### Requirement: Situação do vínculo
O vínculo SHALL ter situação CONVIDADO, ATIVO ou DESATIVADO, com convidado por, data do convite e data de desativação. Vínculo desativado SHALL ser tratado como número desconhecido (RF05.R8).

#### Scenario: Primeira mensagem (RF05.CA07)
- **WHEN** um colaborador CONVIDADO envia a primeira mensagem
- **THEN** a situação passa a ATIVO e o consentimento fica registrado com a mensagem de origem

#### Scenario: Desativado (RF05.CA05)
- **WHEN** um colaborador DESATIVADO envia mensagem
- **THEN** recebe a mesma resposta de número desconhecido e nada é gravado

### Requirement: Migração sem perda de acesso
Os vínculos existentes SHALL ser convertidos: `unit_id` nulo vira TODAS; `unit_id` preenchido vira lista com essa unidade, também como padrão; vínculo com `deactivated_at` vira DESATIVADO; os demais, ATIVO.

#### Scenario: Banco do seed de desenvolvimento
- **WHEN** a migration roda sobre os dados de `pnpm db:seed:dev`
- **THEN** cada colaborador mantém exatamente as unidades que tinha

### Requirement: Escolha de unidade e empresa pelo WhatsApp
O colaborador SHALL poder usar `trocar unidade`, `trocar empresa` e citar a empresa no texto (RF11.R5, RF19), restritos às suas unidades de acesso. Pedido para unidade fora do acesso MUST ser recusado sem revelar dados dela (RF06.R5).

#### Scenario: Unidade fora do acesso
- **WHEN** um colaborador pede lançamento para uma unidade fora de suas Unidades de Acesso
- **THEN** recebe a recusa padronizada e nada é gravado

#### Scenario: Unidade inativa (RF04.CA03)
- **WHEN** o colaborador cita o apelido de uma unidade inativa
- **THEN** nada é gravado nela e ele é avisado de que está inativa

### Requirement: Aviso de folha no convite do contador
O convite do `accountant` SHALL exigir que o Dono confirme o aviso "este acesso inclui folha de pagamento", e o aceite (quem, quando, empresa, contador) MUST ficar na trilha de auditoria. O mesmo e-mail SHALL poder ter vínculo `accountant` em várias empresas (RF36.CA01, CA03, DD-03, DD-04).

#### Scenario: Convite sem confirmação
- **WHEN** o convite é enviado sem o aceite do aviso
- **THEN** é recusado e nenhum vínculo é criado

#### Scenario: Convite confirmado
- **WHEN** o Dono confirma o aviso e envia
- **THEN** o vínculo é criado e a auditoria registra o aceite com data

### Requirement: Sempre um Dono ativo
Cada empresa SHALL manter ao menos um `owner` ATIVO (RF05.Obs3, CA06).

#### Scenario: Rebaixar o único Dono
- **WHEN** o único Dono ativo tenta rebaixar o próprio papel
- **THEN** a ação é bloqueada
