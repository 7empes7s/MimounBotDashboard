"use client";

import Link from "next/link";
import { useEffect, useState, useCallback, useMemo } from "react";

// ── Types ────────────────────────────────────────────────────────────────────
type ServiceStatus = {
  name: string;
  active: string;
  sub: string;
  pid: string;
  memory: string;
  since: string;
};

type SessionEntry = {
  sessionId: string;
  chatType: string;
  channel: string;
  model: string;
  updatedAt: string;
  modelProvider?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  totalTokensFresh?: boolean;
};

type TranscriptInfo = {
  agentName: string;
  fileName: string;
  sessionId: string;
  size: number;
  sizeFormatted: string;
  modifiedAt: string;
};

type CredentialStatus = {
  provider: string;
  present: boolean;
  accounts: string[];
};

type LogEntry = {
  time: string;
  level: string;
  message: string;
  module?: string;
  tier?: "INFO" | "WARNING" | "INCIDENT";
};

type ProviderState = {
  last_updated: string;
  providers: Record<string, {
    status: string;
    note?: string;
    model?: string;
    label?: string;
  }>;
};

type UsageMetrics = {
  sessionCount: number;
  transcriptFileCount: number;
  transcriptTotalBytes: number;
  transcriptTotalFormatted: string;
  lastActivityTs: string | null;
  lastActivityFormatted: string;
  tokenCost: "estimated" | "unavailable";
  estimatedCostUsd: number;
  trackedSpendUsd: number;
  untrackedSpendUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  sessionsWithUsage: number;
  staleUsageSessions: number;
  categoryBreakdown: Array<{ category: string; tracked: boolean; estimatedCostUsd: number; sessions: number }>;
  pricingReference: Array<{ model: string; inputPerMillionUsd: number | null; outputPerMillionUsd: number | null; confidence: string; reason: string; source: string }>;
  providerStates: Array<{
    provider: string;
    label: string;
    status: "ok" | "warning" | "exhausted" | "unknown";
    source: "live" | "runtime" | "remembered" | "estimated" | "unavailable";
    liveDataAvailable: boolean;
    estimatedSpendUsd: number;
    rememberedSpendUsd: number | null;
    deltaSinceRememberedUsd: number | null;
    note: string;
    runtimeIssue: string | null;
    updatedAt: string;
  }>;
  models: Array<{
    model: string;
    provider: string;
    sessions: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
  }>;
  topSessions: Array<{
    sessionId: string;
    model: string;
    provider: string;
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    updatedAt: number;
    estimatedCostUsd: number;
  }>;
  observedModels: Array<{
    model: string;
    provider: string;
    source: "configured" | "history" | "session" | "image" | "tts";
    tokenTracked: boolean;
    lastSeenTs?: number;
    sessions?: number;
  }>;
  capabilities: Array<{
    kind: string;
    provider: string;
    model: string;
    status: "configured" | "used" | "configured+used";
  }>;
};

type ActivityEvent = {
  ts: string;
  tsMs: number;
  role: string;
  summary: string;
  toolName?: string;
  model?: string;
};

type ActivityStatus = {
  state: "active" | "idle" | "unknown";
  lastEventTs: string | null;
  lastEventMs: number | null;
  sessionId: string | null;
  agent: string | null;
  model: string | null;
  recentEvents: ActivityEvent[];
  recentCommandEvents: ActivityEvent[];
  source: string;
};

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

type InfraSnapshot = {
  host: {
    hostname: string;
    platform: string;
    release: string;
    uptimeHuman: string;
    loadAvg1: number;
    loadAvg5: number;
    loadAvg15: number;
    memUsedPercent: number;
    rootUsedPercent: number;
  };
  runtime: {
    sessionCount: number;
    lastSessionActivityTs: number | null;
    lastSessionActivityHuman: string;
  };
  listeners: Array<{ port: number; listening: boolean }>;
  dns: Array<{ hostname: string; resolved: boolean; answers: string[] }>;
  endpoints: Array<{ label: string; url: string; ok: boolean; statusCode: number | null }>;
};

type ApiState<T> =
  | { status: "loading" }
  | { status: "ok"; data: T }
  | { status: "error"; error: string };

type AttentionItem = {
  severity: "info" | "warn" | "critical";
  title: string;
  detail: string;
  age: string;
};

type AgentRosterItem = {
  id: string;
  label: string;
  runtimeType: "main" | "session";
  model: string;
  status: "active" | "idle" | "quiet" | "stalled";
  health: "healthy" | "degraded" | "blocked";
  task: string;
  lastActivity: string;
  sessionAge: string;
  tokenText: string;
  contextText: string;
  cacheText: string;
  recommendation: "keep" | "refresh" | "reset" | "recreate";
};

