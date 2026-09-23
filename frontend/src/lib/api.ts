import type {
  EmailRecord,
  PaginatedResponse,
  ScheduleEmailPayload,
  Sender,
} from "@/types";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function request<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      Authorization: `Bearer ${token}`,
      ...init.headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(body.error ? JSON.stringify(body.error) : res.statusText, res.status);
  }
  return res.json() as Promise<T>;
}

export const api = {
  getSenders(token: string) {
    return request<{ senders: Sender[] }>(token, "/api/senders");
  },
  createSender(token: string, data: { name: string; hourlyLimit?: number }) {
    return request<{ sender: Sender }>(token, "/api/senders", {
      method: "POST",
      body: JSON.stringify(data),
    });
  },
  uploadRecipients(token: string, file: File) {
    const form = new FormData();
    form.append("file", file);
    return request<{ emails: string[]; count: number }>(token, "/api/emails/upload", {
      method: "POST",
      body: form,
    });
  },
  scheduleEmails(token: string, payload: ScheduleEmailPayload) {
    return request<{ batch: { id: string; totalCount: number } }>(token, "/api/emails/schedule", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  getScheduled(token: string, page = 1, limit = 25) {
    return request<PaginatedResponse<EmailRecord>>(token, `/api/emails/scheduled?page=${page}&limit=${limit}`);
  },
  getSent(token: string, page = 1, limit = 25) {
    return request<PaginatedResponse<EmailRecord>>(token, `/api/emails/sent?page=${page}&limit=${limit}`);
  },
  searchEmails(token: string, q: string) {
    return request<{ items: EmailRecord[]; source: string }>(token, `/api/emails/search?q=${encodeURIComponent(q)}`);
  },
  getSlackStatus(token: string) {
    return request<{ connected: boolean; teamName: string | null }>(token, "/api/slack/status");
  },
  disconnectSlack(token: string) {
    return request<{ connected: boolean }>(token, "/api/slack/disconnect", { method: "POST" });
  },
  slackConnectUrl(token: string) {
    return `${API_URL}/api/slack/connect?token=${encodeURIComponent(token)}`;
  },
};
