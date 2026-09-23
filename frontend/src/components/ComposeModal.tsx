"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";
import { api, ApiError } from "@/lib/api";
import type { Sender } from "@/types";

interface ComposeModalProps {
  open: boolean;
  onClose: () => void;
  token: string;
  onScheduled: () => void;
}

function defaultStartTime(): string {
  const d = new Date(Date.now() + 5 * 60 * 1000);
  d.setSeconds(0, 0);
  // format for <input type="datetime-local">
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function ComposeModal({ open, onClose, token, onScheduled }: ComposeModalProps) {
  const { notify } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [recipients, setRecipients] = useState<string[]>([]);
  const [manualEmails, setManualEmails] = useState("");
  const [startTime, setStartTime] = useState(defaultStartTime());
  const [delayMs, setDelayMs] = useState(2000);
  const [hourlyLimit, setHourlyLimit] = useState(200);

  const [senders, setSenders] = useState<Sender[]>([]);
  const [selectedSenderIds, setSelectedSenderIds] = useState<string[]>([]);
  const [newSenderName, setNewSenderName] = useState("");

  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [creatingSender, setCreatingSender] = useState(false);

  useEffect(() => {
    if (!open) return;
    api
      .getSenders(token)
      .then((res) => {
        setSenders(res.senders);
        setSelectedSenderIds(res.senders.map((s) => s.id));
      })
      .catch(() => notify("Failed to load senders", "error"));
  }, [open, token, notify]);

  if (!open) return null;

  const manualParsed = manualEmails
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter((s) => /.+@.+\..+/.test(s));

  const totalRecipients = Array.from(new Set([...recipients, ...manualParsed]));

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const res = await api.uploadRecipients(token, file);
      setRecipients(res.emails);
      notify(`Detected ${res.count} email address${res.count === 1 ? "" : "es"} in ${file.name}`);
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Failed to parse file", "error");
    } finally {
      setUploading(false);
    }
  }

  async function handleCreateSender() {
    if (!newSenderName.trim()) return;
    setCreatingSender(true);
    try {
      const res = await api.createSender(token, { name: newSenderName.trim(), hourlyLimit });
      setSenders((prev) => [...prev, res.sender]);
      setSelectedSenderIds((prev) => [...prev, res.sender.id]);
      setNewSenderName("");
      notify(`Created sender "${res.sender.name}" (${res.sender.email})`);
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Failed to create sender", "error");
    } finally {
      setCreatingSender(false);
    }
  }

  function toggleSender(id: string) {
    setSelectedSenderIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  async function handleSubmit() {
    if (!subject.trim() || !body.trim()) return notify("Subject and body are required", "error");
    if (totalRecipients.length === 0) return notify("Add at least one recipient", "error");
    if (selectedSenderIds.length === 0) return notify("Select at least one sender", "error");

    setSubmitting(true);
    try {
      const res = await api.scheduleEmails(token, {
        subject,
        body,
        recipients: totalRecipients,
        startTime: new Date(startTime).toISOString(),
        delayMs,
        hourlyLimit,
        senderIds: selectedSenderIds,
      });
      notify(`Scheduled ${res.batch.totalCount} email(s)`);
      onScheduled();
      onClose();
      resetForm();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Failed to schedule emails", "error");
    } finally {
      setSubmitting(false);
    }
  }

  function resetForm() {
    setSubject("");
    setBody("");
    setRecipients([]);
    setManualEmails("");
    setStartTime(defaultStartTime());
    setDelayMs(2000);
    setHourlyLimit(200);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Compose new email"
      wide
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? "Scheduling…" : "Schedule"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input label="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Quick question about..." />
        <Textarea
          label="Body"
          rows={5}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Hi {{name}}, ..."
        />

        <div className="rounded-lg border border-dashed border-slate-300 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-700">Recipients</p>
              <p className="text-xs text-slate-400">Upload a CSV / text file of leads, or paste addresses below.</p>
            </div>
            <label className="cursor-pointer rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50">
              {uploading ? "Uploading…" : "Upload file"}
              <input ref={fileInputRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFile} />
            </label>
          </div>
          <Textarea
            className="mt-3"
            rows={2}
            placeholder="or paste emails separated by comma / newline"
            value={manualEmails}
            onChange={(e) => setManualEmails(e.target.value)}
          />
          <p className="mt-2 text-xs font-medium text-brand-700">
            {totalRecipients.length} email address{totalRecipients.length === 1 ? "" : "es"} detected
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Input
            label="Start time"
            type="datetime-local"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
          <Input
            label="Delay between emails (ms)"
            type="number"
            min={0}
            value={delayMs}
            onChange={(e) => setDelayMs(Number(e.target.value))}
          />
          <Input
            label="Hourly limit / sender"
            type="number"
            min={1}
            value={hourlyLimit}
            onChange={(e) => setHourlyLimit(Number(e.target.value))}
          />
        </div>

        <div className="rounded-lg border border-slate-200 p-4">
          <p className="mb-2 text-sm font-medium text-slate-700">Send from</p>
          <div className="flex flex-col gap-2">
            {senders.map((s) => (
              <label key={s.id} className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={selectedSenderIds.includes(s.id)}
                  onChange={() => toggleSender(s.id)}
                  className="rounded border-slate-300"
                />
                {s.name} <span className="text-slate-400">({s.email})</span>
              </label>
            ))}
            {senders.length === 0 && <p className="text-xs text-slate-400">No senders yet — create one below.</p>}
          </div>
          <div className="mt-3 flex gap-2">
            <Input
              placeholder="New sender name (e.g. Sales)"
              value={newSenderName}
              onChange={(e) => setNewSenderName(e.target.value)}
              className="flex-1"
            />
            <Button variant="secondary" onClick={handleCreateSender} disabled={creatingSender}>
              {creatingSender ? "Creating…" : "+ Add sender"}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
