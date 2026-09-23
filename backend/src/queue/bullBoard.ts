import { Router } from "express";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { emailQueue } from "./emailQueue";
import { env } from "../config/env";

/**
 * Live BullMQ dashboard for real-time queue visibility (waiting / active /
 * delayed / completed / failed jobs), mounted at /admin/queues and
 * protected by HTTP basic auth so it isn't left wide open.
 */
export function createBullBoardRouter(): Router {
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath("/admin/queues");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const adapter = new BullMQAdapter(emailQueue) as any;
  createBullBoard({
    // Cast needed: @bull-board/api's BaseAdapter typing lags behind the
    // BullMQ Job.progress type across minor versions.
    queues: [adapter],
    serverAdapter,
  });

  const router = Router();
  router.use((req, res, next) => {
    const header = req.headers.authorization;
    if (header?.startsWith("Basic ")) {
      const [user, pass] = Buffer.from(header.slice(6), "base64").toString("utf8").split(":");
      if (user === env.bullBoardUser && pass === env.bullBoardPassword) return next();
    }
    res.set("WWW-Authenticate", 'Basic realm="Bull Board"');
    res.status(401).send("Authentication required");
  });
  router.use(serverAdapter.getRouter());
  return router;
}
