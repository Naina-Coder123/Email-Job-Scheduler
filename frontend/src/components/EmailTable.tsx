import type { EmailRecord } from "@/types";
import { StatusBadge } from "@/components/ui/Badge";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/EmptyState";

interface EmailTableProps {
  items: EmailRecord[];
  loading: boolean;
  error?: string;
  mode: "scheduled" | "sent";
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function EmailTable({ items, loading, error, mode }: EmailTableProps) {
  if (loading) return <LoadingState label={`Loading ${mode} emails…`} />;
  if (error) return <ErrorState message={error} />;
  if (items.length === 0) {
    return (
      <EmptyState
        title={mode === "scheduled" ? "No scheduled emails yet" : "No sent emails yet"}
        description={
          mode === "scheduled"
            ? "Compose a new email to see it show up here."
            : "Once your scheduled emails go out, they'll appear here."
        }
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            <th className="px-4 py-3 text-left font-medium text-slate-500">Email</th>
            <th className="px-4 py-3 text-left font-medium text-slate-500">Subject</th>
            <th className="px-4 py-3 text-left font-medium text-slate-500">Sender</th>
            <th className="px-4 py-3 text-left font-medium text-slate-500">
              {mode === "scheduled" ? "Scheduled time" : "Sent time"}
            </th>
            <th className="px-4 py-3 text-left font-medium text-slate-500">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {items.map((item) => (
            <tr key={item.id} className="hover:bg-slate-50">
              <td className="px-4 py-3 text-slate-900">{item.toEmail}</td>
              <td className="max-w-xs truncate px-4 py-3 text-slate-700">{item.subject}</td>
              <td className="px-4 py-3 text-slate-500">{item.sender?.name ?? "—"}</td>
              <td className="px-4 py-3 text-slate-500">
                {formatDate(mode === "scheduled" ? item.scheduledAt : item.sentAt ?? item.scheduledAt)}
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={item.status} />
                {item.previewUrl && (
                  <a
                    href={item.previewUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-2 text-xs font-medium text-brand-600 hover:underline"
                  >
                    Preview
                  </a>
                )}
                {item.error && <p className="mt-0.5 max-w-xs truncate text-xs text-red-500">{item.error}</p>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
