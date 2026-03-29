import { env } from "@asp/config";
import { logger } from "@asp/logger";
import { createApp } from "./app";

const app = createApp();

app.listen(env.PORT, () => {
  logger.info({ port: env.PORT }, "API server listening");
});
