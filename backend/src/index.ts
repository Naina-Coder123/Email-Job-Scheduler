import { env } from "./config/env";
import { createApp } from "./app";
import { ensureEmailIndex } from "./services/elasticsearch";
import { reconcileScheduledEmails } from "./queue/reconcile";

async function main() {
  await ensureEmailIndex();
  // Runs on API boot too (not just the worker process) so a fresh restart
  // of just the API container still guarantees every SCHEDULED email has a
  // live BullMQ job, without waiting on the worker to come up first.
  await reconcileScheduledEmails();

  const app = createApp();
  app.listen(env.port, () => {
    console.log(`[api] listening on http://localhost:${env.port}`);
    console.log(`[api] Bull Board dashboard at http://localhost:${env.port}/admin/queues`);
  });
}

main().catch((err) => {
  console.error("[api] fatal startup error", err);
  process.exit(1);
});
