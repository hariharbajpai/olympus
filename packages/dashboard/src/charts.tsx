import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { CompanyState, TaskStatus } from '@olympus/shared';
import { TASK_COLUMNS, firstName, shortClock } from './format';

const AXIS_TICK = { fill: 'var(--muted)', fontSize: 11 };

interface ProgressPoint {
  t: number;
  runs: number;
  done: number;
}

function cumulative(times: string[], at: number): number {
  let n = 0;
  for (const ts of times) if (new Date(ts).getTime() <= at) n++;
  return n;
}

/** Cumulative agent runs and finished tasks, sampled evenly from the project's start to now. */
export function useProgressSeries(state: CompanyState, buckets = 30): ProgressPoint[] {
  const { metrics, project } = state;
  return useMemo(() => {
    if (!project) return [];
    const start = new Date(project.startedAt).getTime();
    const lastEvent = Math.max(
      start,
      ...[...metrics.activations, ...metrics.tasksDone].map((ts) => new Date(ts).getTime()),
    );
    const end = Math.max(lastEvent, Date.now());
    const span = Math.max(end - start, 60_000);
    const points: ProgressPoint[] = [];
    for (let i = 0; i <= buckets; i++) {
      const t = start + (span * i) / buckets;
      points.push({ t, runs: cumulative(metrics.activations, t), done: cumulative(metrics.tasksDone, t) });
    }
    return points;
  }, [metrics, project, buckets]);
}

function ProgressTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ProgressPoint }> }) {
  const point = payload?.[0]?.payload;
  if (!active || !point) return null;
  return (
    <div className="chart-tooltip">
      <strong>{shortClock(point.t)}</strong>
      <span>
        <i className="key series-1" /> Agent runs <b>{point.runs}</b>
      </span>
      <span>
        <i className="key series-2" /> Tasks done <b>{point.done}</b>
      </span>
    </div>
  );
}

export function ProgressChart({ state }: { state: CompanyState }) {
  const data = useProgressSeries(state);
  const last = data.at(-1);
  // Short projects need seconds on the time axis, or every tick reads the same minute.
  const span = data.length > 1 ? data.at(-1)!.t - data[0]!.t : 0;
  const tickFormat = (t: number) =>
    new Date(t).toLocaleTimeString([], span < 10 * 60_000 ? { minute: '2-digit', second: '2-digit' } : { hour: '2-digit', minute: '2-digit' });
  if (!last || (last.runs === 0 && last.done === 0)) {
    return <p className="chart-empty muted small">The chart fills in as the team works.</p>;
  }
  return (
    <div className="chart">
      <div className="chart-legend">
        <span>
          <i className="key series-1" /> Agent runs <b>{last.runs}</b>
        </span>
        <span>
          <i className="key series-2" /> Tasks done <b>{last.done}</b>
        </span>
      </div>
      <ResponsiveContainer width="100%" height={230}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: -12 }}>
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis
            dataKey="t"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={tickFormat}
            tick={AXIS_TICK}
            tickLine={false}
            axisLine={{ stroke: 'var(--grid)' }}
            minTickGap={40}
          />
          <YAxis allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false} width={40} />
          <Tooltip content={<ProgressTooltip />} cursor={{ stroke: 'var(--muted)', strokeWidth: 1 }} />
          <Line
            type="stepAfter"
            dataKey="runs"
            name="Agent runs"
            stroke="var(--series-1)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 5, stroke: 'var(--surface)', strokeWidth: 2 }}
            isAnimationActive={false}
          />
          <Line
            type="stepAfter"
            dataKey="done"
            name="Tasks done"
            stroke="var(--series-2)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 5, stroke: 'var(--surface)', strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function RunsByPerson({ state }: { state: CompanyState }) {
  const data = useMemo(
    () =>
      state.employees
        .filter((e) => e.status !== 'fired' || e.activations > 0)
        .map((e) => ({ name: firstName(e), title: e.title, runs: e.activations }))
        .sort((a, b) => b.runs - a.runs)
        .slice(0, 10),
    [state.employees],
  );
  if (data.every((d) => d.runs === 0)) {
    return <p className="chart-empty muted small">Nobody has run yet.</p>;
  }
  return (
    <div className="chart">
      <ResponsiveContainer width="100%" height={Math.max(120, data.length * 34 + 16)}>
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 36, bottom: 4, left: 0 }}>
          <XAxis type="number" hide allowDecimals={false} />
          <YAxis type="category" dataKey="name" tick={{ ...AXIS_TICK, fill: 'var(--text-2)' }} tickLine={false} axisLine={false} width={72} />
          <Tooltip
            cursor={{ fill: 'var(--hover)' }}
            content={({ active, payload }) => {
              const row = payload?.[0]?.payload as { name: string; title: string; runs: number } | undefined;
              if (!active || !row) return null;
              return (
                <div className="chart-tooltip">
                  <strong>{row.name}</strong>
                  <span className="muted">{row.title}</span>
                  <span>
                    Agent runs <b>{row.runs}</b>
                  </span>
                </div>
              );
            }}
          />
          <Bar dataKey="runs" fill="var(--series-1)" barSize={16} radius={[0, 4, 4, 0]} isAnimationActive={false}>
            <LabelList dataKey="runs" position="right" style={{ fill: 'var(--text-2)', fontSize: 11 }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

const STATUS_COLOR: Record<TaskStatus, string> = {
  done: 'var(--good)',
  in_progress: 'var(--series-1)',
  review: 'var(--violet)',
  blocked: 'var(--critical)',
  todo: 'var(--neutral-mark)',
};

/** One stacked bar of the board by status, with a legend that carries the counts. */
export function TaskStatusBar({ state }: { state: CompanyState }) {
  const counts = TASK_COLUMNS.map((c) => ({ ...c, n: state.tasks.filter((t) => t.status === c.id).length }));
  const total = state.tasks.length;
  if (total === 0) return <p className="chart-empty muted small">No tasks yet. They appear after the PRD is approved.</p>;
  const order: TaskStatus[] = ['done', 'review', 'in_progress', 'blocked', 'todo'];
  return (
    <div className="status-bar-wrap">
      <div className="status-bar" role="img" aria-label={counts.map((c) => `${c.label}: ${c.n}`).join(', ')}>
        {order
          .map((id) => counts.find((c) => c.id === id)!)
          .filter((c) => c.n > 0)
          .map((c) => (
            <span key={c.id} style={{ flexGrow: c.n, background: STATUS_COLOR[c.id] }} title={`${c.label}: ${c.n}`} />
          ))}
      </div>
      <ul className="status-legend">
        {order.map((id) => {
          const c = counts.find((x) => x.id === id)!;
          return (
            <li key={id}>
              <i className="key" style={{ background: STATUS_COLOR[id] }} />
              {c.label}
              <b>{c.n}</b>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
