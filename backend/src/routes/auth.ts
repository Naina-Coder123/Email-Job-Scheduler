import { Router } from "express";
import { z } from "zod";
import { verifyGoogleIdToken, upsertGoogleUser } from "../services/googleAuth";
import { signSessionToken, requireAuth, AuthedRequest } from "../middleware/requireAuth";
import { prisma } from "../lib/prisma";

const router = Router();

const googleLoginSchema = z.object({ idToken: z.string().min(10) });

// Real Google OAuth verification: the frontend performs the actual Google
// sign-in consent screen via NextAuth and hands us the resulting ID token,
// which we cryptographically verify server-side before trusting it.
router.post("/google", async (req, res) => {
  const parsed = googleLoginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "idToken is required" });
  }
  try {
    const profile = await verifyGoogleIdToken(parsed.data.idToken);
    const user = await upsertGoogleUser(profile);
    const token = signSessionToken({ userId: user.id, email: user.email });
    res.json({
      token,
      user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl },
    });
  } catch (err) {
    res.status(401).json({ error: err instanceof Error ? err.message : "Google verification failed" });
  }
});

router.get("/me", requireAuth, async (req: AuthedRequest, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.userId } });
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ user: { id: user.id, email: user.email, name: user.name, avatarUrl: user.avatarUrl } });
});

export default router;
