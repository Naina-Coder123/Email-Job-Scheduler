import { Router } from "express";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import { requireAuth, AuthedRequest } from "../middleware/requireAuth";

const router = Router();

function encodeState(userId: string): string {
  return Buffer.from(JSON.stringify({ userId, ts: Date.now() })).toString("base64url");
}

function decodeState(state: string): { userId: string } {
  const parsed = JSON.parse(Buffer.from(state, "base64url").toString("utf8"));
  if (!parsed?.userId) throw new Error("Invalid state");
  return parsed;
}

// Step 1: user clicks "Connect Slack" in the dashboard -> we redirect them
// into Slack's real OAuth authorize screen.
router.get("/connect", requireAuth, (req: AuthedRequest, res) => {
  if (!env.slackClientId) {
    return res.status(500).json({ error: "SLACK_CLIENT_ID is not configured on the backend" });
  }
  const state = encodeState(req.userId!);
  const url = new URL("https://slack.com/oauth/v2/authorize");
  url.searchParams.set("client_id", env.slackClientId);
  url.searchParams.set("scope", "incoming-webhook");
  url.searchParams.set("redirect_uri", env.slackRedirectUri);
  url.searchParams.set("state", state);
  res.redirect(url.toString());
});

// Step 2: Slack redirects back here with a one-time code. We exchange it
// for a real incoming-webhook URL + access token and persist it for the
// user, so future rate-limit hits can post to their workspace.
router.get("/callback", async (req, res) => {
  const { code, state, error } = req.query as Record<string, string | undefined>;
  const redirectBase = `${env.frontendUrl}/dashboard`;

  if (error) return res.redirect(`${redirectBase}?slack=denied`);
  if (!code || !state) return res.redirect(`${redirectBase}?slack=error`);

  try {
    const { userId } = decodeState(state);

    const tokenRes = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: env.slackClientId ?? "",
        client_secret: env.slackClientSecret ?? "",
        code,
        redirect_uri: env.slackRedirectUri,
      }),
    });
    interface SlackOAuthResponse {
      ok: boolean;
      access_token?: string;
      team?: { id?: string; name?: string };
      incoming_webhook?: { url?: string; channel?: string };
    }
    const data = (await tokenRes.json()) as SlackOAuthResponse;

    if (!data.ok || !data.incoming_webhook?.url) {
      console.error("[slack] oauth exchange failed", data);
      return res.redirect(`${redirectBase}?slack=error`);
    }

    await prisma.slackIntegration.upsert({
      where: { userId },
      update: {
        webhookUrl: data.incoming_webhook.url,
        accessToken: data.access_token ?? "",
        teamName: data.team?.name ?? null,
      },
      create: {
        userId,
        webhookUrl: data.incoming_webhook.url,
        accessToken: data.access_token ?? "",
        teamName: data.team?.name ?? null,
      },
    });

    return res.redirect(`${redirectBase}?slack=connected`);
  } catch (err) {
    console.error("[slack] callback error", err);
    return res.redirect(`${redirectBase}?slack=error`);
  }
});

router.get("/status", requireAuth, async (req: AuthedRequest, res) => {
  const integration = await prisma.slackIntegration.findUnique({ where: { userId: req.userId } });
  res.json({ connected: !!integration, teamName: integration?.teamName ?? null });
});

router.post("/disconnect", requireAuth, async (req: AuthedRequest, res) => {
  await prisma.slackIntegration.deleteMany({ where: { userId: req.userId } });
  res.json({ connected: false });
});

export default router;
