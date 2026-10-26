import { useState } from 'react';
import type { CompanyState } from '@olympus/shared';
import { type Connection, readToken, useCompany } from './api';
import { ActivityFeed, BriefPanel, MessagesPanel } from './components';
import { OrgChart } from './orgchart';

export function App() {
  const [token] = useState(readToken);
  if (!token) {
    return (
      <div className="gate">
        <h1>Olympus HQ</h1>
        <p>
          This dashboard needs your owner link. Run <code>/olympus:start</code> in Claude Code (or{' '}
          <code>npm run olympus -- start</code> in the repo) and open the link it prints.
        </p>
      </div>
    );
  }
  return <Dashboard token={token} />;
}

function Dashboard({ token }: { token: string }) {
  const { state, events, connection } = useCompany(token);
  const [error, setError] = useState<string | null>(null);

  if (connection === 'unauthorized') {
    return (
      <div className="gate">
        <h1>Link expired</h1>
        <p>
          The owner token in this link doesn't match the daemon. Open the link from <code>/olympus:start</code> again.
        </p>
      </div>
    );
  }

  return (
    <div className="app">
      <Header state={state} connection={connection} />
      {error && (
        <div className="banner" role="alert">
          {error}
          <button type="button" className="ghost" onClick={() => setError(null)} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}
      {!state ? (
        <p className="empty">Connecting to the company…</p>
      ) : (
        <main>
          <BriefPanel state={state} token={token} onError={setError} />
          <OrgChart state={state} token={token} onError={setError} />
          <div className="columns">
            <MessagesPanel state={state} />
            <ActivityFeed events={events} state={state} />
          </div>
        </main>
      )}
    </div>
  );
}

function Header({ state, connection }: { state: CompanyState | null; connection: Connection }) {
  return (
    <header className="topbar">
      <div className="brand">
        <span className="logo" aria-hidden>
          T
        </span>
        <div>
          <h1>{state?.companyName ?? 'Olympus'} HQ</h1>
          <span className="muted small">Agents run on your Claude Code session · Phase 0</span>
        </div>
      </div>
      <div className="topbar-right">
        {state && (
          <span className="spend" title="Agent runs in this company run / the limit per run">
            Agent runs <strong>{state.activationsThisRun}</strong> / {state.limits.maxActivationsPerRun}
            {state.demo.mode === 'claude-code' && state.demo.running && (
              <>
                <span className="sep">·</span>
                Claude Code <strong>{state.host.running}</strong> running, <strong>{state.host.waiting}</strong> waiting
              </>
            )}
          </span>
        )}
        <span className={`conn ${connection}`}>
          <span className="dot" aria-hidden />
          {connection === 'live' ? 'Live' : connection === 'connecting' ? 'Connecting' : 'Reconnecting'}
        </span>
      </div>
    </header>
  );
}
