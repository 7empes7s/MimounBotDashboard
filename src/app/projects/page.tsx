"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Project = {
  id: string;
  name: string;
  status: "active" | "paused" | "done" | "blocked";
  description: string;
  createdAt: string;
  lastActivityAt: string;
  openItems: string[];
  nextAction: string;
};

type ApiState<T> = { status: "loading" } | { status: "ok"; data: T } | { status: "error"; error: string };

export default function ProjectsPage() {
  const [state, setState] = useState<ApiState<{ version: number; items: Project[] }>>({ status: 'loading' });
  useEffect(() => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    fetch('/api/projects', { signal: ctrl.signal }).then(async r => {
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
        <div className="card-title">Projects</div>
        <h1 className="logs-page-title">Project registry</h1>
        <p className="logs-page-subtitle">Active projects and their next actions.</p>
      </div>
      <div className="logs-page-actions"><Link href="/" className="card-link-btn">Back to dashboard</Link></div>
    </div>
    {state.status === 'loading' && <div className="empty-msg">Loading projects…</div>}
    {state.status === 'error' && <div className="err-msg">{state.error}</div>}
    {state.status === 'ok' && <div className="logs-feed grouped-logs-feed">
      {state.data.items.filter(p => p.status !== 'done').map(p => (
        <article key={p.id} className="logs-feed-item logs-feed-info">
          <div className="logs-feed-top">
            <span className="badge badge-neutral">{p.id}</span>
            <span className="badge badge-neutral">{p.status}</span>
            <span className="service-meta">last activity {p.lastActivityAt}</span>
          </div>
          <p className="logs-feed-message">{p.name}</p>
          <div className="logs-feed-meta">
            <span className="activity-pill">next: {p.nextAction}</span>
          </div>
          {p.openItems.length > 0 && <div className="logs-feed-meta"><span className="logs-feed-raw">open: {p.openItems.join(' | ')}</span></div>}
        </article>
      ))}
    </div>}
  </div>;
}
