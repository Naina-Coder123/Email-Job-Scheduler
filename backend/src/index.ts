import express from "express";
import cors from "cors";
import { env } from "./config/env";
import authRoutes from "./routes/auth";
import senderRoutes from "./routes/senders";
import emailRoutes from "./routes/emails";
import slackRoutes from "./routes/slack";
import { createBullBoardRouter } from "./queue/bullBoard";
import { ensureEmailIndex } from "./services/elasticsearch";
import { reconcileScheduledEmails } from "./queue/reconcile";

const app = express();

app.use(cors({ origin: env.frontendUrl, credentials: true }));
app.use(express.json({ limit: "2mb" }));

app.get("/healthz", (_req, res) => res.json({ ok: true }));

app.use("/api/auth", authRoutes);
app.use("/api/senders", senderRoutes);
app.use("/api/emails", emailRoutes);
app.use("/api/slack", slackRoutes);
app.use("/admin/queues", createBullBoardRouter());

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[api] unhandled error", err);
  res.status(500).json({ error: "Internal server error" });
});

async function main() {
  await ensureEmailIndex();
  // Runs on API boot too (not just the worker process) so a fresh restart
  // of just the API container still guarantees every SCHEDULED email has a
  // live BullMQ job, without waiting on the worker to come up first.
  await reconcileScheduledEmails();

  app.listen(env.port, () => {
    console.log(`[api] listening on http://localhost:${env.port}`);
    console.log(`[api] Bull Board dashboard at http://localhost:${env.port}/admin/queues`);
  });
}

main().catch((err) => {
  console.error("[api] fatal startup error", err);
  process.exit(1);
});
