import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage, CompanyEvent, CompanyState, RuntimeMode } from '@olympus/shared';
import { api } from './api';
import { clock, feedLine, nameOf } from './format';

const DEFAULT_BRIEF =
  'Build an expense tracker web app for small teams: login, receipt upload, and monthly spending reports.';

type OnError = (message: string | null) => void;

export function BriefPanel({ state, token, onError }: { state: CompanyState; token: string; onError: OnError }) {
  const [brief, setBrief] = useState(DEFAULT_BRIEF);
  const [mode, setMode] = useState<RuntimeMode>('claude-code');
  const [busy, setBusy] = useState(false);
  const running = state.demo.running;

  const submit = async (path: string, body: unknown) => {
    setBusy(true);
    onError(null);
    try {
      await api(token, path, body);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card brief" aria-labelledby="brief-title">
      <div className="card-head">
        <h2 id="brief-title">Brief the CEO</h2>
        <RunStatus state={state} />
      </div>
      <div className="brief-row">
        <textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          rows={2}
          maxLength={2000}
          disabled={running}
          aria-label="Product brief for the CEO"
        />
        <div className="brief-controls">
          <div className="segmented" role="radiogroup" aria-label="Who runs the agents">
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'claude-code'}
              className={mode === 'claude-code' ? 'on' : ''}
              onClick={() => setMode('claude-code')}
              disabled={running}
            >
              Claude Code
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'simulated'}
              className={mode === 'simulated' ? 'on' : ''}
              onClick={() => setMode('simulated')}
              disabled={running}
            >
              Simulated <span className="hint">free</span>
            </button>
          </div>
          <div className="buttons">
            <button type="button" className="ghost" onClick={() => submit('/api/demo/reset', {})} disabled={busy}>
              Reset
            </button>
            <button
              type="button"
              className="primary"
              onClick={() => submit('/api/demo/start', { brief, mode })}
              disabled={busy || running || brief.trim().length < 5}
            >
              {running ? 'Running…' : 'Start run'}
            </button>
          </div>
        </div>
      </div>
      <HostHint state={state} mode={mode} />
    </section>
  );
}

function HostHint({ state, mode }: { state: CompanyState; mode: RuntimeMode }) {
  const { demo, host } = state;
  if (demo.running && demo.mode === 'claude-code' && host.waiting > 0 && host.running === 0) {
    return (
      <p className="callout">
        {host.waiting} employee{host.waiting === 1 ? ' is' : 's are'} waiting for Claude Code. In your Claude Code session, run{' '}
        <code>/olympus:run</code>.
      </p>
    );
  }
  if (demo.running && demo.mode === 'claude-code') {
    return (
      <p className="muted small">
        Claude Code is running {host.running} employee{host.running === 1 ? '' : 's'} as subagents in your session.
      </p>
    );
  }
  if (mode === 'claude-code') {
    return (
      <p className="muted small">
        Employees run as subagents in your Claude Code session, on its own login. Easiest: type{' '}
        <code>/olympus:brief &lt;what to build&gt;</code> there. Starting here queues the work for <code>/olympus:run</code>.
      </p>
    );
  }
  return <p className="muted small">Simulated runs are scripted and free: they test the company without using your Claude plan.</p>;
}

function RunStatus({ state }: { state: CompanyState }) {
  const { demo } = state;
  if (demo.running) {
    return <span className="pill working">Running · {demo.mode === 'claude-code' ? 'Claude Code' : 'simulated'}</span>;
  }
  if (demo.finishedAt) return <span className="pill done">Finished · {state.activationsThisRun} agent runs</span>;
  return <span className="pill idle">Ready</span>;
}

type MessageFilter = 'all' | 'general' | 'direct' | 'owner';

function matches(filter: MessageFilter, m: ChatMessage): boolean {
  if (filter === 'all') return true;
  if (filter === 'general') return m.to === '#general';
  if (filter === 'owner') return m.to === 'owner' || m.from === 'owner';
  return !m.to.startsWith('#') && m.to !== 'owner' && m.from !== 'owner';
}

export function MessagesPanel({ state }: { state: CompanyState }) {
  const [filter, setFilter] = useState<MessageFilter>('all');
  const list = useMemo(() => state.messages.filter((m) => matches(filter, m)), [state.messages, filter]);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [list.length]);

  const tabs: Array<[MessageFilter, string]> = [
    ['all', 'All'],
    ['general', '#general'],
    ['direct', 'Direct'],
    ['owner', 'Owner'],
  ];

  return (
    <section className="card panel" aria-labelledby="msg-title">
      <div className="card-head">
        <h2 id="msg-title">Messages</h2>
        <div className="tabs" role="tablist">
          {tabs.map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={filter === key}
              className={filter === key ? 'on' : ''}
              onClick={() => setFilter(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="scroll">
        {list.length === 0 && <p className="empty">No messages yet. Start a run to see the team talk.</p>}
        {list.map((m) => (
          <div key={m.id} className={`message from-${m.from === 'owner' || m.from === 'system' ? m.from : 'staff'}`}>
            <div className="meta">
              <strong>{nameOf(state, m.from)}</strong>
              <span className="arrow">→</span>
              <span className={m.to === 'owner' ? 'to-owner' : ''}>{nameOf(state, m.to)}</span>
              <time className="muted">{clock(m.ts)}</time>
            </div>
            <p>{m.text}</p>
          </div>
        ))}
        <div ref={end} />
      </div>
    </section>
  );
}

export function ActivityFeed({ events, state }: { events: CompanyEvent[]; state: CompanyState }) {
  const lines = useMemo(
    () =>
      events
        .map((e) => feedLine(e, state))
        .filter((l): l is NonNullable<typeof l> => l !== null)
        .reverse(),
    [events, state],
  );
  const [open, setOpen] = useState<Set<number>>(new Set());
  const toggle = (id: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <section className="card panel" aria-labelledby="feed-title">
      <div className="card-head">
        <h2 id="feed-title">Live activity</h2>
        <span className="muted small">newest first</span>
      </div>
      <ol className="scroll feed">
        {lines.length === 0 && <li className="empty">Waiting for activity…</li>}
        {lines.map((line) => (
          <li
            key={line.id}
            className={`feed-line ${line.tone} ${open.has(line.id) ? 'open' : ''}`}
            onClick={line.tone === 'note' ? () => toggle(line.id) : undefined}
          >
            <time>{clock(line.ts)}</time>
            <span className="dot" aria-hidden />
            <span className="text">
              {line.who && <strong>{line.who} </strong>}
              {line.text}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
