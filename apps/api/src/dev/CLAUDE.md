# Chat de desenvolvimento (`pnpm dev:chat`)

Só para desenvolvimento e teste (plano do canal, seção 3.6). Não é produto e não precisa de interface bonita.

- **Mesmo caminho da produção.** O chat monta o payload com `buildTextWebhookPayload` (`@app/whatsapp`), assina com `WHATSAPP_APP_SECRET` e faz POST no webhook local. Não crie atalho no caminho de entrada.
- **Respostas** saem pela porta `MessageSender`; o `DevMessageSender` grava em `outbound_messages` (`dev.out.<uuid>`) e o chat as lê por polling. O chat usa o papel `app_ingest`.
- **Trava de ambiente.** O chat (`chatBlockReason`), o `DevMessageSender` e o `seedDevData` recusam `NODE_ENV=production`. Todo adaptador `Dev*` novo deve fazer o mesmo e ter teste disso.
- **Lógica fora do terminal.** `chat-session.ts` não toca em stdin/stdout nem em rede (tudo injetado, testado em `chat-session.test.ts`). `chat.ts` só liga as pontas.
- **Entrada por pipe.** Use `for await (const line of rl)` e não `rl.question`: o `question` perde as linhas que chegam antes da próxima pergunta. Depois do fim da entrada, não chame `rl.prompt()`.
- **Comandos novos** entram em `parseChatInput`. Hoje: `/como`, `/reply <texto>` (responde à última confirmação), `/custo`, `/audio <arquivo>`, `/foto <arquivo> [legenda]`, `/sair`.
- **Mídia (`/audio`, `/foto`):** o chat copia o arquivo para `DEV_MEDIA_DIR` (padrão `.dev-media/`, no `.gitignore`) como `dev.media.<uuid>.<ext>` e manda o payload no formato da Meta; o worker lê pelo `DevFileMediaDownloader`. Áudio exige `ffmpeg` no PATH e `OPENAI_API_KEY`.
- **wa_id** digitado em `/como`: só dígitos, com 55 acrescentado se faltar; com `+` vale exatamente o digitado. O 9º dígito fica como digitado (a Meta entrega os dois formatos). A resposta é procurada em `replyAddress` (sempre com o 9).
- **Dados**: `pnpm db:seed:dev` (usuários e restaurantes fixos em `packages/db/src/dev-seed.ts`).
