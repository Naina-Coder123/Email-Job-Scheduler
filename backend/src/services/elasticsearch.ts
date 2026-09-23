import { Client } from "@elastic/elasticsearch";
import { env } from "../config/env";
import type { Email } from "@prisma/client";

const client = new Client({ node: env.elasticsearchNode });
const INDEX = env.elasticsearchIndex;

let esAvailable = false;

/**
 * Elasticsearch is a nice-to-have for search, not a hard dependency for
 * sending/scheduling emails. If it's unreachable (not started, still
 * booting, etc.) we log once and degrade gracefully everywhere else
 * instead of taking down the API or the worker.
 */
export async function ensureEmailIndex(): Promise<void> {
  try {
    const exists = await client.indices.exists({ index: INDEX });
    if (!exists) {
      await client.indices.create({
        index: INDEX,
        mappings: {
          properties: {
            userId: { type: "keyword" },
            senderId: { type: "keyword" },
            toEmail: { type: "keyword" },
            subject: { type: "text" },
            body: { type: "text" },
            status: { type: "keyword" },
            scheduledAt: { type: "date" },
            sentAt: { type: "date" },
          },
        },
      });
    }
    esAvailable = true;
    console.log(`[elasticsearch] connected, index "${INDEX}" ready`);
  } catch (err) {
    esAvailable = false;
    console.warn(
      `[elasticsearch] unavailable at ${env.elasticsearchNode} - search endpoint will return empty results until it's reachable.`,
      err instanceof Error ? err.message : err
    );
  }
}

export async function indexEmail(email: Email): Promise<void> {
  if (!esAvailable) return;
  try {
    await client.index({
      index: INDEX,
      id: email.id,
      document: {
        userId: email.userId,
        senderId: email.senderId,
        toEmail: email.toEmail,
        subject: email.subject,
        body: email.body,
        status: email.status,
        scheduledAt: email.scheduledAt,
        sentAt: email.sentAt,
      },
    });
  } catch (err) {
    console.error("[elasticsearch] failed to index email", email.id, err);
  }
}

export interface SearchResult {
  available: boolean;
  ids: string[];
}

export async function searchEmailIds(userId: string, query: string): Promise<SearchResult> {
  if (!esAvailable) return { available: false, ids: [] };
  try {
    const result = await client.search({
      index: INDEX,
      query: {
        bool: {
          filter: [{ term: { userId } }],
          must: query
            ? [
                {
                  multi_match: {
                    query,
                    fields: ["subject^2", "body", "toEmail"],
                  },
                },
              ]
            : [{ match_all: {} }],
        },
      },
      size: 100,
      sort: [{ scheduledAt: { order: "desc" } }],
    });
    return { available: true, ids: result.hits.hits.map((hit) => hit._id as string) };
  } catch (err) {
    console.error("[elasticsearch] search failed", err);
    return { available: false, ids: [] };
  }
}

export function isElasticsearchAvailable(): boolean {
  return esAvailable;
}
