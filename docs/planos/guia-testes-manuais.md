# Guia de testes manuais do canal WhatsApp

> **Para quem:** Luís (e quem for mostrar o sistema ao Matheus). Como testar à mão tudo o que o canal já faz, pelo `pnpm dev:chat`, sem WhatsApp real. A última seção cobre o teste com o celular, quando a Meta liberar.

Atualizado em 04/11/2026. Junta o guia das E6 a E9, os roteiros "Como testar à mão" das E3 a E5 e o passo a passo do túnel (antigo `e3-o-que-falta-para-fechar.md`).

**Custo:** os testes automáticos não gastam nada (IA e mídia simuladas). À mão, este guia inteiro custa menos de US$ 0,05: texto sai por cerca de US$ 0,0004 por mensagem e áudio de 20 s, por cerca de US$ 0,002.

## 1. Preparação (uma vez)

1. Docker ligado e banco no ar: `docker compose up -d`. O Postgres do Compose usa a porta **5434** (a 5432 pode estar ocupada por um Postgres nativo do Windows).
2. Banco antigo, criado antes da E2? Crie o papel de ingestão: `docker compose exec -T postgres psql -U postgres -d app < docker/postgres/init.sql`.
3. No `.env` da raiz (modelo no `.env.example`): `ANTHROPIC_API_KEY`, `WHATSAPP_APP_SECRET` e `WHATSAPP_VERIFY_TOKEN` (qualquer valor local), `DATABASE_INGEST_URL=postgres://app_ingest:app_ingest@localhost:5434/app`, `CHANNEL_MODE=dev`. Para **áudio**, também `OPENAI_API_KEY`.
4. Migrations e dados de exemplo. `db:migrate` e os seeds **não leem o `.env`**, então exporte antes (PowerShell):
   ```powershell
   $env:DATABASE_ADMIN_URL = "postgres://postgres:postgres@localhost:5434/app"
   pnpm db:migrate     # migrations 0000 a 0005
   pnpm db:seed        # categorias padrão
   pnpm db:seed:dev    # restaurantes, usuários, formas de pagamento e canais de exemplo
   ```
5. Para **áudio**: `winget install Gyan.FFmpeg`, abra um terminal novo e confira com `ffmpeg -version`.
6. Três terminais, nesta ordem: `pnpm dev`, `pnpm dev:worker`, `pnpm dev:chat`.

Você começa como o dono do Restaurante Demo (`11987650001`). Trocar de usuário: `/como 11987650003` (atendente), `/como 11987650002` (gerente), `/como 11987650001` (dono).

## 2. Webhook e fila, sem o chat (E3 e E4)

Com `pnpm dev` e `pnpm dev:worker` rodando:

1. Handshake no navegador: `http://localhost:4000/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=SEU_TOKEN&hub.challenge=123` deve mostrar `123`. Token errado: 403.
2. POST assinado, na raiz do repositório. Deve imprimir `200 {"ok":true}`; rodar duas vezes não duplica:
   ```
   node --env-file=.env -e "const c=require('crypto'),fs=require('fs');const b=fs.readFileSync('packages/whatsapp/test/fixtures/text-message.json');const s='sha256='+c.createHmac('sha256',process.env.WHATSAPP_APP_SECRET).update(b).digest('hex');fetch('http://localhost:4000/webhooks/whatsapp',{method:'POST',headers:{'content-type':'application/json','x-hub-signature-256':s},body:b}).then(async r=>console.log(r.status,await r.text()))"
   ```
3. No terminal do worker aparece "mensagem processada" (sem o texto).
4. Banco: `docker compose exec postgres psql -U postgres -d app -c "select wa_message_id, type, status from inbound_messages"` mostra 1 linha `processed`; `-c "select name, state from pgboss.job"` mostra o job `completed`.
5. Troque um caractere do comando do passo 2 (por exemplo, `text-message` por `text-messagX`): deve voltar 401 e nada é gravado.
6. Parada limpa: Ctrl+C no worker loga "encerrando worker". Com o worker parado, mande a mensagem: o job fica `created` e é consumido quando o worker volta.

## 3. Quem escreveu (E5)

No chat:

