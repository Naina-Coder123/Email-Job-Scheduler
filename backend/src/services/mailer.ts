import nodemailer, { Transporter } from "nodemailer";
import type { Sender } from "@prisma/client";

/**
 * Creates a brand new Ethereal (https://ethereal.email) fake-SMTP test
 * account. Used at seed/sender-creation time so each configured "sender"
 * in the app has its own independent inbox to send through.
 */
export async function createEtherealAccount() {
  const account = await nodemailer.createTestAccount();
  return {
    smtpHost: account.smtp.host,
    smtpPort: account.smtp.port,
    smtpUser: account.user,
    smtpPass: account.pass,
  };
}

// Transporters are cheap to keep around per sender; cache so we don't
// re-establish a TLS handshake for every single email.
const transporterCache = new Map<string, Transporter>();

function getTransporter(sender: Sender): Transporter {
  const cached = transporterCache.get(sender.id);
  if (cached) return cached;

  const transporter = nodemailer.createTransport({
    host: sender.smtpHost,
    port: sender.smtpPort,
    secure: sender.smtpPort === 465,
    auth: { user: sender.smtpUser, pass: sender.smtpPass },
  });
  transporterCache.set(sender.id, transporter);
  return transporter;
}

export interface SendMailResult {
  previewUrl: string | null;
  messageId: string;
}

export async function sendMail(
  sender: Sender,
  opts: { to: string; subject: string; html: string }
): Promise<SendMailResult> {
  const transporter = getTransporter(sender);
  const info = await transporter.sendMail({
    from: `"${sender.name}" <${sender.email}>`,
    to: opts.to,
    subject: opts.subject,
    html: opts.html,
  });
  const previewUrl = nodemailer.getTestMessageUrl(info) || null;
  return { previewUrl, messageId: info.messageId };
}