type CommandLaneItem = {
  id: string;
  commandText: string;
  status: "queued" | "running" | "done" | "failed";
  age: string;
  detail: string;
  model?: string;
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function timeAgo(ts: string | null | Date): string {
  if (!ts) return "—";
  const t = ts instanceof Date ? ts.getTime() : new Date(ts).getTime();
  if (isNaN(t)) return "—";
  const diff = Date.now() - t;
  if (diff < 0) return "just now";
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h ago`;
  return `${Math.round(diff / 86_400_000)}d ago`;
}

function computeSystemHealth(services: ServiceStatus[], logs: LogEntry[]): "ok" | "warn" | "err" {
  const failedServices = services.filter(s => s.active === "failed").length;
  if (failedServices > 0) return "err";

  const incidents = logs.filter(l => l.tier === "INCIDENT").length;
  if (incidents > 0) return "err";

  const warnings = logs.filter(l => l.tier === "WARNING").length;
  if (warnings > 0) return "warn";

  return "ok";
}

/** Bucket log timestamps into N bars for spark chart — derived from real data */
function deriveLogFrequency(entries: LogEntry[], buckets = 18): number[] {
  const times = entries
    .map(e => new Date(e.time).getTime())
    .filter(t => !isNaN(t) && t > 0);
  if (times.length < 2) {
    const arr = new Array(buckets).fill(0);
    if (times.length === 1) arr[buckets - 1] = 1;
    return arr;
  }
  const min = Math.min(...times);
  const max = Math.max(...times);
  const range = max - min;
  if (range === 0) {
    const arr = new Array(buckets).fill(0);
    arr[0] = times.length;
    return arr;
  }
  const counts = new Array(buckets).fill(0);
  times.forEach(t => {
    const idx = Math.min(buckets - 1, Math.floor(((t - min) / range) * buckets));
    counts[idx]++;
  });
  return counts;
}

/** Count transcripts per agent, top 4 */
function deriveAgentCounts(transcripts: TranscriptInfo[]): { agent: string; count: number }[] {
  const map: Record<string, number> = {};
  transcripts.forEach(t => { const a = t.agentName || "unknown"; map[a] = (map[a] || 0) + 1; });
  return Object.entries(map)
    .map(([agent, count]) => ({ agent, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 4);
}

// ── Primitive UI ─────────────────────────────────────────────────────────────
function StatusDot({ state }: { state: "ok" | "warn" | "err" | "off" }) {
  return <span className={`dot dot-${state}`} />;
}

function ProjectsCard({ state }: { state: ApiState<{ version: number; items?: Project[]; projects?: Project[] }> }) {
  if (state.status === "loading") return <Card title="PROJECTS"><Skeleton h="90px" /></Card>;
  if (state.status === "error") return <Card title="PROJECTS" accent="err"><p className="err-msg">{state.error}</p></Card>;
  const items = (state.data.items ?? state.data.projects ?? []).filter(p => p.status === 'active' || p.status === 'blocked');
  const blocked = items.filter(p => p.status === 'blocked').length;
  return (
    <Card title="PROJECTS" headerAction={<Link href="/projects" className="card-link-btn">Open projects</Link>}>
      <div className="metric-grid infra-grid">
        <div className="metric-tile"><span className="metric-value">{items.filter(p => p.status === 'active').length}</span><span className="metric-label">active</span></div>
        <div className="metric-tile"><span className="metric-value">{blocked}</span><span className="metric-label">blocked</span></div>
      </div>
      <div className="usage-capability-list" style={{ marginTop: 12 }}>
        {items.slice(0,3).map(p => (
          <div key={p.id} className="usage-capability-row">
            <div className="usage-capability-main"><span className="session-id">{p.id}</span><span className="session-channel">{p.name}</span></div>
            <div className="usage-session-side"><span className="service-meta">{p.nextAction}</span></div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function ReminderCard({ state }: { state: ApiState<ReminderSnapshot> }) {
  if (state.status === "loading") {
    return <Card title="REMINDERS"><Skeleton h="90px" /></Card>;
  }
  if (state.status === "error") {
    return <Card title="REMINDERS" accent="err"><p className="err-msg">{state.error}</p></Card>;
  }
  const r = state.data;
  return (
    <Card title="REMINDERS" headerAction={<Link href="/reminders" className="card-link-btn">Open reminders</Link>}>
      <div className="metric-grid infra-grid">
        <div className="metric-tile"><span className="metric-value">{r.pendingCount}</span><span className="metric-label">pending</span></div>
        <div className="metric-tile"><span className="metric-value">{r.followUpDueCount}</span><span className="metric-label">follow-up due</span></div>
        <div className="metric-tile"><span className="metric-value metric-accent">{r.watchlistCount}</span><span className="metric-label">watching</span></div>
      </div>
      <div className="log-path" style={{ marginTop: 12 }}>{r.statusLine}</div>
    </Card>
  );
}

function ProviderBalancesCard({ state }: { state: ApiState<ProviderState | null> }) {
  if (state.status === "loading") return <Card title="PROVIDER BALANCES"><Skeleton h="90px" /></Card>;
  if (state.status === "error") return <Card title="PROVIDER BALANCES" accent="err"><p className="err-msg">{state.error}</p></Card>;
  if (!state.data) return <Card title="PROVIDER BALANCES"><p className="empty-msg">No balance data found.</p></Card>;

  const providers = state.data.providers;
  
  return (
    <Card title="PROVIDER BALANCES" badge={<span className="service-meta">Last verified: {timeAgo(state.data.last_updated)}</span>}>
      <div className="usage-capability-list">
        {Object.entries(providers).map(([id, info]) => {
          const p = info as any;
          const facts: string[] = [];
          if (p.metricType) facts.push(p.metricType);
          if (typeof p.actualSpendUsd === 'number') facts.push(`billed ${formatUsd(p.actualSpendUsd)}`);
          if (typeof p.actualSpendEur === 'number') facts.push(`billed €${p.actualSpendEur.toFixed(2)}`);
          if (typeof p.creditsRemaining === 'number' && typeof p.creditsTotal === 'number') facts.push(`${formatNumber(p.creditsRemaining)} / ${formatNumber(p.creditsTotal)} credits`);
          if (typeof p.creditsUsed === 'number') facts.push(`used ${formatNumber(p.creditsUsed)}`);
          if (typeof p.billingModel === 'string') facts.push(p.billingModel);
          if (typeof p.billingPeriod === 'string') facts.push(p.billingPeriod);
          return (
            <div key={id} className="usage-capability-row">
              <div className="usage-capability-main">
                <span className="session-id">{p.label || id.toUpperCase()}</span>
                <span className="session-channel">{facts.join(' · ') || p.note || '—'}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="log-path" style={{ marginTop: 8, fontSize: '0.7rem', opacity: 0.7 }}>
        Update via: bash ~/.openclaw/scripts/health-check.sh
      </div>
    </Card>
  );
}

function ProviderHealthCard({ state }: { state: ApiState<ProviderState | null> }) {
  if (state.status === "loading") return <Card title="PROVIDER HEALTH"><Skeleton h="90px" /></Card>;
  if (state.status === "error") return <Card title="PROVIDER HEALTH" accent="err"><p className="err-msg">{state.error}</p></Card>;
  if (!state.data) return <Card title="PROVIDER HEALTH"><p className="empty-msg">No provider health data found.</p></Card>;
  
  const providers = Object.entries(state.data.providers);
  
  return (
    <Card title="PROVIDER HEALTH" badge={<span className="service-meta">Updated {timeAgo(state.data.last_updated)}</span>}>
      <div className="usage-capability-list">
        {providers.map(([id, info]) => {
          const provider = info as any;
          const colorClass = 
            provider.status === 'active' ? 'tracked' : 
            ['degraded', 'rate-limited'].includes(provider.status) ? 'untracked' : 'untracked';
          
          let dotState: "ok" | "warn" | "err" = "ok";
          if (['degraded', 'rate-limited', 'unknown', 'warning'].includes(provider.status)) dotState = "warn";
          if (['exhausted', 'dead', 'auth-failed'].includes(provider.status)) dotState = "err";

          const detailBits: string[] = [];
          if (provider.metricType) detailBits.push(provider.metricType);
          if (typeof provider.actualSpendUsd === 'number') detailBits.push(`billed ${formatUsd(provider.actualSpendUsd)}`);
          if (typeof provider.actualSpendEur === 'number') detailBits.push(`billed €${provider.actualSpendEur.toFixed(2)}`);
          if (typeof provider.creditsRemaining === 'number' && typeof provider.creditsTotal === 'number') detailBits.push(`${formatNumber(provider.creditsRemaining)} / ${formatNumber(provider.creditsTotal)} credits`);
          if (typeof provider.billingModel === 'string') detailBits.push(provider.billingModel);

          return (
            <div key={id} className="usage-capability-row">
              <div className="usage-capability-main">
                <StatusDot state={dotState} />
                <span className="session-id">{provider.label || id.toUpperCase()}</span>
                <span className="session-channel">{detailBits.join(' · ') || provider.model || provider.note || ''}</span>
              </div>
              <div className="usage-session-side">
                <span className={`usage-source-chip ${colorClass}`}>{provider.status}</span>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function InfraCard({ state }: { state: ApiState<InfraSnapshot> }) {
  if (state.status === "loading") {
    return <Card title="HOST / INFRA"><Skeleton h="90px" /></Card>;
  }
  if (state.status === "error") {
    return <Card title="HOST / INFRA" accent="err"><p className="err-msg">{state.error}</p></Card>;
  }
  const i = state.data;
  return (
    <Card title="HOST / INFRA" headerAction={<Link href="/infra" className="card-link-btn">Open infra</Link>}>
      <div className="metric-grid infra-grid">
        <div className="metric-tile"><span className="metric-value">{i.host.memUsedPercent}%</span><span className="metric-label">memory</span></div>
        <div className="metric-tile"><span className="metric-value">{i.host.rootUsedPercent}%</span><span className="metric-label">disk</span></div>
        <div className="metric-tile"><span className="metric-value metric-accent">{i.host.uptimeHuman}</span><span className="metric-label">uptime</span></div>
        <div className="metric-tile"><span className="metric-value">{i.host.loadAvg1}</span><span className="metric-label">load 1m</span></div>
      </div>
      <div className="usage-capability-list" style={{ marginTop: 12 }}>
        {i.listeners.map((l) => (
          <div key={l.port} className="usage-capability-row">
            <div className="usage-capability-main"><span className="session-id">port {l.port}</span><span className="session-channel">listener</span></div>
            <div className="usage-session-side"><span className={`usage-source-chip ${l.listening ? 'tracked' : 'untracked'}`}>{l.listening ? 'listening' : 'closed'}</span></div>
          </div>
        ))}
        {i.dns.map((d) => (
          <div key={d.hostname} className="usage-capability-row">
            <div className="usage-capability-main"><span className="session-id">{d.hostname.replace('.techinsiderbytes.com','')}</span><span className="session-channel">dns</span></div>
            <div className="usage-session-side"><span className={`usage-source-chip ${d.resolved ? 'tracked' : 'untracked'}`}>{d.resolved ? 'resolved' : 'failed'}</span></div>
          </div>
        ))}
        {i.endpoints.map((e) => (
          <div key={e.label} className="usage-capability-row">
            <div className="usage-capability-main"><span className="session-id">{e.label}</span><span className="session-channel">endpoint</span></div>
            <div className="usage-session-side"><span className={`usage-source-chip ${e.ok ? 'tracked' : 'untracked'}`}>{e.statusCode ?? '—'}</span></div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Badge({
  variant,
  children,
}: {
  variant: "ok" | "warn" | "err" | "neutral" | "accent" | "info";
  children: React.ReactNode;
}) {
  return <span className={`badge badge-${variant}`}>{children}</span>;
}

function Skeleton({ w = "100%", h = "14px" }: { w?: string; h?: string }) {
  return <span className="skeleton" style={{ width: w, height: h }} />;
}

// ── Chart Components ──────────────────────────────────────────────────────────

/** Pure SVG spark bar chart — no external dependencies */
function SparkBars({
  values,
  height = 28,
  color,
}: {
  values: number[];
  height?: number;
  color?: string;
}) {
  if (values.length === 0)
    return <span style={{ fontSize: 10, color: "var(--muted)" }}>no data</span>;

  const max = Math.max(...values, 1);
  const bw = 4;
  const gap = 2;
  const totalW = values.length * (bw + gap) - gap;
  const fill = color || "var(--accent)";

  return (
    <svg
      width={totalW}
      height={height}
      style={{ display: "block", flexShrink: 0, overflow: "visible" }}
      aria-hidden
    >
      {values.map((v, i) => {
        const bh = Math.max(2, Math.round((v / max) * height));
        return (
          <rect
            key={i}
            x={i * (bw + gap)}
            y={height - bh}
            width={bw}
            height={bh}
            fill={fill}
            opacity={v === 0 ? 0.12 : 0.72}
            rx={1}
          />
        );
      })}
    </svg>
  );
}

/** Horizontal percentage bar row */
function HorizBar({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color?: string;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="horiz-bar-row">
      <span className="horiz-bar-label">{label}</span>
      <div className="horiz-bar-track">
        <div
          className="horiz-bar-fill"
          style={{ width: `${pct}%`, background: color || "var(--accent)" }}
        />
      </div>
      <span className="horiz-bar-val">{value}</span>
    </div>
  );
}

// ── Baba Mimoun SVG ───────────────────────────────────────────────────────────
function BabaMimounSVG({ sfx = "0", className, style }: { sfx?: string; className?: string; style?: React.CSSProperties }) {
  const glow = `bm-${sfx}-glow`;
  const body = `bm-${sfx}-body`;
  const shine = `bm-${sfx}-shine`;
  return (
    <svg viewBox="0 0 120 52" className={className} style={style} aria-hidden="true">
      <defs>
        <filter id={glow} x="-80%" y="-80%" width="260%" height="260%">
          <feGaussianBlur stdDeviation="2.5" result="blur"/>
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        <radialGradient id={body} cx="42%" cy="38%" r="62%">
          <stop offset="0%" stopColor="#1e4a8a"/>
          <stop offset="100%" stopColor="#061428"/>
        </radialGradient>
        <linearGradient id={shine} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#7dd3fc" stopOpacity={0.35}/>
          <stop offset="70%" stopColor="#3b82f6" stopOpacity={0}/>
        </linearGradient>
      </defs>
      {/* Rear legs */}
      <polyline points="44,34 30,42 20,46" stroke="#3878dc" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <polyline points="76,34 90,42 100,46" stroke="#3878dc" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      {/* Mid legs */}
      <polyline points="41,28 24,31 14,36" stroke="#3878dc" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <polyline points="79,28 96,31 106,36" stroke="#3878dc" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      {/* Front legs */}
      <polyline points="44,22 30,16 22,19" stroke="#3878dc" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <polyline points="76,22 90,16 98,19" stroke="#3878dc" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      {/* Left claw arm */}
      <line x1={42} y1={23} x2={18} y2={14} stroke="#4a90d9" strokeWidth={2} strokeLinecap="round"/>
      <path d="M18,14 L6,8 L4,15" stroke="#60a5fa" strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M18,14 L8,22 L4,15" stroke="#60a5fa" strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round"/>
      <line x1={4} y1={8} x2={4} y2={22} stroke="#f59e0b" strokeWidth={1.5} strokeLinecap="round" opacity={0.85} filter={`url(#${glow})`}/>
      {/* Right claw arm */}
      <line x1={78} y1={23} x2={102} y2={14} stroke="#4a90d9" strokeWidth={2} strokeLinecap="round"/>
      <path d="M102,14 L114,8 L116,15" stroke="#60a5fa" strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M102,14 L112,22 L116,15" stroke="#60a5fa" strokeWidth={1.5} fill="none" strokeLinecap="round" strokeLinejoin="round"/>
      <line x1={116} y1={8} x2={116} y2={22} stroke="#f59e0b" strokeWidth={1.5} strokeLinecap="round" opacity={0.85} filter={`url(#${glow})`}/>
      {/* Antennae */}
      <line x1={54} y1={16} x2={46} y2={4} stroke="#64748b" strokeWidth={1} strokeLinecap="round"/>
      <circle cx={46} cy={4} r={1.5} fill="#60a5fa" opacity={0.8}/>
      <line x1={66} y1={16} x2={74} y2={4} stroke="#64748b" strokeWidth={1} strokeLinecap="round"/>
      <circle cx={74} cy={4} r={1.5} fill="#60a5fa" opacity={0.8}/>
      {/* Body */}
      <ellipse cx={60} cy={28} rx={22} ry={14} fill={`url(#${body})`} stroke="#3878dc" strokeWidth={1.5}/>
      <ellipse cx={60} cy={28} rx={22} ry={14} fill={`url(#${shine})`}/>
      {/* Carapace segment lines */}
      <line x1={60} y1={14.5} x2={60} y2={41.5} stroke="#3878dc" strokeWidth={0.5} opacity={0.4}/>
      <path d="M40,24 Q60,19 80,24" stroke="#3878dc" strokeWidth={0.5} fill="none" opacity={0.5}/>
      <path d="M40,32 Q60,28 80,32" stroke="#3878dc" strokeWidth={0.5} fill="none" opacity={0.5}/>
      {/* Leg joints */}
      <circle cx={44} cy={22} r={2} fill="#334155" stroke="#60a5fa" strokeWidth={0.75}/>
      <circle cx={41} cy={28} r={2} fill="#334155" stroke="#60a5fa" strokeWidth={0.75}/>
      <circle cx={44} cy={34} r={2} fill="#334155" stroke="#60a5fa" strokeWidth={0.75}/>
      <circle cx={76} cy={22} r={2} fill="#334155" stroke="#60a5fa" strokeWidth={0.75}/>
      <circle cx={79} cy={28} r={2} fill="#334155" stroke="#60a5fa" strokeWidth={0.75}/>
      <circle cx={76} cy={34} r={2} fill="#334155" stroke="#60a5fa" strokeWidth={0.75}/>
      {/* Eye sockets */}
      <circle cx={53} cy={21} r={5.5} fill="#050e1a" stroke="#f59e0b" strokeWidth={1.5}/>
      <circle cx={67} cy={21} r={5.5} fill="#050e1a" stroke="#f59e0b" strokeWidth={1.5}/>
      {/* Amber optics */}
      <circle cx={53} cy={21} r={3.5} fill="#f59e0b" filter={`url(#${glow})`} className="bm-eye-amber"/>
      <circle cx={67} cy={21} r={3.5} fill="#f59e0b" filter={`url(#${glow})`} className="bm-eye-amber"/>
      {/* Optic highlights */}
      <circle cx={51.5} cy={19.5} r={1.2} fill="#fef9c3" opacity={0.75}/>
      <circle cx={65.5} cy={19.5} r={1.2} fill="#fef9c3" opacity={0.75}/>
      {/* Central core */}
      <circle cx={60} cy={28} r={3.5} fill="#030d1a" stroke="#f97316" strokeWidth={1.5}/>
      <circle cx={60} cy={28} r={1.8} fill="#f97316" filter={`url(#${glow})`}/>
      {/* Mandibles */}
      <path d="M54,35 Q60,39 66,35" stroke="#3878dc" strokeWidth={1} fill="none" strokeLinecap="round"/>
    </svg>
  );
}

// ── Baba Mimoun Companion Module ──────────────────────────────────────────────
function BabaMimounCompanion({ activity }: { activity: ApiState<ActivityStatus> }) {
  let stateLabel = "AWAITING";
  let dotClass = "unknown-dot";
  let labelClass = "state-unknown";
  let speechLine = "Scanning systems…";
  const pills: React.ReactNode[] = [];

  if (activity.status === "ok") {
    const a = activity.data;
    if (a.state === "active") {
      stateLabel = "ACTIVE";
      dotClass = "active-dot";
      labelClass = "state-active";
      speechLine = `On it — agent active${a.lastEventMs ? `, last event ${timeAgo(new Date(a.lastEventMs))}` : ""}.`;
    } else if (a.state === "idle") {
      stateLabel = "IDLE";
      dotClass = "idle-dot";
      labelClass = "state-idle";
      speechLine = `Standing by${a.lastEventMs ? ` — last seen ${timeAgo(new Date(a.lastEventMs))}` : ". No recent activity detected."}.`;
    } else {
      stateLabel = "AWAITING";
      speechLine = "No transcript activity detected. Waiting for first session.";
    }
    if (a.agent) pills.push(<span key="agent" className="activity-pill">agent: {a.agent}</span>);
    if (a.model) pills.push(<span key="model" className="activity-pill">{a.model.split("-").slice(0, 3).join("-")}</span>);
  } else if (activity.status === "error") {
    speechLine = "Could not read activity data.";
  }

  return (
    <div className="bm-module" style={{ marginTop: 24 }}>
      <div className="bm-module-art">
        <BabaMimounSVG sfx="mod" className="bm-module-svg" />
      </div>
      <div className="bm-module-info">
        <span className="bm-module-name">BABA MIMOUN</span>
        <div className="bm-module-state">
          <span className={`activity-state-dot ${dotClass}`} />
          <span className={`activity-state-label ${labelClass}`}>{stateLabel}</span>
        </div>
        <p className="bm-module-speech">{speechLine}</p>
        {pills.length > 0 && (
          <div className="bm-module-pills">{pills}</div>
        )}
      </div>
    </div>
  );
}

// ── Card Wrapper ──────────────────────────────────────────────────────────────
function Card({
  title,
  children,
  accent,
  badge,
  className,
  headerAction,
}: {
  title: string;
  children: React.ReactNode;
  accent?: "ok" | "warn" | "err" | "accent";
  badge?: React.ReactNode;
  className?: string;
  headerAction?: React.ReactNode;
}) {
  return (
    <div className={`card${accent ? ` card-accent-${accent}` : ""}${className ? ` ${className}` : ""}`}>
      <div className="card-header">
        <span className="card-title">{title}</span>
        <div className="card-header-right">
          {badge && <span className="card-badge">{badge}</span>}
          {headerAction}
        </div>
      </div>
      <div className="card-body">{children}</div>
    </div>
  );
}

function humanizeActivityEvent(ev: ActivityEvent): string {
  const summary = (ev.summary || "").trim();
  if (!summary) return "Background activity recorded.";
  if (/^NO_REPLY$/i.test(summary)) return "Background reply sent";
  if (summary.startsWith("user:")) {
    return summary.slice(5).trim();
  }
  if (/^message\s*\(/i.test(summary)) return "Sent WhatsApp update";
  if (/^exec\s*\(/i.test(summary)) {
    if (/systemctl/i.test(summary)) return "Restarted dashboard service";
    if (/npm run build/i.test(summary)) return "Built dashboard";
    return "Ran shell task";
  }
  if (/^process\s*\(/i.test(summary)) return "Checked background task";
  if (summary.startsWith("✓")) {
    return summary.replace(/^✓\s*/, "Completed step: ");
  }
  if (summary.startsWith("→")) {
    return summary.replace(/^→\s*/, "Running step: ");
  }
  return summary.charAt(0).toUpperCase() + summary.slice(1);
}

function isLowSignalConfirmation(text: string): boolean {
  return /^(ok|okay|yes|yep|yeah|thanks|thank you|perfect|nice|good)$/i.test(text.trim());
}

function summarizeUnderlyingTask(text: string): string {
  const cleaned = text.trim();
  if (!cleaned) return "Internal task";
  if (cleaned.includes("Read HEARTBEAT.md")) return "Heartbeat check";
  if (/dashboard/i.test(cleaned) && /enhancement|enhance|improve|polish|fix|build/i.test(cleaned)) {
    return "Dashboard enhancement request";
  }
  if (/screenshot|image|photo|video/i.test(cleaned)) {
    return "Dashboard review request";
  }
  if (/agent roster|attention panel|command lane/i.test(cleaned)) {
    return "Dashboard feature build request";
  }
  return cleaned.length > 72 ? `${cleaned.slice(0, 69)}...` : cleaned;
}

// ── Activity Card ─────────────────────────────────────────────────────────────
function ActivityCard({ state }: { state: ApiState<ActivityStatus> }) {
  const [expanded, setExpanded] = useState(false);

  if (state.status === "loading") {
    return (
      <Card
        title="NOW WORKING"
        accent="accent"
        className="activity-card"
        headerAction={<Link href="/activity" className="card-link-btn">Open activity</Link>}
      >
        <Skeleton h="80px" />
      </Card>
    );
  }
  if (state.status === "error") {
    return (
      <Card
        title="NOW WORKING"
        className="activity-card"
        headerAction={<Link href="/activity" className="card-link-btn">Open activity</Link>}
      >
        <p className="activity-no-data">No activity data available</p>
      </Card>
    );
  }

  const a = state.data;
  const isActive = a.state === "active";
  const isIdle = a.state === "idle";

  const stateLabel = isActive ? "WORKING" : isIdle ? "IDLE" : "UNKNOWN";
  const dotClass = isActive ? "active-dot" : isIdle ? "idle-dot" : "unknown-dot";
  const labelClass = isActive ? "state-active" : isIdle ? "state-idle" : "state-unknown";
  const accentVariant: "ok" | "warn" | "accent" | undefined =
    isActive ? "ok" : undefined;

  const roleIcon = (role: string) => {
    if (role === "assistant") return "▸";
    if (role === "tool_result") return "✓";
    if (role === "user") return "◂";
    return "·";
  };

  return (
    <Card
      title="NOW WORKING"
      accent={accentVariant}
      className="activity-card"
      headerAction={<Link href="/activity" className="card-link-btn">Open activity</Link>}
    >
      <div className="activity-header">
        <div className="activity-state-badge">
          <span className={`activity-state-dot ${dotClass}`} />
          <span className={`activity-state-label ${labelClass}`}>{stateLabel}</span>
        </div>
        <div className="activity-meta">
          {a.lastEventMs && (
            <>
              <span className="activity-ts-ago">{timeAgo(new Date(a.lastEventMs))}</span>
              <span className="activity-ts">
                {new Date(a.lastEventMs).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })}
              </span>
            </>
          )}
          {a.agent && <span className="activity-pill">agent: {a.agent}</span>}
          {a.sessionId && (
            <span className="activity-pill">
              session: {a.sessionId.slice(0, 8)}
            </span>
          )}
          {a.model && (
            <span className="activity-pill">
              {a.model.split("-").slice(0, 3).join("-")}
            </span>
          )}
        </div>
      </div>

      {a.recentEvents.length > 0 ? (
        <>
          <div className={`activity-timeline${expanded ? " expanded" : ""}`}>
            {a.recentEvents.map((ev, i) => (
              <div key={i} className={`activity-event ev-${ev.role}`}>
                <span className="ev-ts">
                  {new Date(ev.tsMs).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                    second: "2-digit",
                  })}
                </span>
                <span className="ev-icon">{roleIcon(ev.role)}</span>
                <span className="ev-summary">{humanizeActivityEvent(ev)}</span>
              </div>
            ))}
          </div>
          {a.recentEvents.length >= 10 && (
            <button className="more-toggle-btn" type="button" onClick={() => setExpanded(v => !v)}>
              {expanded ? "Show less" : `See more (${a.recentEvents.length} events)`}
            </button>
          )}
        </>
      ) : (
        <p className="activity-no-data">No recent events in transcript</p>
      )}
    </Card>
  );
}