| Digite | O que deve ver |
|---|---|
| `ajuda` | Texto de ajuda, sem chamar a IA |
| `/como 11900000000` e depois `oi` | Resposta de número desconhecido |
| `/como 551187650001` e depois `ajuda` | Funciona sem o 9º dígito |
| `/como 11987650005` e depois `ajuda` | Desativado: **a mesma resposta** do desconhecido |
| `/como 11987650004` | Usuário em 2 restaurantes: lança no mais antigo |
| `trocar unidade` (como Dono Demo, `/como 11987650001`), depois `2` | Lista numerada (Matriz, Praia); o 2 grava a Praia e confirma. `cancelar` com a lista aberta responde "deixei a troca de lado" |
| `trocar empresa` (como `/como 11987650004`), depois `2`; depois `gastei 50 no litoral` | Escolhe o Demo 2; "no litoral" leva a mensagem de volta ao Demo, na unidade Praia |

A **Contadora Demo** (`contadora@demo.dev`) não tem celular: entra só pelo painel (`/login`, por código) e o canal nunca a encontra. Um celular que só tenha vínculo de contador recebe a mesma resposta do desconhecido (DD-20, DE-26).

Conferir: `select status, tenant_id from inbound_messages order by received_at desc` e `select count(*) from whatsapp_opt_ins`.

## 4. Texto: lançamento e confirmação (E6 e E7)

| Digite | O que deve ver |
|---|---|
| `camarão 5kg 450 no pix` | `✅ Registrado (Matriz):` com `Camarão, 5 kg: R$ 450,00`, categoria, data de hoje e `Pix`; no fim, como ajustar |
| `óleo 180, gás 80` | **Uma** confirmação com as duas linhas |
| `vendi 200 no ifood` | Receita com `líquido R$ 154,00` (comissão de 23% do iFood, calculada pelo sistema) |
| `paguei 450 no cartão` | Despesa sem taxa, forma `Crédito` |
| `gás 80` (duas vezes seguidas) | Na segunda, `⚠️ Possível duplicidade` |
| `paguei uma coisa estranha de 50` | `⚠️ Categoria a revisar` (sem perguntar nada) |
| `qual o meu lucro do mês?` ou `oi` | Recusa curta: "Eu só ajudo a registrar receitas e despesas" |
| `/custo` | Gasto de IA acumulado do usuário, em US$ |

### Pergunta de volta (RF15)

1. `óleo 180, camarão` → grava o óleo e pergunta só o valor do camarão (duas mensagens: confirmação e pergunta).
2. Responda `450` → grava o camarão.
3. Repita o passo 1 e envie `cancelar` → "descartei o lançamento pendente".
4. Repita o passo 1 e envie `gás 80` em vez de responder → grava o gás e avisa "Deixei de lado o lançamento do(a) Camarão".
5. `paguei a luz amanhã 420` → não grava; pergunta a data (data futura é recusada).
6. `camarão 450` → pergunta a **quantidade** (regra provisória P04, DE-15).

### Correção e desfazer (RF17 e RF18)

- `camarão 5kg 450 no pix`, depois `/reply foi 400` → `✏️ Corrigido:` com R$ 400,00.
- Com dois itens na confirmação: `/reply foi 400` → pergunta qual; `/reply o 2 foi 400` → corrige só o 2.
- `desfazer` → `↩️ Desfeito:` do último lançamento; de novo → o anterior; quando acabar → "Não encontrei lançamento seu nas últimas 24 horas".
- Como atendente (`/como 11987650003`), responder a uma confirmação do dono com `/reply foi 10` → recusado ("só pode mexer nos lançamentos que você mesmo fez"). O `/reply` usa a última confirmação recebida pelo usuário atual; confira no banco (`select * from entries`).
- `suporte` e `ajuda` respondem direto, sem IA.

Conferir no banco: `select description, amount_cents, fee_cents, net_cents, version, deleted_at from entries order by created_at;` e `select action, channel, version from entry_versions order by changed_at;`.

## 5. Áudio (E9, RF13)

Precisa de `OPENAI_API_KEY` e do ffmpeg. Grave um áudio curto ("camarão cinco quilos quatrocentos e cinquenta no pix") e salve como `.ogg`, `.opus`, `.mp3`, `.m4a` ou `.wav`.

- `/audio C:\caminho\nota.ogg` → `Entendi: "..."` seguido da confirmação.
- Áudio com mais de 3 minutos → "Seu áudio tem mais de 3 minutos" (sem gastar IA).
- Áudio sem fala → "Não consegui entender o áudio".
- Sem ffmpeg, o worker tenta de novo e, ao esgotar, o chat mostra "Tive um problema e NÃO registrei essa mensagem".

