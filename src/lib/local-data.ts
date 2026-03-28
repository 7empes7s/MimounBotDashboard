/**
 * local-data.ts
 * All server-side readers for local operational data.
 * Every function must complete within 2 seconds.
 * No openclaw CLI calls — only fs reads + bounded systemctl --user show.
 */

import fsSync, { promises as fs } from "fs";
import { exec } from "child_process";
import path from "path";
import os from "os";

const HOME = os.homedir();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function runCmd(cmd: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    let settled = false;
    const child = exec(cmd, { encoding: "utf8" }, (err, stdout) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(err ? "" : stdout.trim());
    });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
      resolve("");
    }, timeoutMs);
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB`;
}

function formatDuration(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function loadPricingReferenceSync(): Array<{ model: string; inputPerMillionUsd: number | null; outputPerMillionUsd: number | null; confidence: string; reason: string; source: string }> {
  try {
    const raw = fsSync.readFileSync(path.join(HOME, '.openclaw/costs/pricing.json'), 'utf8');
    const parsed = JSON.parse(raw) as { models?: Array<{ model: string; inputPerMillionUsd: number | null; outputPerMillionUsd: number | null; confidence: string; reason: string; source: string }> };
    return parsed.models || [];
  } catch {
    return [];
  }
}

function estimateCostUsd(model: string, inputTokens = 0, outputTokens = 0, pricingRef?: Array<{ model: string; inputPerMillionUsd: number | null; outputPerMillionUsd: number | null }>): number {
  const m = model.toLowerCase();
  const ref = (pricingRef || []).find(p => p.model.toLowerCase() === m) || null;
  const pricing = ref ? { inPerM: ref.inputPerMillionUsd, outPerM: ref.outputPerMillionUsd } : (() => {
    if (m.includes('gpt-5.4')) return { inPerM: 1.25, outPerM: 10.0 };
    if (m.includes('claude-sonnet-4-6') || m.includes('sonnet')) return { inPerM: 3.0, outPerM: 15.0 };
    if (m.includes('gemini-2.0-flash') || m.includes('gemini')) return { inPerM: 0.1, outPerM: 0.4 };
    return null;
  })();
  if (!pricing || pricing.inPerM == null || pricing.outPerM == null) return 0;
  return (inputTokens / 1_000_000) * pricing.inPerM + (outputTokens / 1_000_000) * pricing.outPerM;
}

export type LogTier = "INFO" | "WARNING" | "INCIDENT";

export interface LogEntry {
  time: string;
  level: string;
  message: string;
  module: string;
  tier: LogTier;
}

function classifyLogTier(entry: { level: string; message: string; module: string }): LogTier {
  const msg = (entry.message || "").toLowerCase();
  const lvl = (entry.level || "").toUpperCase();
  const mod = (entry.module || "").toLowerCase();

  // Tier 1: INFO (Never affects health)
  if (
    msg.includes("heartbeat") ||
    msg.includes("timer armed") ||
    msg.includes("inbound message") ||
    msg.includes("outbound message") ||
    msg.includes("auto-replied") ||
    msg.includes("exec failed") || // tool-exec noise
    msg.includes("edit failed") || // edit noise
    msg.includes("no changes made") ||
    msg.includes("diagnostic queue-wait") ||
    mod.includes("build")
  ) {
    return "INFO";
  }

  // Tier 2: WARNING (In logs, not banner)
  if (
    msg.includes("credit balance is too low") ||
    msg.includes("quota exceeded") ||
    msg.includes("model_not_found") ||
    msg.includes("404") ||
    msg.includes("timeout") ||
    msg.includes("high token usage") ||
    lvl === "WARN"
  ) {
    return "WARNING";
  }

  // Tier 3: INCIDENT (Affects banner)
  if (
    msg.includes("all configured models failed") ||
    msg.includes("gateway down") ||
    msg.includes("tunnel health failed") ||
    lvl === "ERROR" ||
    lvl === "FATAL"
  ) {
    return "INCIDENT";
  }

  return lvl === "DEBUG" ? "INFO" : "INFO";
}

type ProviderRuntimeIssue = { status: "ok" | "warning" | "exhausted" | "unknown"; detail: string | null };

export interface ProviderState {
  last_updated: string;
  providers: Record<string, {
    status: "active" | "degraded" | "rate-limited" | "exhausted" | "dead" | "auth-failed" | "unknown";
    note?: string;
    model?: string;
  }>;
}

type ProviderCostState = {
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
};

function loadRecentGatewayLogTextSync(): string {
  try {
    const dir = path.join('/tmp', 'openclaw');
    const files = fsSync.readdirSync(dir)
      .filter((f) => /^openclaw-.*\.log$/.test(f))
      .sort()
      .slice(-2);
    return files.map((f) => {
      try {
        const raw = fsSync.readFileSync(path.join(dir, f), 'utf8');
        return raw.split("\n").slice(-400).join("\n");
      } catch {
        return '';
      }
    }).join("\n");
  } catch {
    return '';
  }
}

function detectProviderRuntimeIssuesSync(): Record<string, ProviderRuntimeIssue> {
  const log = loadRecentGatewayLogTextSync().toLowerCase();
  const result: Record<string, ProviderRuntimeIssue> = {
    openai: { status: 'unknown', detail: null },
    anthropic: { status: 'unknown', detail: null },
    google: { status: 'unknown', detail: null },
    elevenlabs: { status: 'unknown', detail: null },
  };
  const checks: Array<[string, RegExp, ProviderRuntimeIssue["status"], string]> = [
    ['anthropic', /credit balance is too low|insufficient credits|anthropic.*credit/i, 'exhausted', 'Recent runtime logs show Claude/Anthropic credits exhausted.'],
    ['openai', /insufficient_quota|billing_hard_limit|openai.*quota|openai.*billing/i, 'warning', 'Recent runtime logs show OpenAI quota/billing trouble.'],
    ['google', /resource exhausted|quota exceeded|google.*quota|gemini.*quota/i, 'warning', 'Recent runtime logs show Google/Gemini quota trouble.'],
    ['elevenlabs', /elevenlabs.*credit|elevenlabs.*quota|elevenlabs.*insufficient/i, 'warning', 'Recent runtime logs show ElevenLabs credit/quota trouble.'],
  ];
  for (const [provider, re, status, detail] of checks) {
    if (re.test(log)) result[provider] = { status, detail };
  }
  return result;
}

function reconcileProviderCostStateSync(models: Array<{ provider: string; estimatedCostUsd: number }>): ProviderCostState[] {
  const statePath = path.join(HOME, '.openclaw/costs/provider-state.json');
  let existing: Record<string, unknown> & { providers?: Record<string, unknown> } = { version: 1, providers: {} };
  try { existing = JSON.parse(fsSync.readFileSync(statePath, 'utf8')); } catch {}
  if (!existing || typeof existing !== 'object') existing = { version: 1, providers: {} };
  if (!existing.providers || typeof existing.providers !== 'object') existing.providers = {};

  const runtime = detectProviderRuntimeIssuesSync();
  const existingProviders = existing.providers ?? {};
  const labels: Record<string, string> = {
    openai: 'ChatGPT / OpenAI',
    anthropic: 'Claude / Anthropic',
    google: 'Google / Gemini',
    elevenlabs: 'ElevenLabs',
  };
  const notes: Record<string, string> = {
    openai: 'Uses current token pricing reference. Live provider balance is not wired from here.',
    anthropic: 'Uses current token pricing reference. Live Anthropic billing balance is not exposed here, so runtime faults and remembered state are used.',
    google: 'Uses current token pricing reference. Live Google billing data is not wired from here.',
    elevenlabs: 'Billing is credit/minute based, not token-based. Keep remembered state until a live balance source is added.',
  };
  const estimatedByProvider: Record<string, number> = { openai: 0, anthropic: 0, google: 0, elevenlabs: 0 };
  for (const m of models) {
    if (m.provider in estimatedByProvider) estimatedByProvider[m.provider] += m.estimatedCostUsd || 0;
  }
  const now = new Date().toISOString();
  const providers = ['openai', 'anthropic', 'google', 'elevenlabs'].map((provider) => {
    const prev = (existingProviders[provider] || {}) as Record<string, unknown>;
    const estimatedSpendUsd = Number(estimatedByProvider[provider] || 0);
    const rememberedSpendUsd = typeof prev.rememberedSpendUsd === 'number' ? prev.rememberedSpendUsd : estimatedSpendUsd;
    const deltaSinceRememberedUsd = Math.max(0, estimatedSpendUsd - rememberedSpendUsd);
    const runtimeIssue = runtime[provider]?.detail || null;
    const runtimeStatus = (runtime[provider]?.status || 'unknown') as ProviderCostState['status'];
    const source: ProviderCostState['source'] = runtimeStatus !== 'unknown' ? 'runtime' : (prev.liveDataAvailable ? 'live' : 'remembered');
    const rememberedStatus = (typeof prev.status === 'string' ? prev.status : 'unknown') as ProviderCostState['status'];
    const status: ProviderCostState['status'] = runtimeStatus !== 'unknown' ? runtimeStatus : rememberedStatus;
    return {
      provider,
      label: labels[provider],
      status,
      source,
      liveDataAvailable: Boolean(prev.liveDataAvailable),
      estimatedSpendUsd,
      rememberedSpendUsd,
      deltaSinceRememberedUsd,
      note: runtimeIssue || (typeof prev.note === 'string' ? prev.note : '') || notes[provider],
      runtimeIssue,
      updatedAt: now,
    };
  });
  try {
    fsSync.mkdirSync(path.dirname(statePath), { recursive: true });
    fsSync.writeFileSync(statePath, JSON.stringify({ version: 1, providers: Object.fromEntries(providers.map((p) => [p.provider, p])) }, null, 2) + "\n");
  } catch {}
  return providers;
}

export async function getProviderState(): Promise<ProviderState | null> {
  const p = path.join(HOME, '.openclaw/costs/provider-state.json');
  try {
    const raw = await fs.readFile(p, 'utf8');
    return JSON.parse(raw) as ProviderState;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Service Status — systemctl --user show (DBus, fast, no hanging)
// ---------------------------------------------------------------------------

export interface ServiceStatus {
  name: string;
  active: string;       // "active" | "inactive" | "failed" | "activating" | ...
  sub: string;          // "running" | "dead" | "exited" | ...
  loaded: boolean;
  pid?: number;
  memoryFormatted?: string;
  activeEnterTimestamp?: string;
}

export interface InfraSnapshot {
  host: {
    hostname: string;
    platform: string;
    release: string;
    uptimeSeconds: number;
    uptimeHuman: string;
    loadAvg1: number;
    loadAvg5: number;
    loadAvg15: number;
    memTotalBytes: number;
    memFreeBytes: number;
    memAvailableBytes: number;
    memUsedBytes: number;
    memUsedPercent: number;
    rootTotalBytes: number;
    rootFreeBytes: number;
    rootUsedBytes: number;
    rootUsedPercent: number;
  };
  runtime: {
    sessionCount: number;
    lastSessionActivityTs: number | null;
    lastSessionActivityHuman: string;
  };
  listeners: Array<{
    port: number;
    listening: boolean;
  }>;
  dns: Array<{
    hostname: string;
    resolved: boolean;
    answers: string[];
  }>;
  endpoints: Array<{
    label: string;
    url: string;
    ok: boolean;
    statusCode: number | null;
  }>;
}

const SERVICES = [
  "openclaw-gateway.service",
  "baba-mimoun-ops-dashboard.service",
  "hello-dashboard.service",
];

export async function getServiceStatuses(): Promise<ServiceStatus[]> {
  return Promise.all(
    SERVICES.map(async (name) => {
      const out = await runCmd(
        `systemctl --user show ${name} --property=ActiveState,SubState,LoadState,MainPID,MemoryCurrent,ActiveEnterTimestamp`,
        1800,
      );
      const props: Record<string, string> = {};
      for (const line of out.split("\n")) {
        const eq = line.indexOf("=");
        if (eq > -1) props[line.slice(0, eq)] = line.slice(eq + 1).trim();
      }
      const memRaw = props.MemoryCurrent ?? "";
      const memBytes =
        /^\d+$/.test(memRaw) ? parseInt(memRaw, 10) : undefined;
      return {
        name,
        active: props.ActiveState ?? "unknown",
        sub: props.SubState ?? "unknown",
        loaded: props.LoadState === "loaded",
        pid:
          props.MainPID && props.MainPID !== "0"
            ? parseInt(props.MainPID, 10)
            : undefined,
        memoryFormatted:
          memBytes !== undefined ? formatBytes(memBytes) : undefined,
        activeEnterTimestamp: props.ActiveEnterTimestamp || undefined,
      };
    }),
  );
}

// ---------------------------------------------------------------------------
// Sessions — read sessions.json directly
// ---------------------------------------------------------------------------

export interface SessionEntry {
  key: string;
  sessionId: string;
  updatedAt: number;
  chatType: string;
  channel: string;
  from: string;
  sessionFile: string;
  model: string;
  modelProvider?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  totalTokensFresh?: boolean;
}

export async function getSessions(): Promise<SessionEntry[]> {
  const file = path.join(
    HOME,
    ".openclaw/agents/main/sessions/sessions.json",
  );
  try {
    const raw = await fs.readFile(file, "utf8");
    const obj: unknown = JSON.parse(raw);
    if (typeof obj !== "object" || obj === null) return [];
    
    // Sort and slice before mapping to reduce work
    const entries = Object.entries(obj as Record<string, unknown>)
      .sort(([, a], [, b]) => Number((b as any).updatedAt ?? 0) - Number((a as any).updatedAt ?? 0))
      .slice(0, 50);

    return entries.map(([key, val]) => {
        const v = val as Record<string, unknown>;
        const dc = (v.deliveryContext ?? {}) as Record<string, unknown>;
        const origin = (v.origin ?? {}) as Record<string, unknown>;
        return {
          key,
          sessionId: String(v.sessionId ?? ""),
          updatedAt: Number(v.updatedAt ?? 0),
          chatType: String(v.chatType ?? ""),
          channel: String(dc.channel ?? v.lastChannel ?? ""),
          from: String(origin.from ?? ""),
          sessionFile: String(v.sessionFile ?? ""),
          model: String(v.model ?? ""),
          modelProvider: v.modelProvider ? String(v.modelProvider) : undefined,
          inputTokens: typeof v.inputTokens === "number" ? v.inputTokens : undefined,
          outputTokens: typeof v.outputTokens === "number" ? v.outputTokens : undefined,
          totalTokens: typeof v.totalTokens === "number" ? v.totalTokens : undefined,
          totalTokensFresh: typeof v.totalTokensFresh === "boolean" ? v.totalTokensFresh : undefined,
        };
      });
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Transcript Metadata — stat only, no content read
// ---------------------------------------------------------------------------

export interface TranscriptInfo {
  filePath: string;
  agent: string;
  sessionId: string;
  sizeBytes: number;
  sizeFormatted: string;
  modifiedAt: number;
}

export interface SessionDrilldown {
  session: SessionEntry | null;
  transcript: TranscriptInfo | null;
  recentEvents: ActivityEvent[];
  transcriptExcerpt: string[];
}

export interface ReminderItem {
  id: string;
  title: string;
  type: "hard" | "soft" | "trigger" | "watchlist";
  state: "pending" | "nudged" | "followed_up" | "done" | "cancelled" | "blocked";
  context: string;
  updatedAt?: string;
  lastSentAt?: string | null;
  followUpSentAt?: string | null;
}

export interface ReminderSnapshot {
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
}

export async function getTranscriptMetadata(): Promise<TranscriptInfo[]> {
  const agentsDir = path.join(HOME, ".openclaw/agents");
  const results: TranscriptInfo[] = [];
  try {
    const agents = await fs.readdir(agentsDir);
    await Promise.all(
      agents.map(async (agent) => {
        const sessDir = path.join(agentsDir, agent, "sessions");
        try {
          const files = await fs.readdir(sessDir);
          
          // Filter first to avoid stat on everything
          const targetFiles = files
              .filter((f) => f.endsWith(".jsonl") && !f.endsWith(".lock"));

          // Just stat the most recent 40 files in each agent dir
          // (sorting by name usually aligns with age/ID in acp context)
          const slicedFiles = targetFiles.sort().reverse().slice(0, 40);

          await Promise.all(
            slicedFiles.map(async (f) => {
                const fp = path.join(sessDir, f);
                try {
                  const stat = await fs.stat(fp);
                  results.push({
                    filePath: fp,
                    agent,
                    sessionId: f.replace(/\.acp-stream\.jsonl$|\.jsonl$/, ""),
                    sizeBytes: stat.size,
                    sizeFormatted: formatBytes(stat.size),
                    modifiedAt: stat.mtimeMs,
                  });
                } catch {
                  // skip unreadable files
                }
              }),
          );
        } catch {
          // skip missing sessions dirs
        }
      }),
    );
  } catch {
    // skip missing agents dir
  }
  return results.sort((a, b) => b.modifiedAt - a.modifiedAt).slice(0, 50);
}

// ---------------------------------------------------------------------------
// Credential Presence — directory check only
// ---------------------------------------------------------------------------

export interface CredentialStatus {
  provider: string;
  present: boolean;
  accounts: string[];
}

export async function getCredentials(): Promise<CredentialStatus[]> {
  const credDir = path.join(HOME, ".openclaw/credentials");
  const results: CredentialStatus[] = [];
  try {
    const entries = await fs.readdir(credDir, { withFileTypes: true });
    await Promise.all(
      entries
        .filter((e) => e.isDirectory())
        .map(async (e) => {
          const provPath = path.join(credDir, e.name);
          try {
            const accounts = await fs.readdir(provPath);
            results.push({
              provider: e.name,
              present: accounts.length > 0,
              accounts,
            });
          } catch {
            results.push({ provider: e.name, present: false, accounts: [] });
          }
        }),
    );
  } catch {
    // credentials dir missing
  }
  return results;
}

// ---------------------------------------------------------------------------
// Gateway Logs — bounded tail of most recent log file
// ---------------------------------------------------------------------------

async function tailFile(filePath: string, maxBytes: number): Promise<string> {
  try {
    const stat = await fs.stat(filePath);
    const readSize = Math.min(stat.size, maxBytes);
    const offset = stat.size - readSize;
    const fh = await fs.open(filePath, "r");
    const buf = Buffer.alloc(readSize);
    await fh.read(buf, 0, readSize, offset);
    await fh.close();
    return buf.toString("utf8");
  } catch {
    return "";
  }
}

export async function getRecentLogs(
  maxLines = 60,
): Promise<{ entries: LogEntry[]; logFile: string | null }> {
  const logDir = "/tmp/openclaw";
  let logFile: string | null = null;
  try {
    const files = await fs.readdir(logDir);
    const sorted = files
      .filter((f) => f.startsWith("openclaw-") && f.endsWith(".log"))
      .sort()
      .reverse();
    if (sorted.length > 0) {
      logFile = path.join(logDir, sorted[0]);
    }
  } catch {
    return { entries: [], logFile: null };
  }
  if (!logFile) return { entries: [], logFile: null };

  // Read up to 128KB from the end
  const tail = await tailFile(logFile, 131072);
  if (!tail) return { entries: [], logFile };

  // Skip the potentially-partial first line
  const firstNl = tail.indexOf("\n");
  const cleanTail = firstNl >= 0 ? tail.slice(firstNl + 1) : tail;
  const lines = cleanTail.split("\n").filter((l) => l.trim());

  const entries: LogEntry[] = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      const meta = (obj._meta ?? {}) as Record<string, unknown>;
      const level = String(meta.logLevelName ?? "INFO");
      const time = String(meta.date ?? obj.time ?? "");
      // Positional args form the message
      const msgParts = Object.entries(obj)
        .filter(([k]) => /^\d+$/.test(k))
        .sort(([a], [b]) => parseInt(a) - parseInt(b))
        .map(([, v]) =>
          typeof v === "object" ? JSON.stringify(v) : String(v),
        );
      const message = msgParts.join(" ").slice(0, 300);
      // First positional arg often contains the module name in braces
      const raw0 = String(obj["0"] ?? "");
      const moduleMatch = raw0.match(/"module":"([^"]+)"/);
      const subsysMatch = raw0.match(/"subsystem":"([^"]+)"/);
      const moduleName =
        moduleMatch?.[1] ?? subsysMatch?.[1] ?? raw0.slice(0, 40);
      
      const tier = classifyLogTier({ level, message, module: moduleName });
      entries.push({ time, level, message, module: moduleName, tier });
    } catch {
      // skip unparseable lines
    }
  }

  // Return most-recent-first, capped at maxLines
  return { entries: entries.slice(-maxLines).reverse(), logFile };
}

// ---------------------------------------------------------------------------
// Activity Status — derived from most recent transcript JSONL content
// ---------------------------------------------------------------------------

export interface ActivityEvent {
  ts: string;        // ISO timestamp
  tsMs: number;      // epoch ms
  role: string;      // "assistant" | "tool_result" | "user"
  summary: string;   // short human-readable summary ≤ 90 chars
  toolName?: string;
  model?: string;
}

export interface ActivityStatus {
  state: "active" | "idle" | "unknown";
  lastEventTs: string | null;
  lastEventMs: number | null;
  sessionId: string | null;
  agent: string | null;
  model: string | null;
  recentEvents: ActivityEvent[];
  recentCommandEvents: ActivityEvent[];
  source: "transcript" | "none";
}

const ACTIVE_THRESHOLD_MS = 8 * 60 * 1000; // 8 minutes

function cleanUserText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";

  const withoutMetaBlocks = trimmed
    .replace(/Conversation info \(untrusted metadata\):[\s\S]*?```[\s\S]*?```/gi, "")
    .replace(/Sender \(untrusted metadata\):[\s\S]*?```[\s\S]*?```/gi, "")
    .replace(/System:[^\n]*/gi, "")
    .replace(/<media:[^>]+>/gi, "")
    .replace(/\[media attached:[^\]]+\]/gi, "")
    .replace(/To send an image back,[^\n]*/gi, "")
    .trim();

  if (!withoutMetaBlocks) {
    if (/<media:/i.test(trimmed) || /\[media attached:/i.test(trimmed)) return "Shared dashboard image";
    return "";
  }

  const lines = withoutMetaBlocks
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^```/.test(line))
    .filter((line) => !/^\{/.test(line) && !/^\}/.test(line))
    .filter((line) => !/^"[^"]+":/.test(line));

  const joined = lines.join(" ").replace(/\s+/g, " ").trim();
  return joined || "Shared dashboard image";
}

