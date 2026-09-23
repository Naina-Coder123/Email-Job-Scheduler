export interface BackendUser {
  id: string;
  email: string;
  name?: string | null;
  avatarUrl?: string | null;
}

export interface Sender {
  id: string;
  name: string;
  email: string;
  hourlyLimit: number;
  createdAt: string;
}

export type EmailStatus = "SCHEDULED" | "SENDING" | "SENT" | "FAILED";

export interface EmailRecord {
  id: string;
  toEmail: string;
  subject: string;
  body: string;
  status: EmailStatus;
  scheduledAt: string;
  sentAt: string | null;
  error: string | null;
  previewUrl: string | null;
  sender: { name: string; email: string };
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface ScheduleEmailPayload {
  subject: string;
  body: string;
  recipients: string[];
  startTime: string;
  delayMs: number;
  hourlyLimit: number;
  senderIds: string[];
}
