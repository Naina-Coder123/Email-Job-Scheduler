export interface SendEmailJobData {
  emailId: string;
}

export interface ScheduleEmailRequest {
  subject: string;
  body: string;
  recipients: string[];
  startTime: string; // ISO date string
  delayMs: number; // spacing between two consecutive sends
  hourlyLimit: number; // desired cap per sender per hour (also stored on Sender)
  senderIds: string[]; // pool of senders to round-robin across
}
