"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type InfraSnapshot = {
  host: {
    hostname: string; platform: string; release: string; uptimeHuman: string;
    loadAvg1: number; loadAvg5: number; loadAvg15: number; memUsedPercent: number; rootUsedPercent: number;
  };
  runtime: { sessionCount: number; lastSessionActivityHuman: string; };
  listeners: Array<{ port: number; listening: boolean }>;
  dns: Array<{ hostname: string; resolved: boolean; answers: string[] }>;
  endpoints: Array<{ label: string; url: string; ok: boolean; statusCode: number | null }>;
};

type ApiState<T> = { status: "loading" } | { status: "ok"; data: T } | { status: "error"; error: string };

export default function InfraPage() {
  const [state, setState] = useState<ApiState<InfraSnapshot>>({ status: "loading" });
  useEffect(() => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    fetch('/api/infra', { signal: ctrl.signal }).then(async r => {
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
        <div className="card-title">Host / Infra</div>
        <h1 className="logs-page-title">VM and network snapshot</h1>
        <p className="logs-page-subtitle">Cheap local checks only. No paid telemetry.</p>
      </div>
      <div className="logs-page-actions"><Link href="/" className="card-link-btn">Back to dashboard</Link></div>
    </div>
    {state.status === 'loading' && <div className="empty-msg">Loading infra…</div>}
    {state.status === 'error' && <div className="err-msg">{state.error}</div>}
    {state.status === 'ok' && <>
      <div className="logs-summary-grid">
        <div className="metric-tile"><span className="metric-value">{state.data.host.memUsedPercent}%</span><span className="metric-label">memory used</span></div>
        <div className="metric-tile"><span className="metric-value">{state.data.host.rootUsedPercent}%</span><span className="metric-label">disk used</span></div>
        <div className="metric-tile"><span className="metric-value metric-accent">{state.data.host.uptimeHuman}</span><span className="metric-label">uptime</span></div>
      </div>
      <div className="usage-capability-list">
        {state.data.listeners.map(l => <div key={l.port} className="usage-capability-row"><div className="usage-capability-main"><span className="session-id">port {l.port}</span><span className="session-channel">listener</span></div><div className="usage-session-side"><span className={`usage-source-chip ${l.listening?'tracked':'untracked'}`}>{l.listening ? 'listening' : 'closed'}</span></div></div>)}
        {state.data.dns.map(d => <div key={d.hostname} className="usage-capability-row"><div className="usage-capability-main"><span className="session-id">{d.hostname}</span><span className="session-channel">dns</span></div><div className="usage-session-side"><span className={`usage-source-chip ${d.resolved?'tracked':'untracked'}`}>{d.resolved ? 'resolved' : 'failed'}</span></div></div>)}
        {state.data.endpoints.map(e => <div key={e.label} className="usage-capability-row"><div className="usage-capability-main"><span className="session-id">{e.label}</span><span className="session-channel">endpoint</span></div><div className="usage-session-side"><span className={`usage-source-chip ${e.ok?'tracked':'untracked'}`}>{e.statusCode ?? '—'}</span></div></div>)}
      </div>
    </>}
  </div>;
}
