import { prisma } from "../lib/prisma";

/**
 * Fires a live Slack message the moment a sender's hourly send limit is
 * hit. If the user hasn't connected Slack yet this silently no-ops (no
 * crash, no retry storm); if they connect later, the very next rate-limit
 * hit will start notifying with no redeploy needed since we look the
 * integration up fresh from the DB every time.
 */
export async function notifyRateLimitHit(userId: string, senderName: string, hourlyLimit: number) {
  const integration = await prisma.slackIntegration.findUnique({ where: { userId } });
  if (!integration) return;

  const text =
    `:warning: *Rate limit reached* for sender *${senderName}*.\n` +
    `Hourly cap of *${hourlyLimit}* emails/hour reached. Remaining emails for this sender ` +
    `have been rescheduled into the next hourly window automatically.`;

  try {
    const response = await fetch(integration.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) {
      console.error(`[slack] webhook responded ${response.status}: ${await response.text()}`);
    }
  } catch (err) {
    // Never let a Slack outage break the email pipeline.
    console.error("[slack] failed to deliver rate-limit notification", err);
  }
}
