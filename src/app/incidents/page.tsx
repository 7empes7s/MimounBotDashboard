"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type LogEntry = { ts: string; level: string; msg: string; module?: string };
type LogsResponse = { entries: LogEntry[]; logFile: string | null };
type ApiState<T> = { status: "loading" } | { status: "ok"; data: T } | { status: "error"; error: string };

function getLogErrorCode(entry: LogEntry): string {
  const msg = (entry.msg || "").toLowerCase();
  if (/could not find the exact text/.test(msg)) return "EDIT_MATCH_FAILED";
  if (/no changes made/.test(msg)) return "EDIT_NOOP";
  if (/timed out|timeout/.test(msg)) return "TIMEOUT";
  if (/missing scope/.test(msg)) return "MISSING_SCOPE";
  if (/disconnected/.test(msg)) return "DISCONNECTED";
  if (/credit balance is too low/.test(msg)) return "CREDITS_LOW";
  if (/reverse proxy headers are not trusted/.test(msg)) return "PROXY_HEADERS_UNTRUSTED";
  if (/trustedproxies is empty/.test(msg)) return "TRUSTED_PROXIES_EMPTY";
  if (/failed/.test(msg)) return "FAILED";
  return (entry.level || "ERROR").toUpperCase();
}

function humanizeLog(entry: LogEntry): string {
  const msg = (entry.msg || "").trim();
  const moduleLabel = entry.module ? ` in ${entry.module}` : "";
  const code = getLogErrorCode(entry);
  if (!msg) return `A system issue was recorded${moduleLabel} [${code}].`;
  if (/timed out|timeout/i.test(msg)) return `The operation timed out${moduleLabel} [${code}].`;
  if (/missing scope/i.test(msg)) return `Access is limited${moduleLabel} [${code}]. Additional scope is required.`;
  if (/no changes made/i.test(msg)) return `The edit was skipped because nothing needed to change${moduleLabel} [${code}].`;
  if (/could not find the exact text/i.test(msg)) return `The edit could not be applied because the expected text no longer matched${moduleLabel} [${code}].`;
  if (/credit balance is too low/i.test(msg)) return `The provider ran out of credits${moduleLabel} [${code}].`;
  if (/reverse proxy headers are not trusted/i.test(msg)) return `Reverse proxy headers are not trusted yet${moduleLabel} [${code}].`;
  if (/trustedproxies is empty/i.test(msg)) return `The gateway is loopback-only and trusted proxies are not configured${moduleLabel} [${code}].`;
  if (/disconnected/i.test(msg)) return `The connection dropped${moduleLabel} [${code}].`;
  return `Issue${moduleLabel} [${code}]: ${msg}`;
}

function severity(entry: LogEntry): "high" | "medium" {
  return ["error", "fatal"].includes((entry.level || "").toLowerCase()) ? "high" : "medium";
}

function timeAgo(ts?: string) {
  if (!ts) return "—";
  const t = new Date(ts).getTime();
  const diff = Date.now() - t;
  if (diff < 60000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
  return `${Math.round(diff / 86400000)}d ago`;
}

export default function IncidentsPage() {
  const [state, setState] = useState<ApiState<LogsResponse>>({ status: "loading" });
  useEffect(() => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    fetch('/api/logs', { signal: ctrl.signal }).then(async r => {
      clearTimeout(timer);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setState({ status: 'ok', data: await r.json() });
    }).catch(e => {
      clearTimeout(timer);
      setState({ status: 'error', error: e instanceof Error ? e.message : String(e) });
    });
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, []);

  const incidents = useMemo(() => {
    if (state.status !== 'ok') return [] as Array<{ code: string; entries: LogEntry[] }>;
    const filtered = state.data.entries
      .filter((e) => ["warn", "error", "fatal"].includes((e.level || "").toLowerCase()))
      .sort((a, b) => new Date(b.ts || 0).getTime() - new Date(a.ts || 0).getTime());
    const map = new Map<string, LogEntry[]>();
    for (const e of filtered) {
      const code = getLogErrorCode(e);
      if (!map.has(code)) map.set(code, []);
      map.get(code)!.push(e);
    }
    return [...map.entries()].map(([code, entries]) => ({ code, entries }));
  }, [state]);

  return <div className="logs-page">
    <div className="logs-page-header">
      <div>
        <div className="card-title">Incidents</div>
        <h1 className="logs-page-title">Operator incident view</h1>
        <p className="logs-page-subtitle">Grouped problems with severity, recency, and occurrence counts.</p>
      </div>
      <div className="logs-page-actions"><Link href="/" className="card-link-btn">Back to dashboard</Link></div>
    </div>
    {state.status === 'loading' && <div className="empty-msg">Loading incidents…</div>}
    {state.status === 'error' && <div className="err-msg">{state.error}</div>}
    {state.status === 'ok' && <>
      <div className="logs-summary-grid">
        <div className="metric-tile"><span className="metric-value">{incidents.length}</span><span className="metric-label">incident types</span></div>
        <div className="metric-tile"><span className="metric-value">{incidents.reduce((s, i) => s + i.entries.length, 0)}</span><span className="metric-label">total events</span></div>
        <div className="metric-tile"><span className="metric-value metric-accent">{incidents.filter(i => i.entries.some(e => severity(e)==='high')).length}</span><span className="metric-label">high severity</span></div>
      </div>
      <div className="logs-feed grouped-logs-feed">
        {incidents.map(({ code, entries }) => {
          const latest = entries[0];
          const sev = entries.some(e => severity(e)==='high') ? 'err' : 'warn';
          return <section key={code} className="log-group">
            <div className="log-group-header">
              <span className={`badge badge-${sev === 'err' ? 'err' : 'warn'}`}>{code}</span>
              <span className="service-meta">{entries.length} occurrence{entries.length !== 1 ? 's' : ''}</span>
              <span className="service-meta">latest {timeAgo(latest?.ts)}</span>
            </div>
            <article className={`logs-feed-item logs-feed-${sev}`}>
              <div className="logs-feed-top">
                <span className="badge badge-neutral">{sev === 'err' ? 'HIGH' : 'MEDIUM'}</span>
                <span className="service-meta">{latest?.ts ? new Date(latest.ts).toLocaleString() : ''}</span>
              </div>
              <p className="logs-feed-message">{latest ? humanizeLog(latest) : 'No details.'}</p>
              <div className="logs-feed-meta">
                {latest?.module && <span className="activity-pill">module: {latest.module}</span>}
                {latest?.msg && <span className="logs-feed-raw">raw error: {latest.msg}</span>}
              </div>
            </article>
          </section>;
        })}
        {incidents.length === 0 && <div className="empty-msg">No incidents detected.</div>}
      </div>
    </>}
  </div>;
}
