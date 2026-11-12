# Biome só nos seus arquivos

`pnpm lint` da raiz passa desde o bloco pós-F2. Mesmo assim:

- Rode `pnpm exec biome check <arquivos que você tocou>`, nunca `--write` numa pasta inteira: ele reformata arquivos alheios e mistura ruído no diff.
- Se um arquivo alheio foi reformatado sem querer, desfaça com `git checkout -- <arquivo>` antes de commitar.
- Antes de commitar, `git diff --stat` e `git diff --ignore-cr-at-eol --stat` devem mostrar o mesmo conjunto de arquivos.
