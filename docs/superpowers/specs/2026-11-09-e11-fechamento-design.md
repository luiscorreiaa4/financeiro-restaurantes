# Fechamento da E11: contador só por e-mail e pendências do review

Aprovado pelo Luís em 09/11/2026. Regras em `docs/requisitos.md` (RF05.R2, RF11.R5, RF19, RF36) e decisões em `docs/decisoes.md` (DD-03, DD-20, DE-25, **DE-26**). Este documento não copia regra.

## Objetivo

Fechar a E11: (1) o contador existir só com e-mail sem quebrar o canal (DD-20); (2) as pendências menores do review de `trocar unidade`/`trocar empresa` (DE-25).

Não-objetivos: convite do contador pela tela (F6/F13), envio de e-mail, mudança de prompt ou schema de extração (evals não rodam).

## Abordagens consideradas

- **Contador no canal:** (a) ignorar o vínculo, (b) ignorar e avisar com texto próprio, (c) deixar como está. **Escolhida: (a)**; (b) exigiria mensagem nova para o Matheus revisar e (c) deixa a mensagem cair na empresa errada.
- **Nome de empresa comum:** (a) lista de palavras comuns, (b) só nomes compostos, (c) aceitar e documentar. **Escolhida: (a)**; (b) deixa de reconhecer "Tropicana".
- **Repetição do "Pronto!":** fechar a pergunta depois de responder, em vez de uma tabela de controle. Sem migration.

## Desenho

- `validateAccess` ganha `phone: string | null`; sem celular, dono, gerente e lançador falham com `PhoneRequired`; contador passa.
- `resolveSender` descarta vínculos com `role = "accountant"` antes de qualquer outra regra. O resto do canal (`activeMemberships`, `trocar empresa`) herda o filtro.
- `ChoiceStore.apply` só grava a preferência (e exige unidade ativa); `answerChoice` responde e depois fecha a pergunta.
- `cancelar` com pergunta `choice` aberta responde `CHOICE_CANCELLED_TEXT`.
- `matchCitedPlace` ignora o nome da empresa quando todas as suas palavras estão em `COMMON_COMPANY_WORDS`.
- Seed de desenvolvimento ganha a Contadora Demo (só e-mail, vínculo de contador nas duas empresas).

## Fica para o construtor

Texto exato da lista de palavras comuns (proposta no plano), ids do seed e nomes dos testes.
