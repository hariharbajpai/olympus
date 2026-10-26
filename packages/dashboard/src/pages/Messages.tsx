import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage } from '@olympus/shared';
import { useApp } from '../context';
import { clock, hueFor, nameOf } from '../format';
import { Avatar, Card, PageHeader } from '../ui';
import { OwnerComposer } from './shared';

type Filter = 'all' | 'owner' | 'general' | 'direct';

function matches(filter: Filter, m: ChatMessage): boolean {
  if (filter === 'all') return true;
  if (filter === 'general') return m.to === '#general';
  if (filter === 'owner') return m.to === 'owner' || m.from === 'owner';
  return !m.to.startsWith('#') && m.to !== 'owner' && m.from !== 'owner';
}

export function Messages() {
  const { state } = useApp();
  const [filter, setFilter] = useState<Filter>('all');
  const list = useMemo(() => state.messages.filter((m) => matches(filter, m)), [state.messages, filter]);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => end.current?.scrollIntoView({ block: 'nearest' }), [list.length]);

  const tabs: Array<[Filter, string]> = [
    ['all', 'All'],
    ['owner', 'You & CEO'],
    ['general', '#general'],
    ['direct', 'Team DMs'],
  ];

  return (
    <>
      <PageHeader title="Messages" subtitle="Every message in the company. You talk to the CEO; the CEO runs the rest." />
      <Card
        className="messages-card"
        actions={
          <div className="tabs" role="tablist">
            {tabs.map(([key, label]) => (
              <button key={key} type="button" role="tab" aria-selected={filter === key} className={filter === key ? 'on' : ''} onClick={() => setFilter(key)}>
                {label}
              </button>
            ))}
          </div>
        }
        title="Conversation"
      >
        <div className="message-list">
          {list.length === 0 && <p className="muted small pad">No messages here yet.</p>}
          {list.map((m) => {
            const sender = state.employees.find((e) => e.id === m.from);
            const role = state.roles.find((r) => r.id === sender?.roleId);
            const mine = m.from === 'owner';
            return (
              <div key={m.id} className={`msg ${mine ? 'mine' : ''} ${m.from === 'system' ? 'system' : ''}`}>
                {!mine && m.from !== 'system' && <Avatar name={sender?.name ?? m.from} hue={hueFor(role)} size={30} />}
                <div className="bubble">
                  <div className="msg-meta small">
                    <strong>{nameOf(state, m.from)}</strong>
                    <span className="muted">→ {nameOf(state, m.to)}</span>
                    <time className="muted">{clock(m.ts)}</time>
                  </div>
                  <p>{m.text}</p>
                </div>
              </div>
            );
          })}
          <div ref={end} />
        </div>
        <OwnerComposer />
      </Card>
    </>
  );
}