function summariseContent(content: unknown): string {
  if (typeof content === "string") return cleanUserText(content).slice(0, 120);
  if (Array.isArray(content)) {
    let sawMedia = false;
    for (const part of content) {
      if (typeof part === "object" && part !== null) {
        const p = part as Record<string, unknown>;
        if (p.type === "text" && typeof p.text === "string") {
          const cleaned = cleanUserText(p.text);
          if (cleaned) return cleaned.slice(0, 120);
        }
        if (typeof p.type === "string" && /image|media/i.test(p.type)) {
          sawMedia = true;
        }
        if (p.type === "toolCall" && typeof p.name === "string") {
          const args = p.arguments as Record<string, unknown> | undefined;
          const argStr = args
            ? Object.values(args)
                .map((v) =>
                  typeof v === "string" ? v.slice(0, 30) : JSON.stringify(v).slice(0, 30),
                )
                .join(" ")
                .slice(0, 50)
            : "";
          return `→ ${p.name}${argStr ? `(${argStr})` : ""}`;
        }
      }
    }
    if (sawMedia) return "Shared dashboard image";
  }
  return "";
}

export async function getActivityStatus(): Promise<ActivityStatus> {
  const blank: ActivityStatus = {
    state: "unknown",
    lastEventTs: null,
    lastEventMs: null,
    sessionId: null,
    agent: null,
    model: null,
    recentEvents: [],
    recentCommandEvents: [],
    source: "none",
  };

  // Find most recently modified transcript JSONL
  let bestFile: string | null = null;
  let bestMtime = 0;
  let bestAgent: string | null = null;
  let bestSessionId: string | null = null;

  const agentsDir = path.join(HOME, ".openclaw/agents");
  try {
    const agents = await fs.readdir(agentsDir);
    await Promise.all(
      agents.map(async (agent) => {
        const sessDir = path.join(agentsDir, agent, "sessions");
        try {
          const files = await fs.readdir(sessDir);
          await Promise.all(
            files
              .filter((f) => f.endsWith(".jsonl") && !f.endsWith(".lock"))
              .map(async (f) => {
                const fp = path.join(sessDir, f);
                try {
                  const stat = await fs.stat(fp);
                  if (stat.mtimeMs > bestMtime) {
                    bestMtime = stat.mtimeMs;
                    bestFile = fp;
                    bestAgent = agent;
                    bestSessionId = f.replace(/\.acp-stream\.jsonl$|\.jsonl$/, "");
                  }
                } catch { /* skip */ }
              }),
          );
        } catch { /* skip */ }
      }),
    );
  } catch {
    return blank;
  }

  if (!bestFile) return blank;

  // Read a deeper tail so command history survives tool-heavy runs
  const raw = await tailFile(bestFile, 131072);
  if (!raw) return blank;

  const firstNl = raw.indexOf("\n");
  const clean = firstNl >= 0 ? raw.slice(firstNl + 1) : raw;
  const lines = clean.split("\n").filter((l) => l.trim());

  const events: ActivityEvent[] = [];
  let model: string | null = null;

  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      if (obj.type !== "message") continue;

      const ts = typeof obj.timestamp === "string" ? obj.timestamp : "";
      const tsMs = ts ? new Date(ts).getTime() : 0;
      if (!tsMs || isNaN(tsMs)) continue;

      const msg = (obj.message ?? {}) as Record<string, unknown>;
      const role = String(msg.role ?? "");

      // Capture model from assistant messages
      if (role === "assistant" && typeof msg.model === "string" && msg.model) {
        model = msg.model;
      }

      let summary = "";
      let toolName: string | undefined;

      if (role === "assistant") {
        summary = summariseContent(msg.content);
        if (summary === "NO_REPLY") continue; // filter noise
      } else if (role === "toolResult") {
        toolName = typeof msg.toolName === "string" ? msg.toolName : undefined;
        const text = summariseContent(msg.content);
        summary = toolName ? `✓ ${toolName}: ${text.slice(0, 70)}` : text;
      } else if (role === "user") {
        const text = summariseContent(msg.content);
        if (!text || text.includes("Read HEARTBEAT.md")) continue; // skip noise/heartbeat turns
        summary = `user: ${text.slice(0, 80)}`;
      } else {
        continue;
      }

      if (!summary) continue;
      events.push({ ts, tsMs, role, summary, toolName, model: role === "assistant" ? String(msg.model || "") : undefined });
    } catch { /* skip */ }
  }

  if (events.length === 0) return blank;

  // Most recent first, cap at 14 for a longer visible activity trail
  const sorted = [...events].sort((a, b) => b.tsMs - a.tsMs);
  const recentEvents = sorted.slice(0, 14);
  const recentCommandEvents = sorted
    .filter((event) => event.role === "user")
    .slice(0, 8);
  const lastEventMs = sorted[0].tsMs;
  const lastEventTs = sorted[0].ts;

  const state: "active" | "idle" =
    Date.now() - lastEventMs < ACTIVE_THRESHOLD_MS ? "active" : "idle";

  return {
    state,
    lastEventTs,
    lastEventMs,
    sessionId: bestSessionId,
    agent: bestAgent,
    model,
    recentEvents,
    recentCommandEvents,
    source: "transcript",
  };
}

