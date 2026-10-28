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
