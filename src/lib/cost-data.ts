import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export type JsonRecord = Record<string, unknown>;
export type CostData = {
  today: string;
  paths: { config: string; providerState: string; pricing: string; ledger: string };
  config: JsonRecord | null;
  providerState: JsonRecord | null;
  pricing: JsonRecord | null;
  ledger: JsonRecord | null;
  note: string;
  totals: {
    totalUsd: number;
    trackedUsd: number;
    untrackedUsd: number;
    sessionCount: number;
    topModel: string | null;
  };
};

const HOME = os.homedir();
const COSTS_DIR = path.join(HOME, '.openclaw', 'costs');

async function readJson(filePath: string): Promise<JsonRecord | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    if (!raw.trim()) return null;
    return JSON.parse(raw) as JsonRecord;
  } catch {
    return null;
  }
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

export async function loadCostData(): Promise<CostData> {
  const today = new Date().toISOString().slice(0, 10);
  const paths = {
    config: path.join(COSTS_DIR, 'config.json'),
    providerState: path.join(COSTS_DIR, 'provider-state.json'),
    pricing: path.join(COSTS_DIR, 'pricing.json'),
    ledger: path.join(COSTS_DIR, 'ledger', `${today}.json`),
  };
  const [config, providerState, pricing, ledger] = await Promise.all([
    readJson(paths.config),
    readJson(paths.providerState),
    readJson(paths.pricing),
    readJson(paths.ledger),
  ]);
  const sessions = Array.isArray(ledger?.sessions) ? ledger.sessions : [];
  const totals = {
    totalUsd: asNumber(ledger?.totalUsd),
    trackedUsd: asNumber(ledger?.trackedUsd),
    untrackedUsd: asNumber(ledger?.untrackedUsd),
    sessionCount: asNumber(ledger?.sessionCount, sessions.length),
    topModel: asString(ledger?.topModel) ?? asString((ledger?.topSession as JsonRecord | undefined)?.model),
  };
  const present = [config, providerState, pricing, ledger].filter(Boolean).length;
  const note = present === 4
    ? 'Loaded only from real local files under ~/.openclaw/costs and the daily ledger file.'
    : 'One or more cost files are missing or empty. Showing safe empty state from real local files only.';
  return { today, paths, config, providerState, pricing, ledger, note, totals };
}
