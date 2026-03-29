import { NativeConnection, Worker } from "@temporalio/worker";
import { env } from "@asp/config";
import { logger } from "@asp/logger";
import * as activities from "./activities";

async function run() {
  const connection = await NativeConnection.connect({
    address: env.TEMPORAL_ADDRESS
  });

  const worker = await Worker.create({
    connection,
    namespace: env.TEMPORAL_NAMESPACE,
    taskQueue: env.TEMPORAL_TASK_QUEUE,
    workflowsPath: require.resolve("./workflows"),
    activities
  });

  logger.info("Temporal worker started");
  await worker.run();
}

run().catch((error) => {
  logger.error({ err: error }, "Temporal worker crashed");
  process.exit(1);
});
