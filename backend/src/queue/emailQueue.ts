import { Queue } from "bullmq";
import { createRedisConnection } from "../lib/redis";
import { EMAIL_QUEUE_NAME } from "../config/env";
import { SendEmailJobData } from "../types";

export const emailQueue = new Queue<SendEmailJobData>(EMAIL_QUEUE_NAME, {
  connection: createRedisConnection(),
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: "exponential", delay: 5000 },
    removeOnComplete: { age: 60 * 60 * 24 * 7, count: 5000 },
    removeOnFail: { age: 60 * 60 * 24 * 30 },
  },
});

/**
 * Enqueues (or re-enqueues) the send job for an Email row.
 *
 * jobId === emailId is the idempotency key: BullMQ silently no-ops
 * `add()` calls that reuse an id already present in the queue/waiting/
 * delayed sets, so retrying this from an API request handler or from the
 * startup reconciliation pass can never create a duplicate job.
 */
export async function enqueueEmailJob(emailId: string, scheduledAt: Date): Promise<void> {
  const delay = Math.max(0, scheduledAt.getTime() - Date.now());
  await emailQueue.add(
    "send-email",
    { emailId },
    {
      jobId: emailId,
      delay,
    }
  );
}

/**
 * Bulk variant used when scheduling a whole batch (e.g. 1000+ recipients
 * from a CSV upload) so we make one round-trip to Redis instead of one per
 * email.
 */
export async function enqueueEmailJobs(items: { id: string; scheduledAt: Date }[]): Promise<void> {
  if (items.length === 0) return;
  await emailQueue.addBulk(
    items.map(({ id, scheduledAt }) => ({
      name: "send-email",
      data: { emailId: id },
      opts: { jobId: id, delay: Math.max(0, scheduledAt.getTime() - Date.now()) },
    }))
  );
}
