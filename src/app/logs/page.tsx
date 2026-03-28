"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type LogEntry = {
  ts: string;
  level: string;
  msg: string;
  module?: string;
};

type LogsResponse = {
  entries: LogEntry[];
  logFile: string | null;
};

type ApiState<T> =
  | { status: "loading" }
  | { status: "ok"; data: T }
  | { status: "error"; error: string };

function getLogErrorCode(entry: LogEntry): string {
  const msg = (entry.msg || "").toLowerCase();
  if (/could not find the exact text/.test(msg)) return "EDIT_MATCH_FAILED";
  if (/no changes made/.test(msg)) return "EDIT_NOOP";
  if (/timed out|timeout/.test(msg)) return "TIMEOUT";
  if (/missing scope/.test(msg)) return "MISSING_SCOPE";
  if (/disconnected/.test(msg)) return "DISCONNECTED";
  if (/failed/.test(msg)) return "FAILED";
  return (entry.level || "ERROR").toUpperCase();
}

function isErrorLevel(entry: LogEntry): boolean {
  return ["warn", "error", "fatal"].includes((entry.level || "").toLowerCase());
}

function humanizeLog(entry: LogEntry): string {
  const level = (entry.level || "INFO").toLowerCase();
  const msg = (entry.msg || "").trim();
  const moduleLabel = entry.module ? ` in ${entry.module}` : "";
  const code = getLogErrorCode(entry);

  if (!msg) return isErrorLevel(entry) ? `A system issue was recorded${moduleLabel} [${code}].` : "Background activity recorded.";
  if (/heartbeat/i.test(msg)) return `Heartbeat received${moduleLabel}. Connection still alive.`;
  if (/connected/i.test(msg)) return `Connection established${moduleLabel}.`;
  if (/disconnected/i.test(msg)) return `The connection dropped${moduleLabel} [${code}].`;
  if (/timed out|timeout/i.test(msg)) return `The operation timed out${moduleLabel} [${code}].`;
  if (/missing scope/i.test(msg)) return `Access is limited${moduleLabel} [${code}]. Additional scope is required.`;
  if (/inbound message/i.test(msg)) return `A new inbound message was received${moduleLabel}.`;
  if (/no changes made/i.test(msg)) return `The edit was skipped because nothing needed to change${moduleLabel} [${code}].`;
  if (/could not find the exact text/i.test(msg)) return `The edit could not be applied because the expected text no longer matched${moduleLabel} [${code}].`;
  if (/credit balance is too low/i.test(msg)) return `The provider ran out of credits${moduleLabel} [CREDITS_LOW].`;
  if (/reverse proxy headers are not trusted/i.test(msg)) return `Reverse proxy headers are not trusted yet${moduleLabel} [PROXY_HEADERS_UNTRUSTED].`;
  if (/bind is loopback and gateway\.trustedproxies is empty/i.test(msg)) return `The gateway is loopback-only and trusted proxies are not configured${moduleLabel} [TRUSTED_PROXIES_EMPTY].`;
  if (isErrorLevel(entry)) return `${level === "warn" ? "Warning" : "Error"}${moduleLabel} [${code}]: ${msg}`;
  return msg.charAt(0).toUpperCase() + msg.slice(1);
}

function timeAgo(ts?: string) {
  if (!ts) return "—";
  const t = new Date(ts).getTime();
  if (isNaN(t)) return "—";
  const diff = Date.now() - t;
  if (diff < 60000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3600000) return `${Math.round(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.round(diff / 3600000)}h ago`;
  return `${Math.round(diff / 86400000)}d ago`;
}

export default function LogsPage() {
  const [state, setState] = useState<ApiState<LogsResponse>>({ status: "loading" });

  useEffect(() => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    fetch("/api/logs", { signal: ctrl.signal })
      .then(async (res) => {
        clearTimeout(timer);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as LogsResponse;
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

  const summary = useMemo(() => {
    if (state.status !== "ok") return null;
    const alerts = state.data.entries.filter((e) => isErrorLevel(e));
    const errors = alerts.filter((e) => ["error", "fatal"].includes((e.level || "").toLowerCase()));
    return { alerts: alerts.length, errors: errors.length, total: state.data.entries.length };
  }, [state]);

  return (
    <div className="logs-page">
      <div className="logs-page-header">
        <div>
          <div className="card-title">Gateway logs</div>
          <h1 className="logs-page-title">Readable event log</h1>
          <p className="logs-page-subtitle">Natural-language system events for quick operator review.</p>
        </div>
        <div className="logs-page-actions">
          <Link href="/" className="card-link-btn">Back to dashboard</Link>
        </div>
      </div>

      {state.status === "loading" && <div className="empty-msg">Loading logs…</div>}
      {state.status === "error" && <div className="err-msg">{state.error}</div>}

      {state.status === "ok" && (() => {
        const sorted = [...state.data.entries]
          .filter((e) => isErrorLevel(e))
          .sort((a, b) => new Date(b.ts || 0).getTime() - new Date(a.ts || 0).getTime());
        const grouped = new Map<string, LogEntry[]>();
        for (const entry of sorted) {
          const key = getLogErrorCode(entry);
          if (!grouped.has(key)) grouped.set(key, []);
          grouped.get(key)!.push(entry);
        }
        const groups = [...grouped.entries()];
        return (
          <>
            <div className="logs-summary-grid">
              <div className="metric-tile"><span className="metric-value">{summary?.total ?? 0}</span><span className="metric-label">entries</span></div>
              <div className="metric-tile"><span className="metric-value">{summary?.alerts ?? 0}</span><span className="metric-label">alerts</span></div>
              <div className="metric-tile"><span className="metric-value metric-accent">{summary?.errors ?? 0}</span><span className="metric-label">errors</span></div>
            </div>

            {state.data.logFile && <div className="log-path">{state.data.logFile}</div>}

            <div className="logs-feed grouped-logs-feed">
              {groups.map(([groupKey, entries]) => (
                <section key={groupKey} className="log-group">
                  <div className="log-group-header">
                    <span className="badge badge-neutral">{groupKey}</span>
                    <span className="service-meta">{entries.length} item{entries.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="logs-feed">
                    {entries.map((entry, idx) => {
                      const level = (entry.level || "info").toLowerCase();
                      const cls = level === "warn" ? "warn" : level === "error" || level === "fatal" ? "err" : "info";
                      return (
                        <article key={`${groupKey}-${entry.ts}-${idx}`} className={`logs-feed-item logs-feed-${cls}`}>
                          <div className="logs-feed-top">
                            <span className="badge badge-neutral">{entry.level || "INFO"}</span>
                            <span className="service-meta">{timeAgo(entry.ts)}</span>
                            <span className="service-meta">{entry.ts ? new Date(entry.ts).toLocaleString() : ""}</span>
                          </div>
                          <p className="logs-feed-message">{humanizeLog(entry)}</p>
                          {(entry.module || entry.msg) && (
                            <div className="logs-feed-meta">
                              {entry.module && <span className="activity-pill">module: {entry.module}</span>}
                              {entry.msg && isErrorLevel(entry) && <span className="logs-feed-raw">raw error: {entry.msg}</span>}
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </>
        );
      })()}
    </div>
  );
}
