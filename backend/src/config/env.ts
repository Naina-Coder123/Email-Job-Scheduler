import "dotenv/config";

function num(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && value !== undefined && value !== "" ? n : fallback;
}

export const env = {
  port: num(process.env.PORT, 4000),
  nodeEnv: process.env.NODE_ENV ?? "development",
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:3000",

  databaseUrl: process.env.DATABASE_URL ?? "",

  redisHost: process.env.REDIS_HOST ?? "localhost",
  redisPort: num(process.env.REDIS_PORT, 6379),
  redisPassword: process.env.REDIS_PASSWORD || undefined,

  workerConcurrency: num(process.env.WORKER_CONCURRENCY, 5),
  minDelayBetweenEmailsMs: num(process.env.MIN_DELAY_BETWEEN_EMAILS_MS, 2000),
  maxEmailsPerHourPerSender: num(process.env.MAX_EMAILS_PER_HOUR_PER_SENDER, 200),

  etherealUser: process.env.ETHEREAL_USER || undefined,
  etherealPass: process.env.ETHEREAL_PASS || undefined,

  elasticsearchNode: process.env.ELASTICSEARCH_NODE ?? "http://localhost:9200",
  elasticsearchIndex: process.env.ELASTICSEARCH_INDEX ?? "emails",

  jwtSecret: process.env.JWT_SECRET ?? "change-me-in-production",

  googleClientId: process.env.GOOGLE_CLIENT_ID || undefined,

  slackClientId: process.env.SLACK_CLIENT_ID || undefined,
  slackClientSecret: process.env.SLACK_CLIENT_SECRET || undefined,
  slackRedirectUri: process.env.SLACK_REDIRECT_URI ?? "http://localhost:4000/api/slack/callback",

  bullBoardUser: process.env.BULL_BOARD_USER ?? "admin",
  bullBoardPassword: process.env.BULL_BOARD_PASSWORD ?? "admin",
};

export const EMAIL_QUEUE_NAME = "email-send-queue";
