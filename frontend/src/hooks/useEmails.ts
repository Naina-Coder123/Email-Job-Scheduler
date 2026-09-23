import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import type { EmailRecord } from "@/types";

const POLL_INTERVAL_MS = 8000;

function useEmailList(token: string | undefined, mode: "scheduled" | "sent", refreshKey: number) {
  const [items, setItems] = useState<EmailRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const load = useCallback(
    async (showLoading: boolean) => {
      if (!token) return;
      if (showLoading) setLoading(true);
      try {
        const res = mode === "scheduled" ? await api.getScheduled(token) : await api.getSent(token);
        setItems(res.items);
        setError(undefined);
      } catch (err) {
        setError(err instanceof ApiError ? err.message : "Failed to load emails");
      } finally {
        setLoading(false);
      }
    },
    [token, mode]
  );

  useEffect(() => {
    load(true);
    const interval = setInterval(() => load(false), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [load, refreshKey]);

  return { items, loading, error, refetch: () => load(false) };
}

export function useScheduledEmails(token: string | undefined, refreshKey: number) {
  return useEmailList(token, "scheduled", refreshKey);
}

export function useSentEmails(token: string | undefined, refreshKey: number) {
  return useEmailList(token, "sent", refreshKey);
}
