# Guia de testes manuais: E6 a E9 (extração, lançamento, evals, áudio e foto)

Para o Luís testar à mão, pelo `pnpm dev:chat`, sem WhatsApp real. **Custo total deste guia: menos de US$ 0,05** (texto custa cerca de US$ 0,0004 por mensagem; áudio de 20 s, cerca de US$ 0,002). Os testes automáticos não gastam nada: usam IA e mídia de mentira.

## 1. Preparação (uma vez)

1. Docker ligado e banco no ar: `docker compose up -d`.
2. No `.env` da raiz (copie do `.env.example`): `ANTHROPIC_API_KEY`, `WHATSAPP_APP_SECRET`, `DATABASE_INGEST_URL`, `CHANNEL_MODE=dev`. Para o **áudio**, também `OPENAI_API_KEY`.
3. Migrations e dados de exemplo. `db:migrate` e os seeds **não leem o `.env`**, então exporte antes (PowerShell):
   ```powershell
   $env:DATABASE_ADMIN_URL = "postgres://postgres:postgres@localhost:5434/app"
   pnpm db:migrate     # aplica as migrations 0004 e 0005
   pnpm db:seed        # categorias padrão
   pnpm db:seed:dev    # restaurantes, usuários, formas de pagamento e canais de exemplo
   ```
4. Para **áudio**: instale o ffmpeg (`winget install Gyan.FFmpeg`) e abra um terminal novo; confira com `ffmpeg -version`.
5. Três terminais, nesta ordem: `pnpm dev`, `pnpm dev:worker`, `pnpm dev:chat`.

Você começa como o dono do Restaurante Demo (`11987650001`). Trocar de usuário: `/como 11987650003` (atendente), `/como 11987650002` (gerente), `/como 11987650001` (dono).

## 2. Texto: lançamento e confirmação (E6 e E7)

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

## 3. Pergunta de volta (RF15)

1. `óleo 180, camarão` → grava o óleo e pergunta só o valor do camarão (duas mensagens: confirmação e pergunta).
2. Responda `450` → grava o camarão (pergunta fechada).
3. Repita o passo 1 e envie `cancelar` → "descartei o lançamento pendente".
4. Repita o passo 1 e envie `gás 80` em vez de responder → grava o gás e avisa "Deixei de lado o lançamento do(a) Camarão".
5. `paguei a luz amanhã 420` → não grava; pergunta a data (não aceita data futura).
6. `camarão 450` → pergunta a **quantidade** (regra provisória P04, ver DE-15).

## 4. Correção e desfazer (RF17 e RF18)

- `camarão 5kg 450 no pix`, depois `/reply foi 400` → `✏️ Corrigido:` com R$ 400,00.
- Com dois itens na confirmação: `/reply foi 400` → pergunta qual; `/reply o 2 foi 400` → corrige só o 2.
- `desfazer` → `↩️ Desfeito:` do último lançamento; de novo → o anterior; quando acabar → "Não encontrei lançamento seu nas últimas 24 horas".
- Troque para o atendente (`/como 11987650003`) e responda a uma confirmação do dono com `/reply foi 10` → recusado ("só pode mexer nos lançamentos que você mesmo fez"). **Dica:** o `/reply` usa a última confirmação *recebida pelo usuário atual*, então faça o dono lançar, copie o texto e use o banco para conferir (`select * from entries`).
- `suporte` e `ajuda` respondem direto, sem IA.

Conferir no banco (docker): `select description, amount_cents, fee_cents, net_cents, version, deleted_at from entries order by created_at;` e `select action, channel, version from entry_versions order by changed_at;`.

## 5. Áudio (E9, RF13)

Precisa de `OPENAI_API_KEY` e do ffmpeg. Grave um áudio curto no celular ou no gravador do Windows (falando "camarão cinco quilos quatrocentos e cinquenta no pix") e salve como `.ogg`, `.opus`, `.mp3`, `.m4a` ou `.wav`.

- `/audio C:\caminho\nota.ogg` → deve vir `Entendi: "..."` seguido da confirmação.
- Áudio com mais de 3 minutos → "Seu áudio tem mais de 3 minutos" (sem gastar IA).
- Áudio sem fala → "Não consegui entender o áudio".
- Sem ffmpeg o worker tenta de novo e, ao esgotar, o chat mostra "Tive um problema e NÃO registrei essa mensagem".

**Não confirmado ainda:** o preço do `gpt-transcribe` e se a conversão com ffmpeg chega ao formato que a OpenAI aceita (testado só com um ffmpeg de mentira). Se a transcrição der erro, diga o código que o worker logar.

## 6. Foto de nota (E9, RF14)

- `/foto C:\caminho\cupom.jpg` (ou `.png`) com uma foto de cupom fiscal: a IA lê os itens e o sistema agrupa por categoria ("Atacadão – 8 itens"). Legenda opcional: `/foto cupom.jpg nota do mercado`.
- Se o cupom tiver QR legível, a chave de acesso é guardada: mandar **a mesma foto** de novo responde "Essa nota já foi registrada em dd/mm por Dono Demo." sem gastar IA. Confira: `select access_key, source, needs_recheck from fiscal_documents;`.
- Foto sem valores legíveis → "Não consegui ler os valores da nota, então não registrei nada".
- Foto que não é documento financeiro → recusa de fora de escopo.
- Imagem acima de 5 MB → "passou de 5 MB".

A consulta à SEFAZ **não existe ainda**: a nota é lida só pela IA e fica marcada `needs_recheck = true`.

## 7. Limite de uso (RF21)

Valores: 60 mensagens por usuário por hora e 1.000 por empresa por dia (`DEFAULT_USAGE_LIMITS` em `packages/core/src/media/limits.ts`). Para ver sem digitar 60 vezes, baixe o limite para 3 nessa constante, reinicie o worker e envie 5 mensagens: a 4ª recebe "Recebi muitas mensagens seguidas" e a 5ª não recebe nada. **Volte o valor para 60 depois.**

## 8. Evals (E8) e frases direto na IA (E6)

```powershell
pnpm --filter @app/ai extract                          # 13 frases de scripts/frases.txt, com custo por mensagem
pnpm --filter @app/ai extract "paguei 350 de carne"   # só a frase dada
pnpm --filter @app/ai eval                             # 39 casos (cerca de US$ 0,015), compara com baseline.json
pnpm --filter @app/ai eval -- --only=f01,m01 --verbose # só alguns casos, mostrando a saída bruta
```

O `eval` sai com erro se o acerto cair mais de 5 pontos em relação ao `baseline.json`. O 100% atual é otimista: os casos são inventados e o prompt foi ajustado olhando para eles. Troque por mensagens reais do Matheus, anonimizadas.

## 9. Testes automáticos (sem custo)

```powershell
pnpm typecheck; pnpm lint; pnpm test      # unitários
pnpm test:int                             # integração (Docker ligado): db e api
```
