import { env } from "./config/env";
import { startEmailWorker } from "./queue/emailWorker";
import { reconcileScheduledEmails } from "./queue/reconcile";
import { ensureEmailIndex } from "./services/elasticsearch";

async function main() {
  await ensureEmailIndex();
  await reconcileScheduledEmails();

  const worker = startEmailWorker();
  console.log(
    `[worker] started with concurrency=${env.workerConcurrency}, ` +
      `min delay between sends=${env.minDelayBetweenEmailsMs}ms`
  );

  const shutdown = async () => {
    console.log("[worker] shutting down gracefully...");
    await worker.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[worker] fatal startup error", err);
  process.exit(1);
});
