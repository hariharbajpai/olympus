import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity as ActivityIcon,
  FileText,
  LayoutDashboard,
  MessagesSquare,
  Network,
  Settings as SettingsIcon,
  SquareKanban,
  Terminal,
  TriangleAlert,
  X,
} from 'lucide-react';
import type { CompanyState } from '@olympus/shared';
import { ApiError, type Connection, api, readToken, useCompany } from './api';
import { AppContext, type AppContextValue, type Page } from './context';
import { Activity } from './pages/Activity';
import { Messages } from './pages/Messages';
import { Org } from './pages/Org';
import { Overview } from './pages/Overview';
import { Project } from './pages/Project';
import { Settings } from './pages/Settings';
import { Tasks } from './pages/Tasks';

const PAGES: Array<{ id: Page; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'org', label: 'Org chart', icon: Network },
  { id: 'project', label: 'Project & PRD', icon: FileText },
  { id: 'tasks', label: 'Tasks', icon: SquareKanban },
  { id: 'messages', label: 'Messages', icon: MessagesSquare },
  { id: 'activity', label: 'Activity', icon: ActivityIcon },
  { id: 'settings', label: 'Settings', icon: SettingsIcon },
];

function pageFromHash(): Page {
  const id = window.location.hash.replace(/^#\/?/, '');
  return (PAGES.find((p) => p.id === id)?.id ?? 'overview') as Page;
}

export function App() {
  const [token] = useState(readToken);
  if (!token) {
    return (
      <div className="gate">
        <h1>Olympus</h1>
        <p>
          This dashboard needs your owner link. Run <code>/olympus:start</code> in Claude Code and open the link it prints.
        </p>
      </div>
    );
  }
  return <Dashboard token={token} />;
}

interface Toast {
  id: number;
  kind: 'ok' | 'error';
  text: string;
}

function Dashboard({ token }: { token: string }) {
  const { state, events, connection } = useCompany(token);
  const [page, setPage] = useState<Page>(pageFromHash);
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const onHash = () => setPage(pageFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const navigate = useCallback((next: Page) => {
    window.location.hash = `/${next}`;
    window.scrollTo({ top: 0 });
  }, []);

  const toast = useCallback((kind: Toast['kind'], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev.slice(-3), { id, kind, text }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), kind === 'error' ? 8000 : 5000);
  }, []);

  const call = useCallback(
    async (path: string, body: unknown, success?: string) => {
      try {
        await api(token, path, body);
        if (success) toast('ok', success);
        return true;
      } catch (err) {
        toast('error', err instanceof ApiError ? err.message : String(err));
        return false;
      }
    },
    [token, toast],
  );

  const ctx = useMemo<AppContextValue | null>(
    () => (state ? { state, events, call, navigate } : null),
    [state, events, call, navigate],
  );

  if (connection === 'unauthorized') {
    return (
      <div className="gate">
        <h1>Link expired</h1>
        <p>
          The owner token in this link doesn’t match the daemon. Open the link from <code>/olympus:start</code> again.
        </p>
      </div>
    );
  }

  return (
    <div className="shell">
      <Sidebar state={state} page={page} navigate={navigate} connection={connection} />
      <main className="main">
        {!ctx ? (
          <p className="muted pad">Connecting to the company…</p>
        ) : (
          <AppContext.Provider value={ctx}>
            <Banners state={ctx.state} page={page} navigate={navigate} />
            {page === 'overview' && <Overview />}
            {page === 'org' && <Org />}
            {page === 'project' && <Project />}
            {page === 'tasks' && <Tasks />}
            {page === 'messages' && <Messages />}
            {page === 'activity' && <Activity />}
            {page === 'settings' && <Settings />}
          </AppContext.Provider>
        )}
      </main>
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <span>{t.text}</span>
            <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}>
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Sidebar({ state, page, navigate, connection }: { state: CompanyState | null; page: Page; navigate: (p: Page) => void; connection: Connection }) {
  const prdPending = state?.project?.prd.at(-1)?.status === 'pending';
  const openTasks = state?.tasks.filter((t) => t.status !== 'done').length ?? 0;
  const team = state?.employees.filter((e) => e.status !== 'fired').length ?? 0;
  const working = state?.employees.filter((e) => e.status === 'working').length ?? 0;

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="logo" aria-hidden>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 20h18M5 20l5-9 3 5 2-3 4 7" />
            <circle cx="16.5" cy="6" r="2" />
          </svg>
        </span>
        <div>
          <strong>{state?.companyName ?? 'Olympus'}</strong>
          <span>AI tech company</span>
        </div>
      </div>

      <nav aria-label="Sections">
        {PAGES.map((p) => {
          const Icon = p.icon;
          const badge =
            p.id === 'project' && prdPending ? (
              <span className="nav-badge warn">1</span>
            ) : p.id === 'tasks' && openTasks > 0 ? (
              <span className="nav-badge">{openTasks}</span>
            ) : p.id === 'org' ? (
              <span className="nav-badge muted">{team}</span>
            ) : null;
          return (
            <a
              key={p.id}
              href={`#/${p.id}`}
              className={`nav-item ${page === p.id ? 'active' : ''}`}
              aria-current={page === p.id ? 'page' : undefined}
              onClick={(e) => {
                e.preventDefault();
                navigate(p.id);
              }}
            >
              <Icon size={18} />
              <span>{p.label}</span>
              {badge}
            </a>
          );
        })}
      </nav>

      <div className="sidebar-foot">
        <div className="foot-row">
          <span className={`conn-dot ${connection}`} aria-hidden />
          {connection === 'live' ? 'Live' : connection === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
          {state && <span className="foot-muted">· {working} working</span>}
        </div>
        {state && (
          <div className="foot-row">
            <Terminal size={14} />
            {state.settings.mode === 'claude-code' ? 'Claude Code' : 'Simulated'}
            {state.settings.mode === 'claude-code' && (state.host.running > 0 || state.host.waiting > 0) && (
              <span className="foot-muted">
                · {state.host.running} running, {state.host.waiting} waiting
              </span>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

function Banners({ state, page, navigate }: { state: CompanyState; page: Page; navigate: (p: Page) => void }) {
  if (state.waitingFor === 'claude_code') {
    return (
      <div className="banner warn">
        <Terminal size={17} />
        <span>
          <strong>
            {state.host.waiting} {state.host.waiting === 1 ? 'employee is' : 'employees are'} waiting for Claude Code.
          </strong>{' '}
          Run <code>/olympus:run</code> in your Claude Code session so they can work.
        </span>
      </div>
    );
  }
  const latest = state.project?.prd.at(-1);
  // Overview and Project already show the PRD decision prominently.
  if (state.waitingFor === 'owner_prd' && latest && page !== 'overview' && page !== 'project') {
    return (
      <div className="banner accent">
        <FileText size={17} />
        <span>
          <strong>PRD v{latest.version} is waiting for your approval.</strong> Nothing is hired or built until you decide.
        </span>
        <button type="button" className="btn primary small" onClick={() => navigate('project')}>
          Review
        </button>
      </div>
    );
  }
  const paused = state.employees.some((e) => e.status === 'queued' && e.activity.startsWith('Paused'));
  if (paused) {
    return (
      <div className="banner warn">
        <TriangleAlert size={17} />
        <span>
          <strong>Work is paused at the agent-run limit.</strong> Raise it in Settings to continue.
        </span>
        <button type="button" className="btn small" onClick={() => navigate('settings')}>
          Settings
        </button>
      </div>
    );
  }
  return null;
}
