"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type ActivitySummary = {
  id: string;
  title: string;
  status?: "DRAFT" | "PUBLISHED" | string;
  time_limit_seconds?: number | null;
  created_at: string;
};

function requireActivitiesApi() {
  const api = (window as any)?.codemm?.activities;
  if (!api) throw new Error("IDE bridge unavailable. Launch this UI inside Codemm-IDE.");
  return api;
}

function formatTs(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString();
}

export default function ActivitiesPage() {
  const [items, setItems] = useState<ActivitySummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(limit: number = 100) {
    setLoading(true);
    setError(null);
    try {
      const data = await requireActivitiesApi().list({ limit });
      setItems(Array.isArray(data?.activities) ? (data.activities as ActivitySummary[]) : []);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load activities.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-4 px-6 py-8">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Your activities</h1>
          <div className="text-sm text-slate-500">Local-only drafts you generated in this workspace.</div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
            disabled={loading}
          >
            {loading ? "Loading..." : "Refresh"}
          </button>
          <Link
            href="/"
            className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            Back
          </Link>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>
      )}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        {items.length === 0 && !loading ? (
          <div className="px-5 py-6 text-sm text-slate-600">
            No activities yet. Go back and click <span className="font-semibold">Generate</span>.
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {items.map((a) => (
              <div key={a.id} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-900">{a.title || "Untitled activity"}</div>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                    <div>Status: {a.status || "DRAFT"}</div>
                    <div>Created: {formatTs(a.created_at)}</div>
                    {typeof a.time_limit_seconds === "number" ? <div>Timer: {a.time_limit_seconds}s</div> : null}
                    <div className="truncate">ID: {a.id}</div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Link
                    href={`/activity/${a.id}`}
                    className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-black"
                  >
                    Practice
                  </Link>
                  <Link
                    href={`/activity/${a.id}/review`}
                    className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                  >
                    Review
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

