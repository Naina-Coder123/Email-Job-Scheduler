import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";

export interface AuthedRequest extends Request {
  userId?: string;
}

export interface SessionTokenPayload {
  userId: string;
  email: string;
}

export function signSessionToken(payload: SessionTokenPayload): string {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: "7d" });
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  // Top-level browser navigations (e.g. the "Connect Slack" link, which
  // triggers a real redirect chain through slack.com) can't attach an
  // Authorization header, so those endpoints also accept the token as a
  // query param.
  const token = header?.startsWith("Bearer ")
    ? header.slice("Bearer ".length)
    : (req.query.token as string | undefined);
  if (!token) {
    return res.status(401).json({ error: "Missing Authorization bearer token" });
  }
  try {
    const decoded = jwt.verify(token, env.jwtSecret) as SessionTokenPayload;
    req.userId = decoded.userId;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired session token" });
  }
}
