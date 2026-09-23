"use client";

import { Suspense, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Header } from "@/components/Header";
import { Tabs } from "@/components/Tabs";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { EmailTable } from "@/components/EmailTable";
import { ComposeModal } from "@/components/ComposeModal";
import { useScheduledEmails, useSentEmails } from "@/hooks/useEmails";
import { useToast } from "@/components/ui/Toast";
import { api, ApiError } from "@/lib/api";
import type { EmailRecord } from "@/types";

type TabId = "scheduled" | "sent";

export default function DashboardPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-slate-500">Loading…</div>}>
      <DashboardContent />
    </Suspense>
  );
}

function DashboardContent() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { notify } = useToast();

  const [tab, setTab] = useState<TabId>("scheduled");
  const [composeOpen, setComposeOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [slackConnected, setSlackConnected] = useState(false);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<EmailRecord[] | null>(null);
  const [searching, setSearching] = useState(false);

  const token = session?.backendToken;

  const scheduled = useScheduledEmails(token, refreshKey);
  const sent = useSentEmails(token, refreshKey);

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/");
  }, [status, router]);

  useEffect(() => {
    if (!token) return;
    api.getSlackStatus(token).then((r) => setSlackConnected(r.connected));
  }, [token]);

  useEffect(() => {
    const slackParam = searchParams.get("slack");
    if (slackParam === "connected") notify("Slack connected! You'll get alerts when a sender hits its rate limit.");
    if (slackParam === "denied") notify("Slack connection was cancelled.", "error");
    if (slackParam === "error") notify("Failed to connect Slack.", "error");
  }, [searchParams, notify]);

  async function handleSearch(q: string) {
    setQuery(q);
    if (!token) return;
    if (!q.trim()) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    try {
      const res = await api.searchEmails(token, q);
      setSearchResults(res.items);
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Search failed", "error");
    } finally {
      setSearching(false);
    }
  }

  if (status === "loading" || !token) {
    return <div className="flex min-h-screen items-center justify-center text-sm text-slate-500">Loading…</div>;
  }

  const active = tab === "scheduled" ? scheduled : sent;
  const displayed = searchResults !== null ? searchResults : active.items;

  return (
    <div className="min-h-screen bg-slate-50">
      <Header user={session.backendUser} />

      <main className="mx-auto max-w-6xl px-6 py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Emails</h1>
            <p className="text-sm text-slate-500">Schedule, track, and search your cold-email sends.</p>
          </div>
          <div className="flex items-center gap-3">
            {slackConnected ? (
              <span className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-700">
                ✓ Slack connected
              </span>
            ) : (
              <a href={api.slackConnectUrl(token)}>
                <Button variant="secondary">Connect Slack</Button>
              </a>
            )}
            <Button onClick={() => setComposeOpen(true)}>+ Compose new email</Button>
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
          <Tabs<TabId>
            tabs={[
              { id: "scheduled", label: "Scheduled emails" },
              { id: "sent", label: "Sent emails" },
            ]}
            active={tab}
            onChange={(t) => {
              setTab(t);
              setSearchResults(null);
              setQuery("");
            }}
          />
          <Input
            placeholder="Search subject or recipient…"
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            className="w-64"
          />
        </div>

        <EmailTable
          items={displayed}
          loading={searchResults === null ? active.loading : searching}
          error={active.error}
          mode={tab}
        />
      </main>

      <ComposeModal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        token={token}
        onScheduled={() => setRefreshKey((k) => k + 1)}
      />
    </div>
  );
}
