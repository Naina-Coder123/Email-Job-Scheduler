import { prisma } from "../lib/prisma";
import { emailQueue, enqueueEmailJob } from "./emailQueue";

/**
 * Restart-persistence guarantee: on boot, look at every Email row still in
 * SCHEDULED state and make sure a BullMQ job exists for it. Redis (where
 * BullMQ keeps its delayed-job set) is normally persistent across restarts
 * on its own via AOF, so in the common case every job is still sitting
 * there waiting. This pass exists for the harder case -- Redis data lost,
 * a job was ack'd but the process died before enqueueing a follow-up -- so
 * that source of truth is always the Postgres row, never just the queue.
 *
 * Safe to call from multiple processes / multiple times: enqueueEmailJob
 * uses the Email's own id as the BullMQ jobId, so re-adding a job that's
 * already waiting/delayed/active is a no-op, never a duplicate.
 */
export async function reconcileScheduledEmails(): Promise<void> {
  const pending = await prisma.email.findMany({
    where: { status: "SCHEDULED" },
    select: { id: true, scheduledAt: true },
  });

  let reQueued = 0;
  for (const email of pending) {
    const existingJob = await emailQueue.getJob(email.id);
    if (!existingJob) {
      await enqueueEmailJob(email.id, email.scheduledAt);
      reQueued++;
    }
  }

  console.log(
    `[reconcile] ${pending.length} scheduled email(s) found in DB, ${reQueued} re-queued (rest already in BullMQ)`
  );
}
