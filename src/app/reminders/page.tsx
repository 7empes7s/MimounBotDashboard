"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type ReminderItem = {
  id: string;
  title: string;
  type: "hard" | "soft" | "trigger" | "watchlist";
  state: "pending" | "nudged" | "followed_up" | "done" | "cancelled" | "blocked";
  context: string;
  updatedAt?: string;
  lastSentAt?: string | null;
  followUpSentAt?: string | null;
};

type ReminderSnapshot = {
  pendingCount: number;
  followUpDueCount: number;
  watchlistCount: number;
  statusLine: string;
  groups: {
    pending: ReminderItem[];
    attention: ReminderItem[];
    watchlist: ReminderItem[];
    resolved: ReminderItem[];
  };
};

type ApiState<T> = { status: "loading" } | { status: "ok"; data: T } | { status: "error"; error: string };

function timeLabel(item: ReminderItem) {
  return item.followUpSentAt || item.lastSentAt || item.updatedAt || '—';
}

function Row({ item }: { item: ReminderItem }) {
  return <article className="logs-feed-item logs-feed-info">
    <div className="logs-feed-top">
      <span className="badge badge-neutral">{item.id}</span>
      <span className="badge badge-neutral">{item.type}</span>
      <span className="badge badge-neutral">{item.state}</span>
      <span className="service-meta">{timeLabel(item)}</span>
    </div>
    <p className="logs-feed-message">{item.title}</p>
    <div className="logs-feed-meta"><span className="logs-feed-raw">{item.context}</span></div>
  </article>;
}

export default function RemindersPage() {
  const [state, setState] = useState<ApiState<ReminderSnapshot>>({ status: 'loading' });
  const [showResolved, setShowResolved] = useState(false);
  useEffect(() => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    fetch('/api/reminders', { signal: ctrl.signal }).then(async r => {
      clearTimeout(timer);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setState({ status: 'ok', data: await r.json() });
    }).catch(e => {
      clearTimeout(timer);
      setState({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    });
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, []);

  return <div className="logs-page">
    <div className="logs-page-header">
      <div>
        <div className="card-title">Reminders</div>
        <h1 className="logs-page-title">Reminder registry</h1>
        <p className="logs-page-subtitle">Read-only view of reminders/registry.json.</p>
      </div>
      <div className="logs-page-actions"><Link href="/" className="card-link-btn">Back to dashboard</Link></div>
    </div>
    {state.status === 'loading' && <div className="empty-msg">Loading reminders…</div>}
    {state.status === 'error' && <div className="err-msg">{state.error}</div>}
    {state.status === 'ok' && <>
      <div className="logs-summary-grid">
        <div className="metric-tile"><span className="metric-value">{state.data.pendingCount}</span><span className="metric-label">pending</span></div>
        <div className="metric-tile"><span className="metric-value">{state.data.followUpDueCount}</span><span className="metric-label">follow-up due</span></div>
        <div className="metric-tile"><span className="metric-value metric-accent">{state.data.watchlistCount}</span><span className="metric-label">watching</span></div>
      </div>
      <div className="log-path">{state.data.statusLine}</div>
      <div className="logs-feed grouped-logs-feed">
        <section className="log-group"><div className="log-group-header"><span className="badge badge-neutral">Pending</span><span className="service-meta">{state.data.groups.pending.length}</span></div><div className="logs-feed">{state.data.groups.pending.map(i => <Row key={i.id} item={i} />)}{state.data.groups.pending.length===0 && <div className="empty-msg">No pending reminders.</div>}</div></section>
        <section className="log-group"><div className="log-group-header"><span className="badge badge-warn">Nudged / Follow-up due</span><span className="service-meta">{state.data.groups.attention.length}</span></div><div className="logs-feed">{state.data.groups.attention.map(i => <Row key={i.id} item={i} />)}{state.data.groups.attention.length===0 && <div className="empty-msg">No attention items.</div>}</div></section>
        <section className="log-group"><div className="log-group-header"><span className="badge badge-neutral">Watchlist</span><span className="service-meta">{state.data.groups.watchlist.length}</span></div><div className="logs-feed">{state.data.groups.watchlist.map(i => <Row key={i.id} item={i} />)}{state.data.groups.watchlist.length===0 && <div className="empty-msg">No watchlist items.</div>}</div></section>
        <section className="log-group"><div className="log-group-header"><span className="badge badge-neutral">Resolved</span><span className="service-meta">{state.data.groups.resolved.length}</span><button className="more-toggle-btn" type="button" onClick={() => setShowResolved(v => !v)}>{showResolved ? 'Hide resolved' : 'Show resolved'}</button></div>{showResolved && <div className="logs-feed">{state.data.groups.resolved.map(i => <Row key={i.id} item={i} />)}{state.data.groups.resolved.length===0 && <div className="empty-msg">No resolved items.</div>}</div>}</section>
      </div>
    </>}
  </div>;
}
