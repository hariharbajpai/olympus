import { useState } from 'react';
import { Send, Sparkles, Terminal } from 'lucide-react';
import { queuedHint, useApp } from '../context';
import { feedLine } from '../format';
import { clock } from '../format';

const EXAMPLE = 'Build a tic tac toe web game for two players, with a scoreboard and a restart button.';

/** Starts a new project: the CEO gets the brief. Also possible from Claude Code with /olympus:brief. */
export function BriefForm({ onStarted }: { onStarted?: () => void }) {
  const { state, call } = useApp();
  const [brief, setBrief] = useState('');
  const [busy, setBusy] = useState(false);
  const hasCeo = state.employees.some((e) => e.roleId === 'ceo' && e.status !== 'fired');

  const start = async () => {
    setBusy(true);
    const ok = await call('/api/project/start', { brief }, `Project started. The CEO is on it.${queuedHint(state)}`);
    setBusy(false);
    if (ok) {
      setBrief('');
      onStarted?.();
    }
  };

  return (
    <div className="brief-form">
      <label htmlFor="brief" className="field-label">
        What should the company build?
      </label>
      <textarea
        id="brief"
        value={brief}
        onChange={(e) => setBrief(e.target.value)}
        rows={4}
        maxLength={4000}
        placeholder={EXAMPLE}
      />
      <div className="row between wrap">
        <span className="muted small hint-line">
          <Terminal size={14} /> Or in Claude Code: <code>/olympus:brief &lt;what to build&gt;</code>
        </span>
        <button type="button" className="btn primary" onClick={start} disabled={busy || brief.trim().length < 5 || !hasCeo}>
          <Sparkles size={16} /> {busy ? 'Starting…' : 'Brief the CEO'}
        </button>
      </div>
      {!hasCeo && <p className="callout warn small">There is no CEO. Hire one on the Org chart page first.</p>}
    </div>
  );
}

/** The Owner messages the CEO. Also possible from Claude Code with /olympus:tell. */
export function OwnerComposer({ compact = false }: { compact?: boolean }) {
  const { state, call } = useApp();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const ceo = state.employees.find((e) => e.roleId === 'ceo' && e.status !== 'fired');

  const send = async () => {
    setBusy(true);
    const ok = await call('/api/owner/message', { text }, `Sent to ${ceo?.name ?? 'the CEO'}.${queuedHint(state)}`);
    setBusy(false);
    if (ok) setText('');
  };

  return (
    <div className={`composer${compact ? ' compact' : ''}`}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={compact ? 2 : 3}
        maxLength={4000}
        placeholder={ceo ? `Message ${ceo.name} (CEO)…` : 'There is no CEO to message'}
        disabled={!ceo}
        aria-label="Message to the CEO"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && text.trim()) void send();
        }}
      />
      <div className="row between wrap">
        <span className="muted small hint-line">
          <Terminal size={14} /> Or <code>/olympus:tell &lt;message&gt;</code>
        </span>
        <button type="button" className="btn primary" onClick={send} disabled={busy || !text.trim() || !ceo}>
          <Send size={15} /> Send
        </button>
      </div>
    </div>
  );
}

export function FeedList({ limit, filter }: { limit?: number; filter?: string | null }) {
  const { state, events } = useApp();
  const lines = events
    .map((e) => feedLine(e, state))
    .filter((l): l is NonNullable<typeof l> => l !== null)
    .filter((l) => !filter || l.whoId === filter)
    .reverse()
    .slice(0, limit ?? 800);
  if (lines.length === 0) return <p className="muted small pad">Nothing yet.</p>;
  return (
    <ol className="feed">
      {lines.map((line) => (
        <li key={line.id} className={`feed-line ${line.tone}`}>
          <time>{clock(line.ts)}</time>
          <span className="dot" aria-hidden />
          <span className="text">
            {line.who && <strong>{line.who} </strong>}
            {line.text}
          </span>
        </li>
      ))}
    </ol>
  );
}
