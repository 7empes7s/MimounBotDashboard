"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type ActivityEvent = {
  ts: string;
  tsMs: number;
  role: string;
  summary: string;
  toolName?: string;
};

type ActivityStatus = {
  state: "active" | "idle" | "unknown";
  lastEventTs: string | null;
  lastEventMs: number | null;
  sessionId: string | null;
  agent: string | null;
  model: string | null;
  recentEvents: ActivityEvent[];
  source: string;
};

type ApiState<T> =
  | { status: "loading" }
  | { status: "ok"; data: T }
  | { status: "error"; error: string };

function timeAgo(ts?: string | number | null) {
  if (!ts) return "—";
  const t = typeof ts === "number" ? ts : new Date(ts).getTime();
  if (isNaN(t)) return "—";
  const diff = Date.now() - t;
  if (diff < 60000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
  return `${Math.round(diff / 86400000)}d ago`;
}

function humanizeActivityEvent(ev: ActivityEvent): string {
  const summary = (ev.summary || "").trim();
  if (!summary) return "Background activity recorded.";
  if (summary.startsWith("user:")) return `New user request received: ${summary.slice(5).trim()}`;
  if (summary.startsWith("✓")) return summary.replace(/^✓\s*/, "Completed step: ");
  if (summary.startsWith("→")) return summary.replace(/^→\s*/, "Running step: ");
  return summary.charAt(0).toUpperCase() + summary.slice(1);
}

export default function ActivityPage() {
  const [state, setState] = useState<ApiState<ActivityStatus>>({ status: "loading" });

  useEffect(() => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    fetch("/api/activity", { signal: ctrl.signal })
      .then(async (res) => {
        clearTimeout(timer);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as ActivityStatus;
        setState({ status: "ok", data });
      })
      .catch((e) => {
        clearTimeout(timer);
        setState({ status: "error", error: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, []);

  return (
    <div className="logs-page">
      <div className="logs-page-header">
        <div>
          <div className="card-title">Bot activity</div>
          <h1 className="logs-page-title">Readable activity tracker</h1>
          <p className="logs-page-subtitle">A human-friendly view of what the assistant is doing right now.</p>
        </div>
        <div className="logs-page-actions">
          <Link href="/" className="card-link-btn">Back to dashboard</Link>
        </div>
      </div>

      {state.status === "loading" && <div className="empty-msg">Loading activity…</div>}
      {state.status === "error" && <div className="err-msg">{state.error}</div>}

      {state.status === "ok" && (
        <>
          <div className="logs-summary-grid">
            <div className="metric-tile"><span className="metric-value">{state.data.state.toUpperCase()}</span><span className="metric-label">state</span></div>
            <div className="metric-tile"><span className="metric-value">{state.data.recentEvents.length}</span><span className="metric-label">recent steps</span></div>
            <div className="metric-tile"><span className="metric-value metric-accent">{timeAgo(state.data.lastEventMs)}</span><span className="metric-label">last update</span></div>
          </div>

          <div className="logs-feed">
            {state.data.recentEvents.map((ev, idx) => {
              const cls = ev.role === "tool_result" ? "info" : ev.role === "assistant" ? "info" : "warn";
              return (
                <article key={`${ev.ts}-${idx}`} className={`logs-feed-item logs-feed-${cls}`}>
                  <div className="logs-feed-top">
                    <span className="badge badge-neutral">{ev.role.replace("_", " ")}</span>
                    <span className="service-meta">{timeAgo(ev.tsMs)}</span>
                    <span className="service-meta">{new Date(ev.tsMs).toLocaleString()}</span>
                  </div>
                  <p className="logs-feed-message">{humanizeActivityEvent(ev)}</p>
                  <div className="logs-feed-meta">
                    {state.data.agent && <span className="activity-pill">agent: {state.data.agent}</span>}
                    {state.data.model && <span className="activity-pill">model: {state.data.model}</span>}
                    {state.data.sessionId && <span className="activity-pill">session: {state.data.sessionId.slice(0, 8)}</span>}
                  </div>
                </article>
              );
            })}
            {state.data.recentEvents.length === 0 && <div className="empty-msg">No recent activity.</div>}
          </div>
        </>
      )}
    </div>
  );
}
