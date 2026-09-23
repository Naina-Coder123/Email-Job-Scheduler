import express from "express";
import cors from "cors";
import { env } from "./config/env";
import authRoutes from "./routes/auth";
import senderRoutes from "./routes/senders";
import emailRoutes from "./routes/emails";
import slackRoutes from "./routes/slack";
import { createBullBoardRouter } from "./queue/bullBoard";

export function createApp() {
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

  return app;
}
