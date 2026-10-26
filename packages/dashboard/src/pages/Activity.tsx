import { useState } from 'react';
import { useApp } from '../context';
import { Card, PageHeader } from '../ui';
import { FeedList } from './shared';

export function Activity() {
  const { state } = useApp();
  const [who, setWho] = useState<string>('');
  return (
    <>
      <PageHeader title="Activity" subtitle="Everything that happens, newest first, live." />
      <Card
        title="Live feed"
        actions={
          <select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Filter by person">
            <option value="">Everyone</option>
            <option value="owner">Owner</option>
            {state.employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name} · {e.title}
              </option>
            ))}
          </select>
        }
      >
        <FeedList filter={who || null} />
      </Card>
    </>
  );
}
