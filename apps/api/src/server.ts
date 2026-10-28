import { loadEnv } from "@app/config/env";
import { buildApp } from "./app";
import { compose } from "./composition";

const env = loadEnv();
// Logger provisório só para erros anteriores ao app existir.
let logError: (error: Error) => void = (error) => console.error(error);
const composition = await compose(env, (error) => logError(error));
const app = buildApp(env, composition.deps);
logError = (error) => app.log.error(error);

app.addHook("onClose", async () => {
  await composition.close();
});

try {
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}