**Ainda não confirmado:** o preço do `gpt-transcribe` e se a conversão com ffmpeg chega ao formato que a OpenAI aceita (só testado com ffmpeg simulado). Se a transcrição der erro, anote o código que o worker logar.

## 6. Foto de nota (E9, RF14)

- `/foto C:\caminho\cupom.jpg` (ou `.png`) com um cupom fiscal: a IA lê os itens e o sistema agrupa por categoria ("Atacadão – 8 itens"). Legenda opcional: `/foto cupom.jpg nota do mercado`.
- Cupom com QR legível: a chave de acesso é guardada, e **a mesma foto** de novo responde "Essa nota já foi registrada em dd/mm por Dono Demo." sem gastar IA. Conferir: `select access_key, source, needs_recheck from fiscal_documents;`.
- Foto sem valores legíveis → "Não consegui ler os valores da nota, então não registrei nada".
- Foto que não é documento financeiro → recusa de fora de escopo.
- Imagem acima de 5 MB → "passou de 5 MB".

A consulta à SEFAZ **ainda não existe**: a nota é lida só pela IA e fica `needs_recheck = true`.

## 7. Limite de uso (RF21)

60 mensagens por usuário por hora e 1.000 por empresa por dia (`DEFAULT_USAGE_LIMITS` em `packages/core/src/media/limits.ts`). Para ver sem digitar 60 vezes: baixe o limite para 3 nessa constante, reinicie o worker e envie 5 mensagens. A 4ª recebe "Recebi muitas mensagens seguidas" e a 5ª não recebe nada. **Volte o valor para 60 depois.**

## 8. IA direto e evals (E6 e E8)

```powershell
pnpm --filter @app/ai extract                          # 13 frases de scripts/frases.txt, com custo por mensagem
pnpm --filter @app/ai extract "paguei 350 de carne"   # só a frase dada
pnpm --filter @app/ai eval                             # 39 casos (cerca de US$ 0,015), compara com baseline.json
pnpm --filter @app/ai eval -- --only=f01,m01 --verbose # só alguns casos, com a saída bruta
```

O `eval` sai com erro se o acerto cair mais de 5 pontos em relação ao `baseline.json`.

## 9. Testes automáticos (sem custo)

```powershell
pnpm typecheck; pnpm lint; pnpm test      # unitários
pnpm test:int                             # integração (Docker ligado): db e api
```

## 10. Teste com o celular (quando a Meta liberar, P15)

Hoje só o botão **Teste** do painel da Meta chega à nossa API; a mensagem do celular só chega depois de publicar o app ([`luis.md`](luis.md), seção 2.3).

1. **Túnel:** `winget install --id Cloudflare.cloudflared`; com `pnpm dev` rodando, `cloudflared tunnel --url http://localhost:4000`. Copie a URL `https://...trycloudflare.com` e teste `/health` (deve mostrar `{"status":"ok"}`). A URL muda a cada reinício do túnel. Alternativa: `ngrok http 4000`.
2. **Meta:** developers.facebook.com/apps > o app > WhatsApp > Configuration (na tela nova: Etapa 2, Configuração da produção > Configurar webhooks). Callback URL `https://...trycloudflare.com/webhooks/whatsapp`, Verify token igual ao `WHATSAPP_VERIFY_TOKEN`, salvar e assinar o campo **messages**.
3. Do celular, mande **"Teste"** para o número da Meta. Deve entrar 1 linha nova em `inbound_messages` com o seu `wa_id` e 1 job em `pgboss.job`. Reenviar o mesmo POST não duplica (uma segunda mensagem do celular é outra mensagem e cria outra linha, o que é esperado).
4. Erro de envio: `select wa_message_id, status, error_code from whatsapp_status_events` mostra o `130497` enquanto P2 não for resolvido.
5. Com o payload real em mãos (`inbound_messages.raw` e `whatsapp_status_events.raw`), anonimize telefone, `wa_id`, `user_id`, nome e IDs e peça ao Claude para transformá-lo em fixture com teste de contrato.

Se tudo passar, a E3 perde a ressalva no [`canal-whatsapp.md`](canal-whatsapp.md). Depois vem a E10, que repete o roteiro das seções 3 a 7 pelo celular, em staging.
