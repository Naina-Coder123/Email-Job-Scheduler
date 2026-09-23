import { Worker, DelayedError, Job } from "bullmq";
import { createRedisConnection } from "../lib/redis";
import { EMAIL_QUEUE_NAME, env } from "../config/env";
import { prisma } from "../lib/prisma";
import { sendMail } from "../services/mailer";
import { indexEmail } from "../services/elasticsearch";
import { tryReserveSendSlot, shouldNotifySlackForWindow, nextHourWindow } from "./rateLimiter";
import { notifyRateLimitHit } from "../services/slack";
import { SendEmailJobData } from "../types";

export function startEmailWorker(): Worker<SendEmailJobData> {
  const worker = new Worker<SendEmailJobData>(
    EMAIL_QUEUE_NAME,
    async (job: Job<SendEmailJobData>, token?: string) => {
      const email = await prisma.email.findUnique({
        where: { id: job.data.emailId },
        include: { sender: true },
      });

      if (!email) {
        console.warn(`[worker] email ${job.data.emailId} no longer exists, skipping`);
        return;
      }

      // Idempotency: once an email has actually been sent it must never be
      // sent again, even if this job somehow gets reprocessed (stalled-job
      // recovery after a crash, a duplicate enqueue during reconciliation).
      if (email.status === "SENT") {
        console.log(`[worker] email ${email.id} already SENT, skipping duplicate job`);
        return;
      }

      // --- Hourly rate limit (Redis-backed, safe across worker instances) ---
      const allowed = await tryReserveSendSlot(email.senderId, email.sender.hourlyLimit);
      if (!allowed) {
        const delayUntil = nextHourWindow();
        console.log(
          `[worker] sender ${email.sender.name} hit its ${email.sender.hourlyLimit}/hr cap, ` +
            `deferring email ${email.id} to ${new Date(delayUntil).toISOString()}`
        );
        if (await shouldNotifySlackForWindow(email.senderId)) {
          void notifyRateLimitHit(email.userId, email.sender.name, email.sender.hourlyLimit);
        }
        if (token) {
          // Re-delay the job instead of failing/dropping it. Jobs keep their
          // original relative ordering because they all get pushed to the
          // same next-hour timestamp and BullMQ's delayed set is ordered by
          // that timestamp then insertion.
          await job.moveToDelayed(delayUntil, token);
          throw new DelayedError();
        }
        // No token (e.g. invoked outside a real worker context) - just bail,
        // the row stays SCHEDULED and will be picked up by reconciliation.
        return;
      }

      await prisma.email.update({ where: { id: email.id }, data: { status: "SENDING" } });

      try {
        const result = await sendMail(email.sender, {
          to: email.toEmail,
          subject: email.subject,
          html: email.body,
        });
        const updated = await prisma.email.update({
          where: { id: email.id },
          data: { status: "SENT", sentAt: new Date(), previewUrl: result.previewUrl },
        });
        await indexEmail(updated);
      } catch (err) {
        const updated = await prisma.email.update({
          where: { id: email.id },
          data: {
            status: "FAILED",
            error: err instanceof Error ? err.message : String(err),
            attempts: { increment: 1 },
          },
        });
        await indexEmail(updated);
        // Re-throw so BullMQ applies its attempts/backoff policy. On the
        // next attempt this same processor runs again; since status is
        // FAILED (not SENT) it will retry the send.
        throw err;
      }
    },
    {
      connection: createRedisConnection(),
      concurrency: env.workerConcurrency,
      // Enforces the minimum spacing between two email *sends* starting,
      // globally across every worker process reading this queue (the limit
      // is tracked in Redis, not in-process memory).
      limiter: { max: 1, duration: env.minDelayBetweenEmailsMs },
    }
  );

  worker.on("failed", (job, err) => {
    console.error(`[worker] job ${job?.id} failed permanently:`, err.message);
  });
  worker.on("error", (err) => {
    console.error("[worker] internal error:", err);
  });

  return worker;
}
