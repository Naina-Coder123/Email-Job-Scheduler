import { parse } from "csv-parse/sync";

const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

/**
 * Accepts either a proper CSV (with or without headers, email in any
 * column) or a plain newline/comma separated list of addresses and
 * returns the deduped, validated set of email addresses found in it.
 */
export function extractEmailsFromFile(buffer: Buffer): string[] {
  const text = buffer.toString("utf8");
  const found = new Set<string>();

  try {
    const records: string[][] = parse(text, {
      skip_empty_lines: true,
      relax_column_count: true,
    });
    for (const row of records) {
      for (const cell of row) {
        for (const match of cell.match(EMAIL_REGEX) ?? []) {
          found.add(match.toLowerCase());
        }
      }
    }
  } catch {
    // Not valid CSV - fall through to plain-text regex extraction below.
  }

  if (found.size === 0) {
    for (const match of text.match(EMAIL_REGEX) ?? []) {
      found.add(match.toLowerCase());
    }
  }

  return Array.from(found);
}
