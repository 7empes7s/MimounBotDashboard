"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type SessionEntry = {
  sessionId: string; channel: string; chatType: string; from: string; model: string;
  modelProvider?: string; inputTokens?: number; outputTokens?: number; totalTokens?: number; totalTokensFresh?: boolean; updatedAt: number;
};
type TranscriptInfo = { agent: string; sizeFormatted: string; modifiedAt: number; filePath: string };
type ActivityEvent = { ts: string; tsMs: number; role: string; summary: string; toolName?: string };
type SessionDrilldown = { session: SessionEntry | null; transcript: TranscriptInfo | null; recentEvents: ActivityEvent[]; transcriptExcerpt: string[] };

type ApiState<T> = { status: "loading" } | { status: "ok"; data: T } | { status: "error"; error: string };

function timeAgo(ts?: number | string) {
  if (!ts) return "—";
  const t = typeof ts === 'number' ? ts : new Date(ts).getTime();
  const diff = Date.now() - t;
  if (diff < 60000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
  return `${Math.round(diff / 86400000)}d ago`;
}

function estimateCostUsd(model: string, inputTokens = 0, outputTokens = 0): number {
  const m = model.toLowerCase();
  if (m.includes('gpt-5.4')) return (inputTokens / 1_000_000) * 1.25 + (outputTokens / 1_000_000) * 10.0;
  if (m.includes('claude-sonnet-4-6') || m.includes('sonnet')) return (inputTokens / 1_000_000) * 3.0 + (outputTokens / 1_000_000) * 15.0;
  if (m.includes('gemini-2.0-flash') || m.includes('gemini')) return (inputTokens / 1_000_000) * 0.1 + (outputTokens / 1_000_000) * 0.4;
  return 0;
}

function formatUsd(v: number) {
  return `$${v.toFixed(2)}`;
}

export default function SessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const [state, setState] = useState<ApiState<SessionDrilldown>>({ status: 'loading' });
  useEffect(() => {
    let alive = true;
    params.then(({ sessionId }) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      fetch(`/api/session/${sessionId}`, { signal: ctrl.signal }).then(async r => {
        clearTimeout(timer);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        if (alive) setState({ status: 'ok', data: await r.json() });
      }).catch(e => {
        clearTimeout(timer);
        if (alive) setState({ status: 'error', error: e instanceof Error ? e.message : String(e) });
      });
      return () => { clearTimeout(timer); ctrl.abort(); };
    });
    return () => { alive = false; };
  }, [params]);

  return <div className="logs-page">
    <div className="logs-page-header">
      <div>
        <div className="card-title">Session drilldown</div>
        <h1 className="logs-page-title">Session detail view</h1>
        <p className="logs-page-subtitle">Model, usage, recent activity, and transcript context.</p>
      </div>
      <div className="logs-page-actions"><Link href="/" className="card-link-btn">Back to dashboard</Link></div>
    </div>
    {state.status === 'loading' && <div className="empty-msg">Loading session…</div>}
    {state.status === 'error' && <div className="err-msg">{state.error}</div>}
    {state.status === 'ok' && state.data.session && <>
      <div className="logs-summary-grid">
        <div className="metric-tile"><span className="metric-value">{state.data.session.totalTokens ?? '—'}</span><span className="metric-label">tokens</span></div>
        <div className="metric-tile"><span className="metric-value">{state.data.session.inputTokens ?? '—'}</span><span className="metric-label">input</span></div>
        <div className="metric-tile"><span className="metric-value">{formatUsd(estimateCostUsd(state.data.session.model || '', state.data.session.inputTokens ?? 0, state.data.session.outputTokens ?? 0))}</span><span className="metric-label">est. cost</span></div>
        <div className="metric-tile"><span className="metric-value metric-accent">{timeAgo(state.data.session.updatedAt)}</span><span className="metric-label">updated</span></div>
      </div>
      <div className="usage-capability-list" style={{ marginBottom: 14 }}>
        <div className="usage-capability-row"><div className="usage-capability-main"><span className="session-id">{state.data.session.sessionId.slice(0,8)}</span><span className="session-channel">session</span></div><div className="usage-session-side"><span className="service-meta">{state.data.session.channel || state.data.session.chatType}</span></div></div>
        <div className="usage-capability-row"><div className="usage-capability-main"><span className="session-id">{state.data.session.model || '—'}</span><span className="session-channel">model</span></div><div className="usage-session-side"><span className="service-meta">{state.data.session.modelProvider || '—'}</span></div></div>
        <div className="usage-capability-row"><div className="usage-capability-main"><span className="session-id">{state.data.session.from || '—'}</span><span className="session-channel">origin</span></div><div className="usage-session-side"><span className="service-meta">fresh: {state.data.session.totalTokensFresh ? 'yes' : 'no'}</span></div></div>
      </div>
      <div className="logs-feed grouped-logs-feed">
        <section className="log-group">
          <div className="log-group-header"><span className="badge badge-neutral">recent activity</span><span className="service-meta">{state.data.recentEvents.length} events</span></div>
          <div className="logs-feed">
            {state.data.recentEvents.map((ev, i) => <article key={i} className="logs-feed-item logs-feed-info"><div className="logs-feed-top"><span className="badge badge-neutral">{ev.role}</span><span className="service-meta">{timeAgo(ev.tsMs)}</span></div><p className="logs-feed-message">{ev.summary}</p></article>)}
            {state.data.recentEvents.length === 0 && <div className="empty-msg">No recent activity.</div>}
          </div>
        </section>
        <section className="log-group">
          <div className="log-group-header"><span className="badge badge-neutral">transcript excerpt</span><span className="service-meta">{state.data.transcript?.agent || '—'}</span></div>
          <div className="logs-feed">
            {state.data.transcriptExcerpt.map((line, i) => <article key={i} className="logs-feed-item logs-feed-info"><p className="logs-feed-message">{line}</p></article>)}
            {state.data.transcriptExcerpt.length === 0 && <div className="empty-msg">No transcript excerpt available.</div>}
          </div>
        </section>
      </div>
    </>}
  </div>;
}