function AttentionCard({ items }: { items: AttentionItem[] }) {
  const criticalCount = items.filter(item => item.severity === "critical").length;
  const warnCount = items.filter(item => item.severity === "warn").length;
  const accentVariant: "err" | "warn" | undefined =
    criticalCount > 0 ? "err" : warnCount > 0 ? "warn" : undefined;

  return (
    <Card
      title="ATTENTION"
      accent={accentVariant}
      className="attention-card"
      badge={
        items.length > 0 ? (
          <Badge variant={criticalCount > 0 ? "err" : warnCount > 0 ? "warn" : "ok"}>
            {items.length} item{items.length !== 1 ? "s" : ""}
          </Badge>
        ) : (
          <Badge variant="ok">clear</Badge>
        )
      }
      headerAction={<Link href="/logs" className="card-link-btn">Open logs</Link>}
    >
      {items.length === 0 ? (
        <div className="attention-empty">
          <div className="attention-empty-title">Nothing needs intervention right now.</div>
          <div className="attention-empty-detail">No critical service, provider, reminder, or runtime issues detected.</div>
        </div>
      ) : (
        <div className="attention-list">
          {items.slice(0, 6).map((item, i) => (
            <div key={i} className={`attention-item sev-${item.severity}`}>
              <div className="attention-item-top">
                <span className={`attention-severity sev-${item.severity}`}>{item.severity}</span>
                <span className="attention-age">{item.age}</span>
              </div>
              <div className="attention-title">{item.title}</div>
              <div className="attention-detail">{item.detail}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ── Services Card ─────────────────────────────────────────────────────────────
function ServicesCard({ state }: { state: ApiState<{ services: ServiceStatus[] }> }) {
  if (state.status === "loading") {
    return (
      <Card title="SERVICES">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <Skeleton h="44px" />
          <Skeleton h="44px" />
          <Skeleton h="44px" />
        </div>
      </Card>
    );
  }
  if (state.status === "error") {
    return (
      <Card title="SERVICES" accent="err">
        <p className="err-msg">{state.error}</p>
      </Card>
    );
  }

  const { services } = state.data;
  const runCount = services.filter(s => s.active === "active" && s.sub === "running").length;

  return (
    <Card
      title="SERVICES"
      badge={
        <Badge variant={runCount === services.length ? "ok" : "warn"}>
          {runCount}/{services.length} up
        </Badge>
      }
    >
      <div className="service-list">
        {services.map(svc => {
          const isRunning = svc.active === "active" && svc.sub === "running";
          const isFailed  = svc.active === "failed";
          const dot: "ok" | "warn" | "err" | "off" = isRunning ? "ok" : isFailed ? "err" : "warn";
          const shortName = svc.name.replace(/\.service$/, "").replace(/^openclaw-/, "");
          return (
            <div key={svc.name} className="service-row">
              <div className="service-row-top">
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <StatusDot state={dot} />
                  <span className="service-name">{shortName}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {svc.pid && svc.pid !== "0" && (
                    <span className="service-meta">PID {svc.pid}</span>
                  )}
                  <Badge variant={isRunning ? "ok" : isFailed ? "err" : "neutral"}>
                    {svc.sub || svc.active}
                  </Badge>
                </div>
              </div>
              <div className="service-row-bottom">
                {svc.memory && svc.memory !== "—" && (
                  <span className="service-meta">mem {svc.memory}</span>
                )}
                {svc.since && svc.since !== "—" && (
                  <span className="service-meta">up {timeAgo(svc.since)}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

// ── Usage Card ────────────────────────────────────────────────────────────────
function formatNumber(n?: number | null): string {
  if (typeof n !== "number" || !isFinite(n)) return "—";
  return new Intl.NumberFormat("en-GB").format(n);
}

function formatUsd(n?: number | null): string {
  if (typeof n !== "number" || !isFinite(n)) return "—";
  return `$${n.toFixed(2)}`;
}

function normalizeModelLabel(model: string): string {
  return model.replace(/^openai-codex\//, "").replace(/^google\//, "");
}

function CostSnapshotCard({
  usageState,
}: {
  usageState: ApiState<UsageMetrics>;
}) {
  const [costState, setCostState] = useState<any>(null);

  useEffect(() => {
    let live = true;
    fetch('/api/cost')
      .then((r) => r.json())
      .then((data) => { if (live) setCostState(data); })
      .catch(() => { if (live) setCostState(null); });
    return () => { live = false; };
  }, []);

  if (usageState.status === "loading" && !costState) {
    return (
      <Card title="COST SNAPSHOT">
        <Skeleton h="120px" />
      </Card>
    );
  }
  if (usageState.status === "error" && !costState) {
    return (
      <Card title="COST SNAPSHOT" accent="err" headerAction={<Link href="/cost" className="card-link-btn">Open cost</Link>}>
        <p className="err-msg">{usageState.error}</p>
      </Card>
    );
  }

  const u = usageState.status === 'ok' ? usageState.data : null;
  const warningCount = Array.isArray(costState?.ledger?.warnings) ? costState.ledger.warnings.length : (u ? u.providerStates.filter((p) => p.status === "warning" || p.status === "exhausted").length : 0);
  const totalUsd = typeof costState?.totals?.totalUsd === 'number' ? costState.totals.totalUsd : (u?.estimatedCostUsd ?? 0);
  const trackedUsd = typeof costState?.totals?.trackedUsd === 'number' ? costState.totals.trackedUsd : (u?.trackedSpendUsd ?? 0);
  const untrackedUsd = typeof costState?.totals?.untrackedUsd === 'number' ? costState.totals.untrackedUsd : (u?.untrackedSpendUsd ?? 0);
  const topModel = costState?.totals?.topModel ?? (u ? [...( u.models ?? [] )].sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd)[0]?.model : null);
  const sessionCount = typeof costState?.totals?.sessionCount === 'number' ? costState.totals.sessionCount : (u?.sessionCount ?? 0);

  return (
    <Card title="COST SNAPSHOT" headerAction={<Link href="/cost" className="card-link-btn">Open cost</Link>}>
      <div className="metric-grid">
        <div className="metric-tile">
          <span className="metric-value">{formatUsd(totalUsd)}</span>
          <span className="metric-label">total estimated</span>
        </div>
        <div className="metric-tile">
          <span className="metric-value">{formatUsd(trackedUsd)}</span>
          <span className="metric-label">tracked</span>
        </div>
        <div className="metric-tile">
          <span className="metric-value">{formatUsd(untrackedUsd)}</span>
          <span className="metric-label">untracked</span>
        </div>
        <div className="metric-tile">
          <span className={`metric-value ${warningCount > 0 ? "" : "metric-accent"}`}>{warningCount}</span>
          <span className="metric-label">warnings</span>
        </div>
      </div>

      <div className="section-row" style={{ marginTop: 10 }}>
        <span className="row-label">top model</span>
        <span className="row-value">{topModel ? normalizeModelLabel(topModel) : "—"}</span>
      </div>
      <div className="section-row">
        <span className="row-label">sessions</span>
        <span className="row-value">{sessionCount}</span>
      </div>
      <div className="section-row">
        <span className="row-label">data source</span>
        <span className="row-value">{costState ? '/api/cost → ~/.openclaw/costs/*' : 'usage fallback'}</span>
      </div>
      <div className="section-row">
        <span className="row-label">note</span>
        <span className="row-value">{costState?.note ?? '—'}</span>
      </div>
    </Card>
  );
}

function UsageCard({
  usageState,
}: {
  usageState: ApiState<UsageMetrics>;
}) {
  const [showMoreModels, setShowMoreModels] = useState(false);
  const [showMoreDetails, setShowMoreDetails] = useState(false);
  if (usageState.status === "loading") {
    return (
      <Card title="USAGE">
        <Skeleton h="70px" />
      </Card>
    );
  }
  if (usageState.status === "error") {
    return (
      <Card title="USAGE" accent="err">
        <p className="err-msg">{usageState.error}</p>
      </Card>
    );
  }

  const u = usageState.data;
  const activeObservedModels = ( u.observedModels ?? [] ).filter((m) => Boolean(m.tokenTracked));
  const inactiveObservedModels = ( u.observedModels ?? [] ).filter((m) => !Boolean(m.tokenTracked));
  const visibleObserved = showMoreModels ? [...activeObservedModels, ...inactiveObservedModels] : activeObservedModels.slice(0, 6);
  const hiddenObserved = showMoreModels ? 0 : Math.max(0, ( u.observedModels ?? [] ).length - visibleObserved.length);

  const activeCapabilities = ( u.capabilities ?? [] ).filter((c) => c.status !== "configured");
  const inactiveCapabilities = ( u.capabilities ?? [] ).filter((c) => c.status === "configured");
  const visibleCapabilities = showMoreDetails ? [...activeCapabilities, ...inactiveCapabilities] : [];
  const topCostModel = [...( u.models ?? [] )].sort((a, b) => b.estimatedCostUsd - a.estimatedCostUsd)[0] ?? null;
  const topCostProvider = [...( u.providerStates ?? [] )].sort((a, b) => b.estimatedSpendUsd - a.estimatedSpendUsd)[0] ?? null;

  return (
    <Card title="USAGE" headerAction={<Link href="/cost" className="card-link-btn">Open cost</Link>}>
      <div className="metric-grid usage-top-grid">
        <div className="metric-tile">
          <span className="metric-value">{u.sessionCount}</span>
          <span className="metric-label">sessions</span>
        </div>
        <div className="metric-tile">
          <span className="metric-value">{u.transcriptFileCount}</span>
          <span className="metric-label">transcripts</span>
        </div>
        <div className="metric-tile">
          <span className={`metric-value metric-accent`}>{u.transcriptTotalFormatted}</span>
          <span className="metric-label">disk</span>
        </div>
        <div className="metric-tile">
          <span className="metric-value">{formatNumber(u.totalTokens)}</span>
          <span className="metric-label">tokens</span>
        </div>
        <div className="metric-tile">
          <span className="metric-value">{formatUsd(u.estimatedCostUsd)}</span>
          <span className="metric-label">est. cost</span>
        </div>
        <div className="metric-tile">
          <span className="metric-value">{formatNumber(u.totalInputTokens)}</span>
          <span className="metric-label">input</span>
        </div>
        <div className="metric-tile">
          <span className="metric-value">{formatNumber(u.totalOutputTokens)}</span>
          <span className="metric-label">output</span>
        </div>
      </div>

      <div className="section-row" style={{ marginTop: 10 }}>
        <span className="row-label">sessions with token data</span>
        <span className="row-value">{u.sessionsWithUsage}/{u.sessionCount}</span>
      </div>
      {u.lastActivityTs && (
        <div className="section-row">
          <span className="row-label">last activity</span>
          <span className="row-value">{timeAgo(u.lastActivityTs)}</span>
        </div>
      )}
      <div className="section-row">
        <span className="row-label">cost estimate</span>
        <span className="row-value">{u.tokenCost === "estimated" ? `${formatUsd(u.estimatedCostUsd)} (estimated from token pricing)` : "unavailable (billing source not wired yet)"}</span>
      </div>
      <div className="section-row">
        <span className="row-label">tracked spend</span>
        <span className="row-value">{formatUsd(u.trackedSpendUsd)}</span>
      </div>
      <div className="section-row">
        <span className="row-label">untracked spend</span>
        <span className="row-value">{formatUsd(u.untrackedSpendUsd)}</span>
      </div>
      <div className="section-row">
        <span className="row-label">top cost model</span>
        <span className="row-value">{topCostModel ? `${normalizeModelLabel(topCostModel.model)} · ${formatUsd(topCostModel.estimatedCostUsd)}` : "—"}</span>
      </div>
      <div className="section-row">
        <span className="row-label">top cost provider</span>
        <span className="row-value">{topCostProvider ? `${topCostProvider.label} · ${formatUsd(topCostProvider.estimatedSpendUsd)}` : "—"}</span>
      </div>
      {u.staleUsageSessions > 0 && (
        <div className="section-row">
          <span className="row-label">stale token snapshots</span>
          <span className="row-value">{u.staleUsageSessions}</span>
        </div>
      )}

      {u.providerStates.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="chart-label" style={{ marginBottom: 6 }}>
            provider accounting state
          </div>
          <div className="usage-capability-list">
            {u.providerStates.map((p) => (
              <div key={p.provider} className="usage-capability-row">
                <div className="usage-capability-main">
                  <span className="session-id">{p.label}</span>
                  <span className="session-channel">est. {formatUsd(p.estimatedSpendUsd)} · Δ {formatUsd(p.deltaSinceRememberedUsd ?? 0)}</span>
                </div>
                <div className="usage-session-side">
                  <span className={`usage-source-chip ${p.status === 'exhausted' ? 'untracked' : 'tracked'}`}>{p.status}</span>
                  <span className="session-time">{p.source}{p.liveDataAvailable ? ' live' : ' fallback'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showMoreDetails && u.models.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="chart-label" style={{ marginBottom: 6 }}>
            estimated cost by model
          </div>
          <div className="usage-session-list">
            {u.models.slice(0, 5).map((m) => (
              <div key={`${m.provider}-${m.model}`} className="usage-session-row">
                <div className="usage-session-main">
                  <span className="session-id">{normalizeModelLabel(m.model)}</span>
                  <span className="session-channel">{m.provider}</span>
                </div>
                <div className="usage-session-side">
                  <span className="usage-token-chip">{formatUsd(m.estimatedCostUsd)}</span>
                  <span className="session-time">{formatNumber(m.totalTokens)} tok</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showMoreDetails && u.topSessions.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="chart-label" style={{ marginBottom: 6 }}>
            heaviest sessions by total tokens / estimated cost
          </div>
          <div className="usage-session-list">
            {u.topSessions.map((s) => (
              <div key={s.sessionId} className="usage-session-row">
                <div className="usage-session-main">
                  <span className="session-id">{s.sessionId.slice(0, 8)}</span>
                  <span className="session-channel">{s.model}</span>
                </div>
                <div className="usage-session-side">
                  <span className="usage-token-chip">{formatUsd(s.estimatedCostUsd)}</span>
                  <span className="usage-token-chip">{formatNumber(s.totalTokens)} tok</span>
                  <span className="session-time">{timeAgo(new Date(s.updatedAt))}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {( u.observedModels ?? [] ).length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="chart-label" style={{ marginBottom: 6 }}>
            model usage · tracked models shown first
          </div>
          <div className="usage-capability-list">
            {visibleObserved.map((m) => (
              <div key={`${m.provider}-${m.model}`} className="usage-capability-row">
                <div className="usage-capability-main">
                  <span className="session-id">{normalizeModelLabel(m.model)}</span>
                  <span className="session-channel">{m.provider}</span>
                </div>
                <div className="usage-session-side">
                  <span className={`usage-source-chip ${m.tokenTracked ? "tracked" : "untracked"}`}>{m.tokenTracked ? "tracked" : "outside criteria"}</span>
                  <span className="session-time">{m.lastSeenTs ? timeAgo(new Date(m.lastSeenTs)) : m.source}</span>
                </div>
              </div>
            ))}
            {hiddenObserved > 0 && (
              <button className="more-toggle-btn" type="button" onClick={() => setShowMoreModels(v => !v)}>
                {showMoreModels ? "Show less" : `See more (+${hiddenObserved} models outside criteria)`}
              </button>
            )}
          </div>
        </div>
      )}

      <button className="more-toggle-btn usage-master-toggle" type="button" onClick={() => setShowMoreDetails(v => !v)}>
        {showMoreDetails
          ? "Show less details"
          : `See more details (+${u.topSessions.length} sessions, +${u.capabilities.length} capabilities)`}
      </button>

      {showMoreDetails && u.categoryBreakdown.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="chart-label" style={{ marginBottom: 6 }}>
            tracked vs untracked cost by category
          </div>
          <div className="usage-session-list">
            {u.categoryBreakdown.map((c) => (
              <div key={c.category} className="usage-session-row">
                <div className="usage-session-main">
                  <span className="session-id">{c.category}</span>
                  <span className="session-channel">{c.tracked ? 'tracked' : 'unknown'}</span>
                </div>
                <div className="usage-session-side">
                  <span className="usage-token-chip">{formatUsd(c.estimatedCostUsd)}</span>
                  <span className="session-time">{c.sessions} session(s)</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showMoreDetails && u.pricingReference.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="chart-label" style={{ marginBottom: 6 }}>
            pricing reference
          </div>
          <div className="usage-capability-list">
            {u.pricingReference.map((p) => (
              <div key={p.model} className="usage-capability-row">
                <div className="usage-capability-main">
                  <span className="session-id">{normalizeModelLabel(p.model)}</span>
                  <span className="session-channel">in {p.inputPerMillionUsd == null ? '—' : `$${p.inputPerMillionUsd}/1M`} | out {p.outputPerMillionUsd == null ? '—' : `$${p.outputPerMillionUsd}/1M`}</span>
                </div>
                <div className="usage-session-side">
                  <span className={`usage-source-chip ${p.confidence === 'unknown' ? 'untracked' : 'tracked'}`}>{p.confidence}</span>
                  <span className="session-time">{p.source}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {showMoreDetails && u.capabilities.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div className="chart-label" style={{ marginBottom: 6 }}>
            capabilities used · configured-only hidden by default
          </div>
          <div className="usage-capability-list">
            {visibleCapabilities.map((c) => (
              <div key={`${c.kind}-${c.provider}-${c.model}`} className="usage-capability-row">
                <div className="usage-capability-main">
                  <span className="session-id">{normalizeModelLabel(c.model)}</span>
                  <span className="session-channel">{c.kind}</span>
                </div>
                <div className="usage-session-side">
                  <span className="usage-source-chip tracked">{c.status}</span>
                  <span className="session-time">{c.provider}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

// ── Credentials Card ──────────────────────────────────────────────────────────
function CredentialsCard({
  state,
}: {
  state: ApiState<{ credentials: CredentialStatus[] }>;
}) {
  if (state.status === "loading") {
    return (
      <Card title="CREDENTIALS">
        <Skeleton h="60px" />
      </Card>
    );
  }
  if (state.status === "error") {
    return (
      <Card title="CREDENTIALS" accent="err">
        <p className="err-msg">{state.error}</p>
      </Card>
    );
  }

  const { credentials } = state.data;
  const presentCount = credentials.filter(c => c.present).length;

  return (
    <Card
      title="CREDENTIALS"
      badge={
        <Badge variant={presentCount > 0 ? "ok" : "neutral"}>
          {presentCount}/{credentials.length}
        </Badge>
      }
    >
      <div className="cred-list">
        {credentials.map(cred => (
          <div key={cred.provider} className="cred-row">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <StatusDot state={cred.present ? "ok" : "off"} />
              <span className="cred-name">{cred.provider}</span>
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                flexWrap: "wrap",
                justifyContent: "flex-end",
              }}
            >
              {cred.present && cred.accounts.length > 0 ? (
                <>
                  {cred.accounts.slice(0, 2).map(a => (
                    <span key={a} className="cred-account">{a}</span>
                  ))}
                  {cred.accounts.length > 2 && (
                    <span className="service-meta">+{cred.accounts.length - 2}</span>
                  )}
                </>
              ) : (
                <Badge variant="neutral">absent</Badge>
              )}
            </div>
          </div>
        ))}
        {credentials.length === 0 && (
          <p className="empty-msg">No credentials configured</p>
        )}
      </div>
    </Card>
  );
}

// ── Sessions Card ─────────────────────────────────────────────────────────────
function SessionsCard({
  state,
}: {
  state: ApiState<{ sessions: SessionEntry[]; transcripts: TranscriptInfo[] }>;
}) {
  if (state.status === "loading") {
    return (
      <Card title="SESSIONS">
        <Skeleton h="120px" />
      </Card>
    );
  }
  if (state.status === "error") {
    return (
      <Card title="SESSIONS" accent="err">
        <p className="err-msg">{state.error}</p>
      </Card>
    );
  }

  const { sessions } = state.data;
  const shown = sessions.slice(0, 7);

  return (
    <Card
      title="SESSIONS"
      badge={<span className="count-badge">{sessions.length}</span>}
    >
      {shown.length === 0 ? (
        <p className="empty-msg">No sessions found</p>
      ) : (
        <div className="session-list">
          {shown.map(s => (
            <Link key={s.sessionId} href={`/session/${s.sessionId}`} className="session-row session-link-row">

              <div className="session-row-left">
                <span className="session-id">{s.sessionId.slice(0, 8)}</span>
                <span className="session-channel">{s.channel || s.chatType}</span>
              </div>
              <div className="session-row-right">
                <span className="session-model">
                  {s.model ? s.model.split("-").slice(0, 2).join("-") : "—"}
                </span>
                <span className="session-time">{timeAgo(s.updatedAt)}</span>
              </div>
            </Link>
          ))}
          {sessions.length > shown.length && (
            <div className="more-row">+{sessions.length - shown.length} more</div>
          )}
        </div>
      )}
    </Card>
  );
}

function AgentRosterCard({ items }: { items: AgentRosterItem[] }) {
  const activeCount = items.filter(item => item.status === "active").length;
  const stalledCount = items.filter(item => item.status === "stalled").length;
  const quietCount = items.filter(item => item.status === "quiet").length;
  const accentVariant: "err" | "warn" | undefined =
    stalledCount > 0 ? "err" : activeCount > 0 || quietCount > 0 ? "warn" : undefined;

  return (
    <Card
      title="AGENT ROSTER"
      accent={accentVariant}
      className="agent-roster-card"
      badge={<span className="count-badge">{items.length}</span>}
      headerAction={
        items[0]
          ? <Link href={`/session/${items[0].id}`} className="card-link-btn">Open session</Link>
          : <Link href="/activity" className="card-link-btn">Open activity</Link>
      }
    >
      {items.length === 0 ? (
        <p className="empty-msg">No active agent sessions found</p>
      ) : (
        <div className="agent-roster-list">
          {items.slice(0, 6).map(item => (
            <div key={item.id} className="agent-roster-row">
              <div className="agent-roster-main">
                <div className="agent-roster-top">
                  <span className="agent-name">{item.label}</span>
                  <div className="agent-top-badges">
                    <span className={`agent-health health-${item.health}`}>{item.health}</span>
                    <span className={`agent-status status-${item.status}`}>{item.status}</span>
                  </div>
                </div>
                <div className="agent-task">{item.task}</div>
                <div className="agent-meta-row">
                  <span className="agent-pill">{item.runtimeType}</span>
                  <span className="agent-pill">{item.model}</span>
                  <span className="agent-pill">{item.tokenText}</span>
                  <span className="agent-pill">{item.contextText}</span>
                  <span className="agent-pill">{item.cacheText}</span>
                  <span className={`agent-pill agent-rec rec-${item.recommendation}`}>{item.recommendation}</span>
                </div>
              </div>
              <div className="agent-roster-side">
                <span>{item.lastActivity}</span>
                <span>{item.sessionAge}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function CommandLaneCard({ items }: { items: CommandLaneItem[] }) {
  const failedCount = items.filter(item => item.status === "failed").length;
  const runningCount = items.filter(item => item.status === "running").length;
  const accentVariant: "err" | "warn" | undefined =
    failedCount > 0 ? "err" : runningCount > 0 ? "warn" : undefined;

  return (
    <Card
      title="COMMAND LANE"
      accent={accentVariant}
      className="command-lane-card"
      badge={<span className="count-badge">{items.length}</span>}
      headerAction={<Link href="/logs" className="card-link-btn">Open logs</Link>}
    >
      {items.length === 0 ? (
        <p className="empty-msg">No recent commands found</p>
      ) : (
        <div className="command-lane-list">
          {items.slice(0, 5).map(item => (
            <div key={item.id} className="command-lane-row">
              <div className="command-lane-top">
                <span className={`command-status status-${item.status}`}>{item.status}</span>
                <span className="command-age">{item.age}</span>
                {item.model && <span className="activity-pill">{item.model.split("-").slice(0, 2).join("-")}</span>}
              </div>
              <div className="command-text">{item.commandText}</div>
              <div className="command-detail">{item.detail}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ── Transcripts Card ──────────────────────────────────────────────────────────
function TranscriptsCard({
  state,
}: {
  state: ApiState<{ sessions: SessionEntry[]; transcripts: TranscriptInfo[] }>;
}) {
  if (state.status === "loading") {
    return (
      <Card title="TRANSCRIPTS">
        <Skeleton h="120px" />
      </Card>
    );
  }
  if (state.status === "error") {
    return (
      <Card title="TRANSCRIPTS" accent="err">
        <p className="err-msg">{state.error}</p>
      </Card>
    );
  }

  const { transcripts } = state.data;
  const shown = transcripts.slice(0, 7);
  const agentCounts = deriveAgentCounts(transcripts);
  const maxCount = agentCounts[0]?.count ?? 1;

  return (
    <Card
      title="TRANSCRIPTS"
      badge={<span className="count-badge">{transcripts.length}</span>}
    >
      {shown.length === 0 ? (
        <p className="empty-msg">No transcripts found</p>
      ) : (
        <>
          <div className="transcript-list">
            {shown.map(t => (
              <div key={t.fileName} className="transcript-row">
                <span className="transcript-agent">{t.agentName}</span>
                <span className="transcript-size">{t.sizeFormatted}</span>
                <span className="transcript-time">{timeAgo(t.modifiedAt)}</span>
              </div>
            ))}
            {transcripts.length > shown.length && (
              <div className="more-row">+{transcripts.length - shown.length} more</div>
            )}
          </div>

          {agentCounts.length > 1 && (
            <div style={{ marginTop: 12 }}>
              <div className="chart-label" style={{ marginBottom: 6 }}>
                by agent · all transcripts
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {agentCounts.map(({ agent, count }) => (
                  <HorizBar
                    key={agent}
                    label={agent.length > 16 ? agent.slice(0, 14) + "…" : agent}
                    value={count}
                    max={maxCount}
                    color="var(--accent-2)"
                  />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

// ── Logs Card ─────────────────────────────────────────────────────────────────
function LogsCard({
  state,
}: {
  state: ApiState<{ entries: LogEntry[]; logFile: string | null }>;
}) {
  if (state.status === "loading") {
    return (
      <Card title="GATEWAY LOGS">
        <Skeleton h="160px" />
      </Card>
    );
  }
  if (state.status === "error") {
    return (
      <Card title="GATEWAY LOGS" accent="err">
        <p className="err-msg">{state.error}</p>
      </Card>
    );
  }

  const { entries, logFile } = state.data;
  const alerts = entries.filter(e => e.tier !== "INFO");

  const hasIncidents = alerts.some(a => a.tier === "INCIDENT");
  const cardAccent = hasIncidents ? "err" : alerts.length > 0 ? "warn" : undefined;

  const freqData = deriveLogFrequency(entries, 18);
  const hasFreq = freqData.some(v => v > 0);

  return (
    <Card
      title="GATEWAY LOGS"
      accent={cardAccent}
      badge={
        alerts.length > 0 ? (
          <Badge variant={hasIncidents ? "err" : "warn"}>
            {alerts.length} alert{alerts.length !== 1 ? "s" : ""}
          </Badge>
        ) : undefined
      }
      headerAction={
        <div className="card-header-right-actions">
          <Link href="/incidents" className="card-link-btn">Incidents</Link>
          <Link href="/logs" className="card-link-btn">Open logs</Link>
        </div>
      }
    >
      {logFile && (
        <div className="log-path">{logFile.split("/").pop()}</div>
      )}

      {hasFreq && (
        <div style={{ marginBottom: 10 }}>
          <div className="chart-label" style={{ marginBottom: 4 }}>
            entry frequency · current log file
          </div>
          <SparkBars
            values={freqData}
            height={26}
            color={hasIncidents ? "var(--err)" : alerts.length > 0 ? "var(--warn)" : "var(--accent)"}
          />
        </div>
      )}

      <div className="log-section">
        <div className="log-section-label">recent alerts</div>
        <div className="log-lines">
          {alerts.slice(0, 8).map((e, i) => (
            <div
              key={i}
              className={`log-line log-${e.tier === "INCIDENT" ? "err" : "warn"}`}
            >
              <span className="log-ts">
                {e.time ? new Date(e.time).toLocaleTimeString() : ""}
              </span>
              <span className="log-level">{e.tier}</span>
              <span className="log-msg">{e.message}</span>
            </div>
          ))}
          {alerts.length === 0 && <p className="empty-msg" style={{ padding: "6px 8px" }}>No current alerts</p>}
        </div>
      </div>
    </Card>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
export default function Dashboard() {
  const [services, setServices] = useState<ApiState<{ services: ServiceStatus[] }>>({
    status: "loading",
  });
  const [sessionsData, setSessionsData] = useState<
    ApiState<{ sessions: SessionEntry[]; transcripts: TranscriptInfo[] }>
  >({ status: "loading" });
  const [credentials, setCredentials] = useState<
    ApiState<{ credentials: CredentialStatus[] }>
  >({ status: "loading" });
  const [logs, setLogs] = useState<
    ApiState<{ entries: LogEntry[]; logFile: string | null }>
  >({ status: "loading" });
  const [usage, setUsage] = useState<ApiState<UsageMetrics>>({ status: "loading" });
  const [activity, setActivity] = useState<ApiState<ActivityStatus>>({ status: "loading" });
  const [infra, setInfra] = useState<ApiState<InfraSnapshot>>({ status: "loading" });
  const [reminders, setReminders] = useState<ApiState<ReminderSnapshot>>({ status: "loading" });
  const [projects, setProjects] = useState<ApiState<{ version: number; items: Project[] }>>({ status: "loading" });
  const [providerState, setProviderState] = useState<ApiState<ProviderState | null>>({ status: "loading" });
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);
  const [refreshIntervalMs, setRefreshIntervalMs] = useState(30000);
  const [todayStr] = useState(() => {
    const d = new Date();
    return d.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" }).toUpperCase();
  });
  const [isCompactHeader, setIsCompactHeader] = useState(false);

  const fetchAll = useCallback(async () => {
    setRefreshing(true);

    async function fetcher<T>(url: string): Promise<ApiState<T>> {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 20000);
        const res = await fetch(url, { signal: ctrl.signal });
        clearTimeout(timer);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as T;
        return { status: "ok", data };
      } catch (e) {
        return { status: "error", error: (e as Error).message };
      }
    }

    const [svc, sess, cred, logsR, usg, act, inf, rem, proj, prov] = await Promise.all([
      fetcher<{ services: ServiceStatus[] }>("/api/services"),
      fetcher<{ sessions: SessionEntry[]; transcripts: TranscriptInfo[] }>("/api/sessions"),
      fetcher<{ credentials: CredentialStatus[] }>("/api/credentials"),
      fetcher<{ entries: LogEntry[]; logFile: string | null }>("/api/logs"),
      fetcher<UsageMetrics>("/api/usage"),
      fetcher<ActivityStatus>("/api/activity"),
      fetcher<InfraSnapshot>("/api/infra"),
      fetcher<ReminderSnapshot>("/api/reminders"),
      fetcher<{ version: number; items: Project[] }>("/api/projects"),
      fetcher<ProviderState | null>("/api/status").then(s => 
        s.status === 'ok' && s.data && typeof s.data === 'object' && 'providerState' in s.data
          ? { status: 'ok', data: (s.data as any).providerState } as ApiState<ProviderState | null> 
          : { status: 'ok', data: null } as ApiState<ProviderState | null>
      ),
    ]);

    setServices(svc);
    setSessionsData(sess);
    setCredentials(cred);
    setLogs(logsR);
    setUsage(usg);
    setActivity(act);
    setInfra(inf);
    setReminders(rem);
    setProjects(proj);
    setProviderState(prov);
    setLastRefresh(new Date());
    setRefreshing(false);
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    const apply = () => setIsCompactHeader(window.innerWidth <= 600);
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, []);

  useEffect(() => {
    if (!autoRefreshEnabled) return;
    const id = window.setInterval(() => {
      fetchAll();
    }, refreshIntervalMs);
    return () => window.clearInterval(id);
  }, [autoRefreshEnabled, refreshIntervalMs, fetchAll]);

  const refreshLabel = useMemo(() => {
    if (refreshIntervalMs < 60000) return `${Math.round(refreshIntervalMs / 1000)}s`;
    return `${Math.round(refreshIntervalMs / 60000)}m`;
  }, [refreshIntervalMs]);

  // Overall health
  const overallHealth: "ok" | "warn" | "err" = useMemo(() => {
    if (services.status !== "ok" || logs.status !== "ok") return "warn";
    return computeSystemHealth(services.data.services, logs.data.entries);
  }, [services, logs]);

  const healthLabel =
    overallHealth === "ok"
      ? "ALL SYSTEMS NOMINAL"
      : overallHealth === "err"
      ? "DEGRADED"
      : "PARTIAL";

  const attentionItems = useMemo<AttentionItem[]>(() => {
    const items: AttentionItem[] = [];

    if (services.status === "ok") {
      services.data.services
        .filter(s => s.active === "failed")
        .slice(0, 2)
        .forEach(s => {
          items.push({
            severity: "critical",
            title: `${s.name} failed`,
            detail: `Service is in failed state${s.sub ? ` (${s.sub})` : ""}.`,
            age: s.since ? timeAgo(s.since) : "now",
          });
        });
    }

    if (providerState.status === "ok" && providerState.data) {
      Object.entries(providerState.data.providers).forEach(([id, info]) => {
        if (info.status !== 'active') {
          items.push({
            severity: ["exhausted", "dead", "auth-failed"].includes(info.status) ? "critical" : "warn",
            title: `${id.toUpperCase()} provider ${info.status}`,
            detail: info.note || `Provider status reported as ${info.status}.`,
            age: timeAgo(providerState.data!.last_updated),
          });
        }
      });
    }

    if (reminders.status === "ok" && reminders.data.followUpDueCount > 0) {
      items.push({
        severity: "warn",
        title: `Reminder follow-up due (${reminders.data.followUpDueCount})`,
        detail: reminders.data.statusLine,
        age: "now",
      });
    }

    if (activity.status === "ok") {
      const lastEventAgeMs = activity.data.lastEventMs ? Date.now() - activity.data.lastEventMs : null;
      if (activity.data.state === "active" && lastEventAgeMs !== null && lastEventAgeMs > 10 * 60 * 1000) {
        items.push({
          severity: "warn",
          title: "Active session may be stalled",
          detail: `Marked active, but last event was ${timeAgo(new Date(activity.data.lastEventMs!))}.`,
          age: timeAgo(new Date(activity.data.lastEventMs!)),
        });
      }
    }

    if (infra.status === "ok") {
      infra.data.endpoints
        .filter(endpoint => endpoint.ok === false)
        .slice(0, 2)
        .forEach(endpoint => {
          items.push({
            severity: "critical",
            title: `${endpoint.label} endpoint failing`,
            detail: endpoint.statusCode ? `HTTP ${endpoint.statusCode}.` : "No successful response.",
            age: "now",
          });
        });
    }

    if (logs.status === "ok") {
      const filteredLogs = logs.data.entries.filter(e => {
        const msg = e.message || "";
        const lowMsg = msg.toLowerCase();
        
        // CLASSIFY AS INFO (never show in attention panel)
        if (lowMsg.includes("failovererror") && /responded to user/i.test(lowMsg)) return false;
        if (lowMsg.includes("model_fallback_decision") || 
            lowMsg.includes("candidate_failed") || 
            lowMsg.includes("failover_decision")) return false;
        if (e.module === "diagnostic" || lowMsg.includes("diagnostic")) return false;
        if (lowMsg.includes("elevenlabs provider unknown")) return false;
        if (lowMsg.includes("heartbeat") || lowMsg.includes("cron timer") || /wa (inbound|outbound)/i.test(lowMsg)) return false;
        
        return true;
      });

      const warnings = filteredLogs.filter(e => {
        const lowMsg = (e.message || "").toLowerCase();
        
        // CLASSIFY AS WARNING (show in attention, yellow)
        // Provider billing/auth errors (should ideally check provider-state.json, 
        // but here we check the log message for those indicators too)
        if (/billing|auth|credit|balance|quota/i.test(lowMsg)) return true;
        // Single model confirmed dead (404)
        if (lowMsg.includes("404") && /model/i.test(lowMsg)) return true;
        
        return e.tier === "WARNING";
      });

      warnings.slice(0, 3).forEach(w => {
        // Hide raw JSON or parse it
        let detail = w.message;
        if (detail.trim().startsWith("{") || detail.toLowerCase().includes("subsystem")) {
          return; // Hide from attention
        }

        items.push({
          severity: "warn",
          title: "System Warning",
          detail: detail,
          age: timeAgo(w.time),
        });
      });
      
      const incidents = filteredLogs.filter(e => {
        const lowMsg = (e.message || "").toLowerCase();

        // CLASSIFY AS CRITICAL (show in attention, red)
        if (lowMsg.includes("gateway service down") || 
            lowMsg.includes("tunnel down") || 
            (lowMsg.includes("all models failed") && lowMsg.includes("no response"))) return true;

        return e.tier === "INCIDENT";
      });

      incidents.slice(0, 3).forEach(i => {
        let detail = i.message;
        if (detail.trim().startsWith("{") || detail.toLowerCase().includes("subsystem")) {
          return; // Hide from attention
        }

        items.push({
          severity: "critical",
          title: "System Incident",
          detail: detail,
          age: timeAgo(i.time),
        });
      });
    }

    return items
      .sort((a, b) => {
        const rank = { critical: 0, warn: 1, info: 2 } as const;
        return rank[a.severity] - rank[b.severity];
      })
      .slice(0, 6);
  }, [activity, infra, logs, reminders, services, providerState]);

  const agentRoster = useMemo<AgentRosterItem[]>(() => {
    if (sessionsData.status !== "ok") return [];

    const modelCostMap = new Map(
      usage.status === "ok"
        ? usage.data.models.map(model => [model.model, model])
        : []
    );
    const transcriptMap = new Map(
      sessionsData.data.transcripts.map(transcript => [transcript.sessionId, transcript])
    );
    
    return sessionsData.data.sessions
      .slice()
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .filter((session, index, arr) => arr.findIndex(candidate => candidate.sessionId === session.sessionId) === index)
      .slice(0, 6)
      .map((session, index) => {
        const lastMs = new Date(session.updatedAt).getTime();
        const ageMs = Date.now() - lastMs;
        const hasLiveTask =
          activity.status === "ok" &&
          activity.data.sessionId === session.sessionId &&
          activity.data.state === "active";

        const status: AgentRosterItem["status"] = hasLiveTask && ageMs > 15 * 60 * 1000
          ? "stalled"
          : ageMs < 2 * 60 * 1000
          ? "active"
          : ageMs <= 15 * 60 * 1000
          ? "idle"
          : "quiet";
        const modelUsage = modelCostMap.get(session.model);
        const tokenTotal = session.totalTokens ?? modelUsage?.totalTokens ?? 0;
        const role: AgentRosterItem["runtimeType"] =
          index === 0 || (activity.status === "ok" && activity.data.sessionId === session.sessionId)
            ? "main"
            : "session";
        const compactModel = session.model ? session.model.split("-").slice(0, 3).join("-") : "—";
        const transcript = transcriptMap.get(session.sessionId);
        const transcriptBytes = transcript?.size ?? 0;

        const rawTask =
          activity.status === "ok" && activity.data.sessionId === session.sessionId
            ? activity.data.recentEvents[0]?.summary || "Active transcript events"
            : `Channel ${session.channel || session.chatType || "unknown"}`;

        const cleanedTask = !rawTask || /^NO_REPLY$/i.test(rawTask.trim())
          ? activity.status === "ok" && activity.data.sessionId === session.sessionId
            ? "Waiting for next command"
            : "Recent session activity"
          : /<media:/i.test(rawTask)
          ? "Recent media activity"
          : rawTask;

        const contextPct = Math.max(0, Math.min(100, Math.round((tokenTotal / 200000) * 100)));
        const cachePct = transcriptBytes > 0 ? Math.max(0, Math.min(100, Math.round((transcriptBytes / (2 * 1024 * 1024)) * 100))) : 0;
        const tokenText = tokenTotal > 0 ? `${formatNumber(tokenTotal)} tok` : "tok n/a";
        const contextText = tokenTotal > 0 ? `context ${contextPct}%` : "context n/a";
        const cacheText = transcript ? `${cachePct}% · ${transcript.sizeFormatted}` : "cache n/a";

        const health: AgentRosterItem["health"] =
          status === "stalled" ? "blocked" : "healthy";

        const recommendation: AgentRosterItem["recommendation"] =
          status === "stalled"
            ? (contextPct >= 85 || transcriptBytes >= 1024 * 1024 ? "recreate" : "reset")
            : contextPct >= 85 || transcriptBytes >= 1024 * 1024
            ? "recreate"
            : contextPct >= 65 || transcriptBytes >= 512 * 1024 || status === "quiet"
            ? "refresh"
            : "keep";

        return {
          id: session.sessionId,
          label: index === 0 ? "Main agent" : `Session ${session.sessionId.slice(0, 8)}`,
          runtimeType: role,
          model: compactModel,
          status,
          health,
          task: cleanedTask,
          lastActivity: `last ${timeAgo(session.updatedAt)}`,
          sessionAge: `updated ${new Date(session.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`,
          tokenText,
          contextText,
          cacheText,
          recommendation,
        };
      });
  }, [activity, sessionsData, usage]);

  const commandLane = useMemo<CommandLaneItem[]>(() => {
    if (activity.status !== "ok") return [];

    const events = [...activity.data.recentEvents].sort((a, b) => a.tsMs - b.tsMs);
    const userEvents = (activity.data.recentCommandEvents?.length
      ? [...activity.data.recentCommandEvents].sort((a, b) => a.tsMs - b.tsMs)
      : events.filter(event => event.role === "user"))
      .slice(-8);

    const rows = userEvents.map((userEvent) => {
      const userIndex = events.findIndex(event => event.tsMs === userEvent.tsMs && event.summary === userEvent.summary);
      const laterUserIndex = events.findIndex((event, index) => index > userIndex && event.role === "user");
      const relevant = userIndex >= 0
        ? events.slice(userIndex + 1, laterUserIndex >= 0 ? laterUserIndex : undefined)
        : [];

      const toolEvents = relevant.filter(event => event.role === "tool_result");
      const assistantEvents = relevant.filter(event => event.role === "assistant");
      
      const completionEvent = assistantEvents.find(event => !/^NO_REPLY$/i.test((event.summary || "").trim()));
      const failedEvent = relevant.find(event => /error|failed/i.test(event.summary || ""));

      let status: CommandLaneItem["status"] = "done";
      let detail = "Reply sent";
      let modelUsed = "";

      if (failedEvent) {
        status = "failed";
        detail = humanizeActivityEvent(failedEvent);
      } else if (completionEvent) {
        status = "done";
        detail = humanizeActivityEvent(completionEvent);
        modelUsed = completionEvent.model || "";
      } else if (toolEvents.length > 0) {
        status = "running";
        detail = humanizeActivityEvent(toolEvents[toolEvents.length - 1]);
      }

      let commandText = summarizeUnderlyingTask(userEvent.summary.replace(/^user:\s*/i, ""));

      return {
        id: `${userEvent.tsMs}`,
        commandText,
        status,
        age: timeAgo(new Date(userEvent.tsMs)),
        detail,
        model: modelUsed
      };
    });

    return rows.reverse().slice(0, 5);
  }, [activity]);

  const isInitialLoading =
    services.status === "loading" &&
    sessionsData.status === "loading" &&
    credentials.status === "loading" &&
    logs.status === "loading" &&
    usage.status === "loading" &&
    activity.status === "loading" &&
    infra.status === "loading" &&
    reminders.status === "loading" &&
    projects.status === "loading";

  return (
    <div className="page-root">
      {/* Loading screen — shown until first data arrives */}
      {isInitialLoading && (
        <div className="bm-loading-screen" aria-label="Loading dashboard">
          <BabaMimounSVG sfx="ls" className="bm-loading-mascot" />
          <p className="bm-loading-label">INITIALIZING</p>
          <div className="bm-loading-dots">
            <span /><span /><span />
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <header className={`page-header${isCompactHeader ? " compact-header" : ""}`}>
        <div className="header-left">
          <div className="header-brand">
            <span className="header-title">{isCompactHeader ? "BABA OPS" : "BABA-MIMOUN OPS"}</span>
          </div>
          {!isCompactHeader ? (
            <div className={`health-pill health-${overallHealth}`}>
              <span className="health-dot" />
              {healthLabel}
            </div>
          ) : (
            <div className="header-compact-meta">
              <div className={`health-pill health-${overallHealth}`}>
                <span className="health-dot" />
                {healthLabel}
              </div>
              {lastRefresh && (
                <span className="last-refresh compact-refresh">
                  {timeAgo(lastRefresh)}{autoRefreshEnabled ? ` · ${refreshLabel}` : ""}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="header-right">
          {!isCompactHeader && <span className="header-date">{todayStr}</span>}
          {lastRefresh && !isCompactHeader && (
            <span className="last-refresh">
              updated {timeAgo(lastRefresh)}{autoRefreshEnabled ? ` · auto ${refreshLabel}` : ""}
            </span>
          )}
          <div className="refresh-controls">
            <button
              className={`refresh-btn refresh-toggle${autoRefreshEnabled ? " auto-on" : ""}`}
              onClick={() => setAutoRefreshEnabled(v => !v)}
              aria-label="Toggle auto refresh"
              type="button"
            >
              {autoRefreshEnabled ? (isCompactHeader ? "auto" : "auto on") : (isCompactHeader ? "manual" : "auto off")}
            </button>
            <select
              className="refresh-select"
              value={refreshIntervalMs}
              onChange={(e) => setRefreshIntervalMs(Number(e.target.value))}
              aria-label="Auto refresh interval"
              disabled={!autoRefreshEnabled}
            >
              <option value={15000}>15s</option>
              <option value={30000}>30s</option>
              <option value={60000}>1m</option>
              <option value={300000}>5m</option>
            </select>
            <button
              className={`refresh-btn${refreshing ? " refreshing" : ""}`}
              onClick={() => { if (!refreshing) fetchAll(); }}
              disabled={refreshing}
              aria-label="Refresh dashboard"
              type="button"
            >
              {refreshing ? "⟳" : isCompactHeader ? "refresh" : "⟳ refresh"}
            </button>
          </div>
        </div>
      </header>

      <div className="dashboard-shell">
        <section className="overview-panel">
          <div className="section-kicker">overview</div>
          <div className="overview-header-row">
            <div>
              <h1 className="overview-title">Operator Control Center</h1>
              <p className="overview-subtitle">Live health, sessions, costs, reminders, and project state in one view.</p>
            </div>
            <div className={`health-pill health-${overallHealth}`}>
              <span className="health-dot" />
              {healthLabel}
            </div>
          </div>

          <div className="metrics-strip">
            {activity.status === "ok" && (
              <div className="strip-tile strip-tile-featured">
                <span className="strip-label">status</span>
                <span
                  className={`strip-value ${
                    activity.data.state === "active"
                      ? "sv-ok"
                      : activity.data.state === "idle"
                      ? "sv-warn"
                      : ""
                  }`}
                >
                  {activity.data.state === "active"
                    ? "WORKING"
                    : activity.data.state === "idle"
                    ? "IDLE"
                    : "—"}
                </span>
              </div>
            )}
            {services.status === "ok" && (
              <div className="strip-tile">
                <span className="strip-label">services</span>
                <span
                  className={`strip-value ${
                    services.data.services.filter(s => s.active === "active").length === services.data.services.length
                      ? "sv-ok"
                      : "sv-warn"
                  }`}
                >
                  {services.data.services.filter(s => s.active === "active").length}/
                  {services.data.services.length}
                </span>
              </div>
            )}
            {usage.status === "ok" && (
              <>
                <div className="strip-tile">
                  <span className="strip-label">sessions</span>
                  <span className="strip-value">{usage.data.sessionCount}</span>
                </div>
                <div className="strip-tile">
                  <span className="strip-label">transcripts</span>
                  <span className="strip-value">{usage.data.transcriptFileCount}</span>
                </div>
                <div className="strip-tile">
                  <span className="strip-label">disk</span>
                  <span className="strip-value sv-accent">
                    {usage.data.transcriptTotalFormatted}
                  </span>
                </div>
                {usage.data.lastActivityTs && (
                  <div className="strip-tile">
                    <span className="strip-label">last active</span>
                    <span className="strip-value">{timeAgo(usage.data.lastActivityTs)}</span>
                  </div>
                )}
              </>
            )}
          </div>
        </section>

        {/* ── Main Grid ── */}
        <main className="dashboard-grid">
          <ActivityCard state={activity} />
          <AttentionCard items={attentionItems} />
          <ProviderHealthCard state={providerState} />
          <AgentRosterCard items={agentRoster} />
          <CommandLaneCard items={commandLane} />
          <ServicesCard state={services} />
          <UsageCard usageState={usage} />
          <CostSnapshotCard usageState={usage} />
          <ProjectsCard state={projects} />
          <ReminderCard state={reminders} />
          <InfraCard state={infra} />
          <CredentialsCard state={credentials} />
          <SessionsCard state={sessionsData} />
          <TranscriptsCard state={sessionsData} />
          <LogsCard state={logs} />
        </main>
      </div>

      {/* ── Baba Mimoun SVG companion (removed absolute footer for accessibility, kept SVG component) ── */}

      <footer className="page-footer">
        openclaw ops · local data only · no external calls
      </footer>
    </div>
  );
}
