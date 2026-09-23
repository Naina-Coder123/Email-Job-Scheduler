// Combined entrypoint: runs the Express API and the BullMQ worker in a
// single process. Exists for free-tier hosting (e.g. Render's free Web
// Service) where only one always-on process is available and separate
// Background Worker / Redis service types require a paid plan.
//
// This is a hosting-cost concession, not the recommended production
// topology -- see the "Deployment" section of the README. In production
// (or on any plan that supports it) prefer running `index.ts` and
// `worker.ts` as separate processes/services so the worker can be scaled
// independently of API traffic.
import { env } from "./config/env";
import { createApp } from "./app";
import { ensureEmailIndex } from "./services/elasticsearch";
import { reconcileScheduledEmails } from "./queue/reconcile";
import { startEmailWorker } from "./queue/emailWorker";

async function main() {
  await ensureEmailIndex();
  await reconcileScheduledEmails();

  const app = createApp();
  app.listen(env.port, () => {
    console.log(`[standalone] API listening on http://localhost:${env.port}`);
    console.log(`[standalone] Bull Board at http://localhost:${env.port}/admin/queues`);
  });

  const worker = startEmailWorker();
  console.log(
    `[standalone] worker started in-process (concurrency=${env.workerConcurrency}, ` +
      `min delay between sends=${env.minDelayBetweenEmailsMs}ms)`
  );

  const shutdown = async () => {
    console.log("[standalone] shutting down gracefully...");
    await worker.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("[standalone] fatal startup error", err);
  process.exit(1);
});
