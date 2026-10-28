import { loadEnv } from "@app/config/env";
import { composeWorker } from "./composition";
import { createLogger } from "./infra/logger";

const env = loadEnv();
const logger = createLogger(env.LOG_LEVEL);
const { close } = await composeWorker(env, logger, (error) =>
  logger.error({ errorName: error.name }, "erro na fila"),
);

let closing = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    if (closing) return;
    closing = true;
    logger.info({ signal }, "encerrando worker: aguardando jobs em andamento");
    close().then(
      () => process.exit(0),
      (error: Error) => {
        logger.error({ errorName: error.name }, "falha ao encerrar worker");
        process.exit(1);
      },
    );
  });
}