// ---------------------------------------------------------------------------
// Combined usage metrics derived from local files
// ---------------------------------------------------------------------------

export interface UsageMetrics {
  sessionCount: number;
  transcriptFileCount: number;
  transcriptTotalBytes: number;
  transcriptTotalFormatted: string;
  lastActivityTs: number | null;
  lastActivityFormatted: string | null;
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
  pricingReference: Array<{ model: string; inputPerMillionUsd: number | null; outputPerMillionUsd: number | null; confidence: string; reason: string; source: string }>
  providerStates: ProviderCostState[];
  models: Array<{
    model: string;
    provider: string;
    sessions: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
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
}

export async function getInfraSnapshot(): Promise<InfraSnapshot> {
  const [sessions] = await Promise.all([getSessions()]);
  const hostname = os.hostname();
  const platform = `${os.platform()} ${os.arch()}`;
  const release = os.release();
  const uptimeSeconds = os.uptime();
  const [l1, l5, l15] = os.loadavg();

  let memTotalBytes = 0;
  let memFreeBytes = 0;
  let memAvailableBytes = 0;
  try {
    const meminfo = await fs.readFile('/proc/meminfo', 'utf8');
    const map: Record<string, number> = {};
    for (const line of meminfo.split('\n')) {
      const m = line.match(/^([^:]+):\s+(\d+)\s+kB$/);
      if (m) map[m[1]] = parseInt(m[2], 10) * 1024;
    }
    memTotalBytes = map.MemTotal ?? os.totalmem();
    memFreeBytes = map.MemFree ?? os.freemem();
    memAvailableBytes = map.MemAvailable ?? os.freemem();
  } catch {
    memTotalBytes = os.totalmem();
    memFreeBytes = os.freemem();
    memAvailableBytes = os.freemem();
  }
  const memUsedBytes = Math.max(0, memTotalBytes - memAvailableBytes);
  const memUsedPercent = memTotalBytes ? Math.round((memUsedBytes / memTotalBytes) * 100) : 0;

  const [dfOut, listeners, dns, endpoints] = await Promise.all([
    runCmd("df -B1 / | tail -1", 1200),
    Promise.all([3000, 8000, 18789].map(async (port) => {
      const out = await runCmd(`ss -ltn '( sport = :${port} )' | tail -n +2`, 1200);
      return { port, listening: Boolean(out.trim()) };
    })),
    Promise.all(['dashboard.techinsiderbytes.com', 'hello.techinsiderbytes.com'].map(async (host) => {
      const out = await runCmd(`getent hosts ${host}`, 1200);
      const answers = out.split('\n').map((l: string) => l.trim().split(/\s+/)[0]).filter(Boolean);
      return { hostname: host, resolved: answers.length > 0, answers };
    })),
    Promise.all([
      { label: 'dashboard', url: 'http://127.0.0.1:3000/' },
      { label: 'hello', url: 'http://127.0.0.1:8000/' },
    ].map(async (e) => {
      const out = await runCmd(`curl -s -o /dev/null -w '%{http_code}' --max-time 3 ${e.url}`, 3500);
      const code = /^\d+$/.test(out) ? Number(out) : null;
      return { label: e.label, url: e.url, ok: code !== null && code >= 200 && code < 400, statusCode: code };
    })),
  ]);
  let rootTotalBytes = 0;
  let rootFreeBytes = 0;
  try {
    const parts = dfOut.trim().split(/\s+/);
    if (parts.length >= 6) {
      rootTotalBytes = Number(parts[1]) || 0;
      rootFreeBytes = Number(parts[3]) || 0;
    }
  } catch {}
  const rootUsedBytes = Math.max(0, rootTotalBytes - rootFreeBytes);
  const rootUsedPercent = rootTotalBytes ? Math.round((rootUsedBytes / rootTotalBytes) * 100) : 0;

  const lastSessionActivityTs = sessions[0]?.updatedAt ?? null;
  return {
    host: {
      hostname,
      platform,
      release,
      uptimeSeconds,
      uptimeHuman: formatDuration(uptimeSeconds),
      loadAvg1: Number(l1.toFixed(2)),
      loadAvg5: Number(l5.toFixed(2)),
      loadAvg15: Number(l15.toFixed(2)),
      memTotalBytes,
      memFreeBytes,
      memAvailableBytes,
      memUsedBytes,
      memUsedPercent,
      rootTotalBytes,
      rootFreeBytes,
      rootUsedBytes,
      rootUsedPercent,
    },
    runtime: {
      sessionCount: sessions.length,
      lastSessionActivityTs,
      lastSessionActivityHuman: lastSessionActivityTs ? new Date(lastSessionActivityTs).toISOString() : '—',
    },
    listeners,
    dns,
    endpoints,
  };
}

export async function getReminderSnapshot(): Promise<ReminderSnapshot> {
  const file = path.join(HOME, '.openclaw/workspace/reminders/registry.json');
  try {
    const raw = await fs.readFile(file, 'utf8');
    const reg = JSON.parse(raw) as { items?: ReminderItem[] };
    const items = Array.isArray(reg.items) ? reg.items : [];
    const now = Date.now();
    const followUpDue = items.filter(i => i.state === 'nudged' && i.lastSentAt && (now - Date.parse(i.lastSentAt)) > 24 * 3600 * 1000);
    const pending = items.filter(i => ['pending'].includes(i.state) && i.type !== 'watchlist');
    const attention = items.filter(i => ['nudged','followed_up','blocked'].includes(i.state));
    const watchlist = items.filter(i => i.type === 'watchlist' && !['done','cancelled'].includes(i.state));
    const resolved = items.filter(i => ['done','cancelled'].includes(i.state));
    return {
      pendingCount: pending.length,
      followUpDueCount: followUpDue.length,
      watchlistCount: watchlist.length,
      statusLine: `${pending.length} pending, ${followUpDue.length} needs follow-up, ${watchlist.length} watching`,
      groups: { pending, attention, watchlist, resolved },
    };
  } catch {
    return {
      pendingCount: 0,
      followUpDueCount: 0,
      watchlistCount: 0,
      statusLine: '0 pending, 0 needs follow-up, 0 watching',
      groups: { pending: [], attention: [], watchlist: [], resolved: [] },
    };
  }
}

export async function getSessionDrilldown(sessionId: string): Promise<SessionDrilldown> {
  const [sessions, transcripts] = await Promise.all([getSessions(), getTranscriptMetadata()]);
  const session = sessions.find((s) => s.sessionId === sessionId) ?? null;
  const transcript = transcripts.find((t) => t.sessionId === sessionId) ?? null;

  let recentEvents: ActivityEvent[] = [];
  let transcriptExcerpt: string[] = [];

  if (transcript?.filePath) {
    const raw = await tailFile(transcript.filePath, 65536);
    const firstNl = raw.indexOf("\n");
    const clean = firstNl >= 0 ? raw.slice(firstNl + 1) : raw;
    const lines = clean.split("\n").filter((l) => l.trim());
    const parsed: Array<Record<string, unknown>> = [];
    for (const line of lines) {
      try {
        parsed.push(JSON.parse(line));
      } catch {}
    }
    const tail = parsed.slice(-20);
    recentEvents = tail.flatMap((obj) => {
      const ts = typeof (obj as any).timestamp === 'string' ? (obj as any).timestamp : null;
      const tsMs = ts ? Date.parse(ts) : Date.now();
      const msg = (obj as any).message;
      const role = typeof (obj as any).role === 'string' ? (obj as any).role : (msg?.role || 'unknown');
      const content = msg?.content ?? (obj as any).content ?? '';
      const summary = summariseContent(content) || (typeof content === 'string' ? content.slice(0, 90) : 'Activity event');
      return ts ? [{ ts, tsMs, role, summary, toolName: msg?.name }] : [];
    }).slice(-12).reverse();

    transcriptExcerpt = tail
      .map((obj) => {
        const content = (obj as any).message?.content ?? (obj as any).content;
        if (typeof content === 'string') return content.trim();
        if (Array.isArray(content)) {
          const txt = content.map((part: unknown) => {
            if (typeof part !== 'object' || part === null) return '';
            const text = (part as { text?: unknown }).text;
            return typeof text === 'string' ? text : '';
          }).join(' ').trim();
          return txt;
        }
        return '';
      })
      .filter(Boolean)
      .slice(-6);
  }

  return { session, transcript, recentEvents, transcriptExcerpt };
}

export async function getUsageMetrics(): Promise<UsageMetrics> {
  const [sessions, transcripts] = await Promise.all([
    getSessions(),
    getTranscriptMetadata(),
  ]);
  const pricingReference = loadPricingReferenceSync();
  const totalBytes = transcripts.reduce((s, t) => s + t.sizeBytes, 0);
  const lastActivity =
    transcripts.length > 0 ? transcripts[0].modifiedAt : null;

  const observedModelMap = new Map<string, {
    model: string;
    provider: string;
    source: "configured" | "history" | "session" | "image" | "tts";
    tokenTracked: boolean;
    lastSeenTs?: number;
    sessions?: number;
  }>();
  const capabilityMap = new Map<string, {
    kind: string;
    provider: string;
    model: string;
    status: "configured" | "used" | "configured+used";
  }>();

  const markObserved = (entry: {
    model: string;
    provider: string;
    source: "configured" | "history" | "session" | "image" | "tts";
    tokenTracked?: boolean;
    lastSeenTs?: number;
    sessions?: number;
  }) => {
    if (!entry.model) return;
    const key = `${entry.provider}::${entry.model}`;
    const prev = observedModelMap.get(key);
    observedModelMap.set(key, {
      model: entry.model,
      provider: entry.provider || "unknown",
      source: prev?.source === "configured" || entry.source === "configured" ? (prev?.source === "history" || prev?.source === "session" || prev?.source === "image" || prev?.source === "tts" ? "session" : entry.source) : entry.source,
      tokenTracked: Boolean(prev?.tokenTracked || entry.tokenTracked),
      lastSeenTs: Math.max(prev?.lastSeenTs ?? 0, entry.lastSeenTs ?? 0) || undefined,
      sessions: (prev?.sessions ?? 0) + (entry.sessions ?? 0) || undefined,
    });
  };

  const markCapability = (kind: string, provider: string, model: string, status: "configured" | "used") => {
    if (!model) return;
    const key = `${kind}::${provider}::${model}`;
    const prev = capabilityMap.get(key);
    capabilityMap.set(key, {
      kind,
      provider,
      model,
      status: prev ? (prev.status === status ? prev.status : "configured+used") : status,
    });
  };

  try {
    const configRaw = await fs.readFile(path.join(HOME, ".openclaw/openclaw.json"), "utf8");
    const cfg = JSON.parse(configRaw) as Record<string, unknown>;
    const agentsDefaults = (cfg?.agents as any)?.defaults;
    const primary = agentsDefaults?.model?.primary;
    const fallbacks = agentsDefaults?.model?.fallbacks || [];
    const imagePrimary = agentsDefaults?.imageModel?.primary;
    const ttsProvider = (cfg?.messages as any)?.tts?.provider;
    const ttsModel = (cfg?.messages as any)?.tts?.elevenlabs?.modelId;

    const parseProvider = (m: string) => m.includes("/") ? m.split("/")[0] : "unknown";
    for (const m of [primary, ...fallbacks].filter(Boolean)) {
      markObserved({ model: String(m), provider: parseProvider(String(m)), source: "configured" });
      markCapability("chat", parseProvider(String(m)), String(m), "configured");
    }
    if (imagePrimary) {
      markObserved({ model: String(imagePrimary), provider: parseProvider(String(imagePrimary)), source: "image" });
      markCapability("image", parseProvider(String(imagePrimary)), String(imagePrimary), "configured");
    }
    if (ttsProvider) {
      markCapability("tts", String(ttsProvider), String(ttsModel || ttsProvider), "configured");
    }
  } catch {
    // ignore config read issues
  }

  const sessionsWithUsage = sessions.filter(
    (s) => typeof s.totalTokens === "number" || typeof s.inputTokens === "number" || typeof s.outputTokens === "number",
  );
  const totalInputTokens = sessionsWithUsage.reduce((sum, s) => sum + (s.inputTokens ?? 0), 0);
  const totalOutputTokens = sessionsWithUsage.reduce((sum, s) => sum + (s.outputTokens ?? 0), 0);
  const totalTokens = sessionsWithUsage.reduce((sum, s) => sum + (s.totalTokens ?? ((s.inputTokens ?? 0) + (s.outputTokens ?? 0))), 0);
  const staleUsageSessions = sessionsWithUsage.filter((s) => s.totalTokensFresh === false).length;

  const modelMap = new Map<string, {
    model: string;
    provider: string;
    sessions: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
  }>();

  for (const s of sessions) {
    if (s.model) {
      markObserved({
        model: s.model,
        provider: s.modelProvider || (s.model.includes("/") ? s.model.split("/")[0] : "unknown"),
        source: "session",
        tokenTracked: typeof s.totalTokens === "number" || typeof s.inputTokens === "number" || typeof s.outputTokens === "number",
        lastSeenTs: s.updatedAt,
        sessions: 1,
      });
      markCapability("chat", s.modelProvider || (s.model.includes("/") ? s.model.split("/")[0] : "unknown"), s.model, "used");
    }
  }

  for (const s of sessionsWithUsage) {
    const model = s.model || "unknown";
    const provider = s.modelProvider || "unknown";
    const key = `${provider}::${model}`;
    const existing = modelMap.get(key) ?? {
      model,
      provider,
      sessions: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
    };
    existing.sessions += 1;
    existing.inputTokens += s.inputTokens ?? 0;
    existing.outputTokens += s.outputTokens ?? 0;
    existing.totalTokens += s.totalTokens ?? ((s.inputTokens ?? 0) + (s.outputTokens ?? 0));
    existing.estimatedCostUsd += estimateCostUsd(model, s.inputTokens ?? 0, s.outputTokens ?? 0, pricingReference);
    modelMap.set(key, existing);
  }

  const models = [...modelMap.values()].sort((a, b) => b.totalTokens - a.totalTokens);

  try {
    const transcriptCandidates = transcripts.slice(0, 12);
    for (const t of transcriptCandidates) {
      const raw = await tailFile(t.filePath, 65536);
      const firstNl = raw.indexOf("\n");
      const clean = firstNl >= 0 ? raw.slice(firstNl + 1) : raw;
      const lines = clean.split("\n").filter((l) => l.trim());
      for (const line of lines) {
        try {
          const obj = JSON.parse(line) as Record<string, unknown>;
          const msg = (obj as any).message;
          const model = msg?.model || (obj as any).model;
          if (typeof model === "string" && model) {
            const provider = typeof (obj as any).modelProvider === "string"
              ? (obj as any).modelProvider
              : model.includes("/") ? model.split("/")[0] : "unknown";
            markObserved({ model, provider, source: "history", lastSeenTs: t.modifiedAt });
            markCapability("chat", provider, model, "used");
          }
        } catch {
          // skip bad lines
        }
      }
    }
  } catch {
    // ignore transcript parse issues
  }

  const cleanProvider = (provider: string, model: string) => {
    if (provider && provider !== "unknown") return provider;
    if (model.startsWith("openai-") || model.includes("gpt")) return "openai";
    if (model.includes("claude")) return "anthropic";
    if (model.includes("gemini")) return "google";
    return "other";
  };

  const observedModels = [...observedModelMap.values()]
    .filter((m) => m.model && m.model !== "delivery-mirror")
    .map((m) => ({ ...m, provider: cleanProvider(m.provider, m.model) }))
    .sort((a, b) => (b.lastSeenTs ?? 0) - (a.lastSeenTs ?? 0) || a.model.localeCompare(b.model));
  const capabilities = [...capabilityMap.values()]
    .filter((c) => c.model && c.model !== "delivery-mirror")
    .map((c) => ({ ...c, provider: cleanProvider(c.provider, c.model) }))
    .sort((a, b) => a.kind.localeCompare(b.kind) || a.provider.localeCompare(b.provider) || a.model.localeCompare(b.model));

  const topSessions = sessionsWithUsage
    .map((s) => ({
      sessionId: s.sessionId,
      model: s.model || "unknown",
      provider: s.modelProvider || "unknown",
      totalTokens: s.totalTokens ?? ((s.inputTokens ?? 0) + (s.outputTokens ?? 0)),
      inputTokens: s.inputTokens ?? 0,
      outputTokens: s.outputTokens ?? 0,
      updatedAt: s.updatedAt,
      estimatedCostUsd: estimateCostUsd(s.model || 'unknown', s.inputTokens ?? 0, s.outputTokens ?? 0, pricingReference),
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens)
    .slice(0, 5);

  const estimatedCostUsd = models.reduce((sum, model) => sum + model.estimatedCostUsd, 0);
  const trackedSpendUsd = estimatedCostUsd;
  const untrackedSpendUsd = Math.max(0, sessions.filter(s => !s.totalTokens && !s.inputTokens && !s.outputTokens).length * 0);
  const providerStates = reconcileProviderCostStateSync(models);

  const categoryBreakdown = [
    { category: 'conversation', tracked: true, estimatedCostUsd: estimatedCostUsd, sessions: sessionsWithUsage.length },
    { category: 'build', tracked: true, estimatedCostUsd: 0, sessions: 0 },
    { category: 'heartbeat', tracked: true, estimatedCostUsd: 0, sessions: 0 },
    { category: 'cron', tracked: true, estimatedCostUsd: 0, sessions: 0 },
    { category: 'reminder', tracked: true, estimatedCostUsd: 0, sessions: 0 },
    { category: 'unknown', tracked: false, estimatedCostUsd: untrackedSpendUsd, sessions: sessions.length - sessionsWithUsage.length },
  ];

  return {
    sessionCount: sessions.length,
    transcriptFileCount: transcripts.length,
    transcriptTotalBytes: totalBytes,
    transcriptTotalFormatted: formatBytes(totalBytes),
    lastActivityTs: lastActivity,
    lastActivityFormatted: lastActivity ? new Date(lastActivity).toISOString() : null,
    tokenCost: estimatedCostUsd > 0 ? "estimated" : "unavailable",
    estimatedCostUsd,
    trackedSpendUsd,
    untrackedSpendUsd,
    totalInputTokens,
    totalOutputTokens,
    totalTokens,
    sessionsWithUsage: sessionsWithUsage.length,
    staleUsageSessions,
    categoryBreakdown,
    pricingReference,
    providerStates,
    models,
    observedModels,
    capabilities,
    topSessions,
  };
}
