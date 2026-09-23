import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth, AuthedRequest } from "../middleware/requireAuth";
import { createEtherealAccount } from "../services/mailer";
import { env } from "../config/env";

const router = Router();

router.get("/", requireAuth, async (req: AuthedRequest, res) => {
  const senders = await prisma.sender.findMany({
    where: { userId: req.userId },
    orderBy: { createdAt: "asc" },
  });
  res.json({ senders: senders.map((s) => ({ ...s, smtpPass: undefined })) });
});

const createSenderSchema = z.object({
  name: z.string().min(1),
  hourlyLimit: z.number().int().positive().optional(),
});

// Creates a fresh Ethereal (fake-SMTP) inbox and registers it as a sender
// identity the user can pick from when composing.
router.post("/", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = createSenderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  try {
    const account = await createEtherealAccount();
    const sender = await prisma.sender.create({
      data: {
        userId: req.userId!,
        name: parsed.data.name,
        email: account.smtpUser,
        smtpHost: account.smtpHost,
        smtpPort: account.smtpPort,
        smtpUser: account.smtpUser,
        smtpPass: account.smtpPass,
        hourlyLimit: parsed.data.hourlyLimit ?? env.maxEmailsPerHourPerSender,
      },
    });
    res.status(201).json({ sender: { ...sender, smtpPass: undefined } });
  } catch (err) {
    res.status(502).json({ error: "Failed to create Ethereal test account", detail: String(err) });
  }
});

export default router;
