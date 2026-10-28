# E3: o que falta para fechar a etapa (passo a passo)

Atualizado em 28/10/2026. O código da E3 está pronto e commitado. A etapa só fica "Feita" de verdade quando você completar os passos 1 a 4 abaixo (é o "Pronto quando" do plano: a mensagem "Teste" do seu celular aparece no banco e o reenvio não duplica). Os passos 5 a 7 são pendências menores e não bloqueiam a E4.

Legenda: ✅ conferido na documentação oficial em 28/10/2026.

## Passo 1. Preparar o ambiente local (uma vez)

1. Abra o Docker Desktop e espere ele ficar "Running".
2. Na raiz do repositório: `docker compose up -d`.
3. Se o seu banco local é antigo (criado antes da E2), crie o papel `app_ingest`:
   `docker compose exec -T postgres psql -U postgres -d app < docker/postgres/init.sql`
4. `pnpm db:migrate` (aplica a migration 0002, tabela `whatsapp_status_events`).
5. Abra o seu `.env` e confira estas variáveis (use o `.env.example` como modelo):
   - `DATABASE_INGEST_URL=postgres://app_ingest:app_ingest@localhost:5432/app` (**nova**)
   - `WHATSAPP_VERIFY_TOKEN`: invente uma frase, por exemplo `meu-token-local-123`. É você quem escolhe; a Meta só vai devolvê-la.
   - `WHATSAPP_APP_SECRET`: painel da Meta, **App settings > Basic > App secret** (o mesmo que você anotou no `docs/plano-luis.md`).

## Passo 2. Teste local, sem a Meta (confirma que o código funciona na sua máquina)

1. `pnpm dev` (a API sobe na porta 4000). Deixe rodando.
2. Em outro terminal, o handshake: abra no navegador
   `http://localhost:4000/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=SEU_TOKEN&hub.challenge=123`
   Deve aparecer `123`. Com o token errado deve dar erro 403.
3. POST assinado (na raiz do repositório, outro terminal). Deve imprimir `200 {"ok":true}`:
   ```
   node --env-file=.env -e "const c=require('crypto'),fs=require('fs');const b=fs.readFileSync('packages/whatsapp/test/fixtures/text-message.json');const s='sha256='+c.createHmac('sha256',process.env.WHATSAPP_APP_SECRET).update(b).digest('hex');fetch('http://localhost:4000/webhooks/whatsapp',{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':s},body:b}).then(async r=>console.log(r.status,await r.text()))"
   ```
4. Rode o mesmo comando uma segunda vez. Continua `200`.
5. Confira o banco:
   - `docker compose exec postgres psql -U postgres -d app -c "select wa_message_id, type, text, status from inbound_messages"` → **1 linha**, texto `Teste`, status `received`.
   - `docker compose exec postgres psql -U postgres -d app -c "select count(*) from pgboss.job"` → **1**.
6. Troque um caractere no comando do item 3 (por exemplo, `text-message` por `text-messagX`, ou altere o segredo): deve voltar `401` e nada novo no banco.

## Passo 3. Expor a API na internet (túnel)

A Meta precisa de uma URL pública `https`. Use o Cloudflare Quick Tunnel ✅ (não precisa de conta):

1. Instale o `cloudflared` (Windows: `winget install --id Cloudflare.cloudflared`).
2. Com a API rodando (`pnpm dev`), em outro terminal: `cloudflared tunnel --url http://localhost:4000`
3. O terminal mostra uma URL `https://alguma-coisa.trycloudflare.com`. Copie.
4. Teste no navegador: `https://alguma-coisa.trycloudflare.com/health` deve mostrar `{"status":"ok"}`.

Cuidados ✅: a URL **muda toda vez** que você reinicia o `cloudflared` (será preciso atualizar na Meta), e o túnel morre se você fechar o terminal. É só para desenvolvimento. (Alternativa: ngrok, `ngrok http 4000`, com conta gratuita.)

## Passo 4. Configurar o webhook na Meta e fazer o teste real (o "Pronto quando")

Caminho no painel ✅: **developers.facebook.com/apps > seu app > WhatsApp > Configuration** (se o app foi criado com o caso de uso "Connect with customers through WhatsApp": **Use cases > Customize > Configuration**).

1. Em **Callback URL**, cole `https://alguma-coisa.trycloudflare.com/webhooks/whatsapp` (com o `/webhooks/whatsapp` no final).
2. Em **Verify token**, cole o mesmo valor do `WHATSAPP_VERIFY_TOKEN` do seu `.env`.
3. Clique em salvar/verificar. O painel só salva se o nosso GET responder certo. Se der erro: a API está rodando? o túnel está de pé? o token é idêntico? (o terminal da API mostra a requisição.)
4. Na lista de campos que aparece, assine (**Subscribe**) o campo **messages**.
5. Do seu celular, mande **"Teste"** para o número de teste da Meta.
6. Confira o banco (mesmo `select` do passo 2.5): deve haver uma nova linha com o texto `Teste`, status `received`, e `wa_id` do seu celular. O `pgboss.job` ganha 1 job.
7. Reenvio: no painel da Meta (ou mandando de novo o mesmo POST do passo 2.3) não deve criar linha duplicada. Obs.: uma segunda mensagem "Teste" do celular é outra mensagem (outro `wa_message_id`) e cria outra linha, o que é o esperado.
8. Bônus: o erro 130497 aparece quando o bot tenta responder. Quando isso ocorrer, `select wa_message_id, status, error_code from whatsapp_status_events` mostra a linha com `130497`.

Se tudo isso passou: avise o Claude. Ele marca a E3 como "Feita" sem ressalvas no plano.

## Passo 5. Fixtures reais (pode ser depois)

Hoje as fixtures em `packages/whatsapp/test/fixtures/` são sintéticas. Para trocar pelas reais:
1. Pegue o payload real: com o `pnpm dev` rodando, ele está em `inbound_messages.raw` (mensagem) e em `whatsapp_status_events.raw` (status), ou nos logs da Meta.
2. **Anonimize**: troque seu telefone, `wa_id`, `user_id`, nome do perfil e IDs por valores fictícios.
3. Peça ao Claude: "adicione estas fixtures reais" colando o JSON anonimizado. Ele cria o arquivo e o teste de contrato.

## Passo 6. Pequenas conferências que ficaram abertas

- Onde a Meta manda o `user_id` (`BR.<número>`): hoje o parser aceita em `contacts[].user_id` e em `messages[].from_user_id`. Confirme com o payload real do passo 5 qual dos dois aparece.
- `redact` do Pino: hoje o log de requisição já sai só com método, caminho e id; falta conferir na documentação do Pino se vale configurar `redact` também.

## Passo 7. Decidir sobre as propostas do Claude (não bloqueia a E4)

Estão na seção "Resultado da E3" de `docs/plano-dev-canal-whatsapp.md`: regra `webhook.md`, skill `novo-fixture-whatsapp`, subagente `revisor-seguranca`, hook que protege migrations commitadas, regra `testes.md` e uma linha no `CLAUDE.md` sobre heredoc no Windows. Responda "criar tudo", "criar só X" ou "deixar para depois".

## Depois disso

Próxima etapa: **E4 (fila e workers)**. Peça: "etapa E4".
