"use client";

import { signOut } from "next-auth/react";
import type { BackendUser } from "@/types";

export function Header({ user }: { user?: BackendUser }) {
  return (
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
          RI
        </div>
        <span className="text-base font-semibold text-slate-900">Email Scheduler</span>
      </div>

      <div className="flex items-center gap-3">
        {user?.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.avatarUrl} alt={user.name ?? user.email} className="h-9 w-9 rounded-full" />
        ) : (
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-200 text-sm font-medium text-slate-600">
            {(user?.name ?? user?.email ?? "?").charAt(0).toUpperCase()}
          </div>
        )}
        <div className="hidden text-right sm:block">
          <p className="text-sm font-medium text-slate-900">{user?.name ?? "—"}</p>
          <p className="text-xs text-slate-500">{user?.email ?? ""}</p>
        </div>
        <button
          onClick={() => signOut({ callbackUrl: "/" })}
          className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          Logout
        </button>
      </div>
    </header>
  );
}
