export interface SimulatedTextMessage {
  /** Telefone do remetente como a Meta o informa (`from`/`wa_id`): E.164 sem o "+". */
  readonly waId: string;
  readonly waMessageId: string;
  readonly text: string;
  /** `wa_message_id` da mensagem nossa que o usuário está respondendo (`context.id`). */
  readonly replyToWaMessageId?: string;
  readonly profileName?: string;
  /** Momento da mensagem; vira `timestamp` em segundos, como na Meta. */
  readonly sentAt: Date;
}

const DISPLAY_PHONE_NUMBER = "15551234567";
const PHONE_NUMBER_ID = "100000000000001";

/**
 * Monta um payload de texto no formato real da Cloud API (o mesmo das fixtures de
 * `test/fixtures`). Serve ao chat de desenvolvimento, que o assina e envia ao nosso webhook,
 * e aos testes. Nunca é usado para enviar nada à Meta.
 */
export function buildTextWebhookPayload(input: SimulatedTextMessage): unknown {
  // A Meta envia `user_id` no formato `BR.<número>`; aqui é só um valor de mesma forma.
  const waUserId = `BR.${input.waId}`;
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "200000000000001",
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: DISPLAY_PHONE_NUMBER,
                phone_number_id: PHONE_NUMBER_ID,
              },
              contacts: [
                {
                  profile: { name: input.profileName ?? "Chat de desenvolvimento" },
                  wa_id: input.waId,
                },
              ],
              messages: [
                {
                  from: input.waId,
                  id: input.waMessageId,
                  timestamp: String(Math.floor(input.sentAt.getTime() / 1000)),
                  type: "text",
                  text: { body: input.text },
                  from_user_id: waUserId,
                  ...(input.replyToWaMessageId === undefined
                    ? {}
                    : {
                        context: { from: DISPLAY_PHONE_NUMBER, id: input.replyToWaMessageId },
                      }),
                },
              ],
            },
            field: "messages",
          },
        ],
      },
    ],
  };
}

export interface SimulatedMediaMessage {
  readonly waId: string;
  readonly waMessageId: string;
  readonly kind: "audio" | "image";
  /** Id da mídia na Meta; no chat de desenvolvimento, o nome do arquivo guardado. */
  readonly mediaId: string;
  readonly mimeType: string;
  /** Legenda da imagem (a Meta só a envia em imagem). */
  readonly caption?: string;
  readonly profileName?: string;
  readonly sentAt: Date;
}

type SimulatedEnvelope = {
  entry: [{ changes: [{ value: { messages: [Record<string, unknown>] } }] }];
};

/**
 * Payload de áudio ou imagem no formato real da Cloud API (mesmo das fixtures `audio-message` e
 * `image-message`). Só para o chat de desenvolvimento e os testes.
 */
export function buildMediaWebhookPayload(input: SimulatedMediaMessage): unknown {
  const payload = buildTextWebhookPayload({
    waId: input.waId,
    waMessageId: input.waMessageId,
    text: "",
    ...(input.profileName === undefined ? {} : { profileName: input.profileName }),
    sentAt: input.sentAt,
  }) as SimulatedEnvelope;
  const message = payload.entry[0].changes[0].value.messages[0];
  message.type = input.kind;
  delete message.text;
  message[input.kind] =
    input.kind === "audio"
      ? { mime_type: input.mimeType, sha256: "dev", id: input.mediaId, voice: true }
      : {
          mime_type: input.mimeType,
          sha256: "dev",
          id: input.mediaId,
          ...(input.caption === undefined ? {} : { caption: input.caption }),
        };
  return payload;
}
