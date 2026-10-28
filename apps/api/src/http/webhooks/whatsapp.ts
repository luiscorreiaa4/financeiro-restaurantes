import { isValidSignature, verifyHandshake } from "@app/whatsapp";
import type { FastifyError, FastifyPluginAsync } from "fastify";
import type { IngestWebhook } from "../../modules/inbound/ingest-webhook";

/** A Meta manda até 3 MB por POST; folga acima disso (o padrão do Fastify é 1 MiB). */
export const WEBHOOK_BODY_LIMIT = 4 * 1024 * 1024;

export interface WhatsAppWebhookDeps {
  /** Ausente em dev até a conta da Meta existir: a rota responde 503, nunca aceita sem checar. */
  readonly appSecret: string | undefined;
  readonly verifyToken: string | undefined;
  readonly ingest: IngestWebhook;
}

/**
 * Rotas finas: valida, delega ao caso de uso e responde. O parser de JSON é trocado só neste
 * plugin para entregar os bytes brutos, que são o que a assinatura cobre.
 */
export const whatsappWebhookRoutes: FastifyPluginAsync<{ deps: WhatsAppWebhookDeps }> = async (
  app,
  { deps },
) => {
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser(
    "application/json",
    { parseAs: "buffer", bodyLimit: WEBHOOK_BODY_LIMIT },
    (_request, body, done) => done(null, body),
  );

  // Erros do banco (Drizzle) trazem o SQL com os parâmetros, ou seja, o texto da mensagem do
  // usuário. Logamos só nome e código (regra 9); o status HTTP original é preservado.
  app.setErrorHandler((error: FastifyError, request, reply) => {
    const statusCode = error.statusCode ?? 500;
    request.log.error({ errorName: error.name, errorCode: error.code }, "falha no webhook");
    return reply.code(statusCode).send();
  });

  app.get("/webhooks/whatsapp", async (request, reply) => {
    if (deps.verifyToken === undefined) return reply.code(503).send();
    const result = verifyHandshake({
      query: request.query as Record<string, unknown>,
      verifyToken: deps.verifyToken,
    });
    if (!result.ok) return reply.code(403).send();
    // texto puro: o challenge é ecoado como veio, sem ser interpretado como HTML.
    return reply.code(200).type("text/plain").send(result.challenge);
  });

  app.post("/webhooks/whatsapp", { bodyLimit: WEBHOOK_BODY_LIMIT }, async (request, reply) => {
    if (deps.appSecret === undefined) return reply.code(503).send();
    const rawBody = request.body as Buffer;
    const header = request.headers["x-hub-signature-256"];
    const signature = Array.isArray(header) ? header[0] : header;
    if (!isValidSignature({ rawBody, header: signature, appSecret: deps.appSecret })) {
      request.log.warn("webhook com assinatura inválida");
      return reply.code(401).send();
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return reply.code(400).send();
    }

    // Se a gravação ou a fila falhar, o erro vira 500 e a Meta reenvia (idempotente).
    const result = await deps.ingest(payload);
    request.log.info(result, "webhook processado");
    return reply.code(200).send({ ok: true });
  });
};
