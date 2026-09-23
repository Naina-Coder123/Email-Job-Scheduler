import { Router } from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { requireAuth, AuthedRequest } from "../middleware/requireAuth";
import { extractEmailsFromFile } from "../services/csv";
import { enqueueEmailJobs } from "../queue/emailQueue";
import { searchEmailIds } from "../services/elasticsearch";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

router.post("/upload", requireAuth, upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded (field name must be 'file')" });
  const emails = extractEmailsFromFile(req.file.buffer);
  res.json({ emails, count: emails.length });
});

const scheduleSchema = z.object({
  subject: z.string().min(1),
  body: z.string().min(1),
  recipients: z.array(z.string().email()).min(1),
  startTime: z.string().datetime().or(z.string().min(1)),
  delayMs: z.number().int().min(0),
  hourlyLimit: z.number().int().positive(),
  senderIds: z.array(z.string().uuid()).min(1),
});

router.post("/schedule", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = scheduleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }
  const { subject, body, recipients, startTime, delayMs, hourlyLimit, senderIds } = parsed.data;

  const senders = await prisma.sender.findMany({
    where: { id: { in: senderIds }, userId: req.userId },
  });
  if (senders.length !== senderIds.length) {
    return res.status(400).json({ error: "One or more senderIds are invalid or not owned by this user" });
  }

  const start = new Date(startTime);
  if (Number.isNaN(start.getTime())) {
    return res.status(400).json({ error: "startTime is not a valid date" });
  }

  // The requested hourly limit is applied to every sender used in this
  // batch (a sender's cap is what the rate limiter actually enforces at
  // send time).
  await prisma.sender.updateMany({
    where: { id: { in: senderIds } },
    data: { hourlyLimit },
  });

  const batch = await prisma.emailBatch.create({
    data: {
      userId: req.userId!,
      subject,
      body,
      startTime: start,
      delayMs,
      hourlyLimit,
      totalCount: recipients.length,
    },
  });

  // Round-robin recipients across the chosen senders; stagger each send by
  // delayMs so the schedule already reflects the requested pacing even
  // before the worker's own rate limiter/min-delay kicks in at send time.
  const rows = recipients.map((toEmail, i) => ({
    id: randomUUID(),
    batchId: batch.id,
    userId: req.userId!,
    senderId: senderIds[i % senderIds.length],
    toEmail,
    subject,
    body,
    scheduledAt: new Date(start.getTime() + i * delayMs),
  }));

  await prisma.email.createMany({ data: rows });
  await enqueueEmailJobs(rows.map((r) => ({ id: r.id, scheduledAt: r.scheduledAt })));

  res.status(201).json({
    batch: { id: batch.id, totalCount: recipients.length },
  });
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(25),
});

router.get("/scheduled", requireAuth, async (req: AuthedRequest, res) => {
  const { page, limit } = listQuerySchema.parse(req.query);
  const where: Prisma.EmailWhereInput = { userId: req.userId, status: { in: ["SCHEDULED", "SENDING"] } };
  const [items, total] = await Promise.all([
    prisma.email.findMany({
      where,
      orderBy: { scheduledAt: "asc" },
      skip: (page - 1) * limit,
      take: limit,
      include: { sender: { select: { name: true, email: true } } },
    }),
    prisma.email.count({ where }),
  ]);
  res.json({ items, total, page, limit });
});

router.get("/sent", requireAuth, async (req: AuthedRequest, res) => {
  const { page, limit } = listQuerySchema.parse(req.query);
  const where: Prisma.EmailWhereInput = { userId: req.userId, status: { in: ["SENT", "FAILED"] } };
  const [items, total] = await Promise.all([
    prisma.email.findMany({
      where,
      orderBy: [{ sentAt: "desc" }, { updatedAt: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
      include: { sender: { select: { name: true, email: true } } },
    }),
    prisma.email.count({ where }),
  ]);
  res.json({ items, total, page, limit });
});

router.get("/search", requireAuth, async (req: AuthedRequest, res) => {
  const q = String(req.query.q ?? "");
  const result = await searchEmailIds(req.userId!, q);
  if (!result.available) {
    // Degrade gracefully: simple DB search so the feature still "works"
    // even if Elasticsearch isn't up.
    const items = await prisma.email.findMany({
      where: {
        userId: req.userId,
        OR: [
          { subject: { contains: q, mode: "insensitive" } },
          { toEmail: { contains: q, mode: "insensitive" } },
        ],
      },
      orderBy: { scheduledAt: "desc" },
      take: 100,
    });
    return res.json({ items, source: "postgres-fallback" });
  }
  const items = await prisma.email.findMany({ where: { id: { in: result.ids } } });
  // preserve ES relevance ordering
  const order = new Map(result.ids.map((id, i) => [id, i]));
  items.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  res.json({ items, source: "elasticsearch" });
});

export default router;
