# Roteiro à mão da F7

Passos que só uma pessoa faz em aparelho real (instalar, modo avião, leitor de tela). Vêm do plano `docs/superpowers/plans/2026-11-26-f7-pwa-responsividade.md` (tarefa T9) e da decisão DD-44 em `docs/decisoes.md`.

- [ ] 1. Android/Chrome por HTTPS: instalar pelo menu do navegador e pelo item "Instalar o app". O app abre em tela cheia com o ícone "FR".
- [ ] 2. iPhone/Safari: seguir os passos do diálogo. O app abre sem a barra do Safari.
- [ ] 3. Computador (Chrome ou Edge): instalar.
- [ ] 4. Modo avião:
  - [ ] com o app aberto, aparece a faixa "Sem conexão";
  - [ ] ao reabrir, aparece a tela "Sem conexão";
  - [ ] com a rede de volta, "Tentar de novo" carrega o painel.
- [ ] 5. Baixar uma exportação no app instalado.
- [ ] 6. Abrir a lista e o dashboard no celular, sem rolagem horizontal.
- [ ] 7. Pendência herdada: máscara do CPF e do celular em aparelho real e com leitor de tela. Está em `docs/planos/andamento.md`, seção 6, na linha "Roteiro à mão da tela de cadastro com leitor de tela (NVDA)" (linha 132 hoje; a busca por "máscara" e "CPF" localiza o trecho).
- [ ] 8. HTTPS local: `pnpm --filter @app/web exec next dev --experimental-https`, ou staging na F8.
