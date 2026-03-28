import Link from 'next/link';
import { loadCostData } from '@/lib/cost-data';

function formatUsd(value: number): string {
  return `$${value.toFixed(6)}`;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('en-GB').format(value);
}

function formatTime(value: unknown): string {
  if (typeof value !== 'string') return '—';
  return value.slice(11, 16) || value;
}

export const dynamic = 'force-dynamic';

export default async function CostPage() {
  const data = await loadCostData();
  const ledger = (data.ledger ?? {}) as Record<string, any>;
  const warnings: string[] = Array.isArray(ledger.warnings) ? ledger.warnings : [];
  const providerSummary = Object.entries((ledger.byProvider ?? {}) as Record<string, number>);
  const modelSummary = Object.entries((ledger.byModel ?? {}) as Record<string, number>);
  const providerState = Object.entries((((data.providerState ?? {}) as any).providers ?? {}) as Record<string, any>);
  const sessions = Array.isArray(ledger.sessions) ? ledger.sessions.slice(0, 10) : [];

  return (
    <div className="page-root">
      <div className="dashboard-shell">
        <section className="overview-panel">
          <div className="section-kicker">finance</div>
          <div className="overview-header-row">
            <div>
              <h1 className="overview-title">Cost Center</h1>
              <p className="overview-subtitle">{data.note}</p>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span className="health-pill health-ok"><span className="health-dot" />{data.ledger ? 'LEDGER LIVE' : 'EMPTY LEDGER'}</span>
              <Link href="/" className="card-link-btn">Dashboard</Link>
            </div>
          </div>

          <div className="metrics-strip">
            <div className="strip-tile strip-tile-featured"><span className="strip-label">TOTAL USD</span><span className="strip-value sv-accent">{formatUsd(data.totals.totalUsd)}</span></div>
            <div className="strip-tile"><span className="strip-label">TRACKED USD</span><span className="strip-value">{formatUsd(data.totals.trackedUsd)}</span></div>
            <div className="strip-tile"><span className="strip-label">UNTRACKED USD</span><span className="strip-value">{formatUsd(data.totals.untrackedUsd)}</span></div>
            <div className="strip-tile"><span className="strip-label">SESSIONS</span><span className="strip-value">{formatCount(data.totals.sessionCount)}</span></div>
            <div className="strip-tile"><span className="strip-label">TOP MODEL</span><span className="strip-value">{data.totals.topModel ?? '—'}</span></div>
            <div className="strip-tile"><span className="strip-label">GENERATED</span><span className="strip-value">{formatTime(ledger.generatedAt)}</span></div>
          </div>
        </section>

        <main className="dashboard-grid">
          <div className="card card-accent-accent" style={{ gridColumn: '1 / -1' }}>
            <div className="card-header"><span className="card-title">SUMMARY</span></div>
            <div className="card-body">
              <div className="section-row"><span className="row-label">UTC day</span><span className="row-value">{data.today}</span></div>
              <div className="section-row"><span className="row-label">Ledger note</span><span className="row-value">{data.note}</span></div>
              <div className="section-row"><span className="row-label">Generated at</span><span className="row-value">{ledger.generatedAt ?? '—'}</span></div>
              <div className="section-row"><span className="row-label">Config file</span><span className="row-value">{data.paths.config}</span></div>
              <div className="section-row"><span className="row-label">Ledger file</span><span className="row-value">{data.paths.ledger}</span></div>
            </div>
          </div>

          <div className={`card${warnings.length ? ' card-accent-warn' : ''}`} style={{ gridColumn: 'span 2' }}>
            <div className="card-header"><span className="card-title">WARNINGS</span></div>
            <div className="card-body">
              <div className="usage-capability-list">
                {warnings.length === 0 ? <p className="empty-msg">No ledger warnings.</p> : warnings.map((warning) => (
                  <div key={warning} className="usage-capability-row">
                    <div className="usage-capability-main"><span className="session-id">warning</span><span className="session-channel">{warning}</span></div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><span className="card-title">BY PROVIDER</span></div>
            <div className="card-body"><div className="usage-capability-list">{providerSummary.map(([provider, total]) => (
              <div key={provider} className="usage-capability-row"><div className="usage-capability-main"><span className="session-id">{provider}</span></div><div className="usage-session-side"><span className="usage-token-chip">{formatUsd(Number(total) || 0)}</span></div></div>
            ))}</div></div>
          </div>

          <div className="card card-accent-accent" style={{ gridColumn: 'span 2' }}>
            <div className="card-header"><span className="card-title">BY MODEL</span></div>
            <div className="card-body"><div className="usage-capability-list">{modelSummary.map(([model, total]) => (
              <div key={model} className="usage-capability-row"><div className="usage-capability-main"><span className="session-id">{model}</span></div><div className="usage-session-side"><span className="usage-token-chip">{formatUsd(Number(total) || 0)}</span></div></div>
            ))}</div></div>
          </div>

          <div className="card">
            <div className="card-header"><span className="card-title">PROVIDER STATE</span></div>
            <div className="card-body"><div className="usage-capability-list">{providerState.map(([provider, info]) => (
              <div key={provider} className="usage-capability-row">
                <div className="usage-capability-main"><span className="session-id">{info.label ?? provider}</span><span className="session-channel">{info.source ?? 'unknown'} · live {info.liveDataAvailable ? 'yes' : 'no'}</span></div>
                <div className="usage-session-side"><span className={`usage-source-chip ${info.status === 'unknown' ? 'untracked' : 'tracked'}`}>{info.status ?? 'unknown'}</span><span className="usage-token-chip">est {formatUsd(Number(info.estimatedSpendUsd) || 0)}</span></div>
              </div>
            ))}</div></div>
          </div>

          <div className="card" style={{ gridColumn: '1 / -1' }}>
            <div className="card-header"><span className="card-title">TOP SESSIONS BY ESTIMATED COST</span></div>
            <div className="card-body"><div className="usage-session-list">{sessions.map((row: any) => (
              <div key={`${row.sessionId}-${row.updatedAt}`} className="usage-session-row">
                <div className="usage-session-main"><span className="session-id">{row.sessionId}</span><span className="session-channel">{row.model} · {row.provider} · {row.agent}</span></div>
                <div className="usage-session-side"><span className="usage-token-chip">{formatUsd(Number(row.estimatedUsd) || 0)}</span><span className="usage-token-chip">{formatCount(Number(row.totalTokens) || 0)} tok</span><span className="session-time">{row.updatedAt ?? '—'}</span></div>
              </div>
            ))}</div></div>
          </div>

          <div className="card" style={{ gridColumn: '1 / -1' }}>
            <div className="card-header"><span className="card-title">RAW DATA</span></div>
            <div className="card-body">
              <details>
                <summary className="card-link-btn" style={{ display: 'inline-flex', cursor: 'pointer' }}>Open raw ledger and config</summary>
                <div style={{ marginTop: 12, display: 'grid', gap: 12 }}>
                  <div className="log-path">config: {data.paths.config}</div>
                  <pre className="log-path" style={{ whiteSpace: 'pre-wrap', overflowX: 'auto' }}>{JSON.stringify(data.config ?? {}, null, 2)}</pre>
                  <div className="log-path">provider-state: {data.paths.providerState}</div>
                  <pre className="log-path" style={{ whiteSpace: 'pre-wrap', overflowX: 'auto' }}>{JSON.stringify(data.providerState ?? {}, null, 2)}</pre>
                  <div className="log-path">pricing: {data.paths.pricing}</div>
                  <pre className="log-path" style={{ whiteSpace: 'pre-wrap', overflowX: 'auto' }}>{JSON.stringify(data.pricing ?? {}, null, 2)}</pre>
                  <div className="log-path">ledger: {data.paths.ledger}</div>
                  <pre className="log-path" style={{ whiteSpace: 'pre-wrap', overflowX: 'auto', maxHeight: 520, overflowY: 'auto' }}>{JSON.stringify(data.ledger ?? {}, null, 2)}</pre>
                </div>
              </details>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
