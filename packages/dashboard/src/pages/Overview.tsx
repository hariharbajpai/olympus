import { ArrowRight, FileText, MessageSquareQuote } from 'lucide-react';
import { ProgressChart, RunsByPerson, TaskStatusBar } from '../charts';
import { useApp } from '../context';
import { ago, nameOf } from '../format';
import { Card, Meter, PageHeader, PhaseStepper, Pill, Stat } from '../ui';
import { BriefForm, FeedList } from './shared';

export function Overview() {
  const { state, navigate } = useApp();
  const { project, tasks, settings } = state;
  const active = state.employees.filter((e) => e.status !== 'fired');
  const working = active.filter((e) => e.status === 'working').length;
  const done = tasks.filter((t) => t.status === 'done').length;
  const latestPrd = project?.prd.at(-1);
  const lastFromCeo = [...state.messages].reverse().find((m) => m.to === 'owner' && m.from !== 'system');

  if (!project) {
    return (
      <>
        <PageHeader title="Welcome to Olympus" subtitle="Your AI software company. Brief the CEO to start the first project." />
        <div className="grid two">
          <Card title="Brief the CEO" subtitle="The CEO writes a PRD; nothing is hired or built until you approve it.">
            <BriefForm />
          </Card>
          <Card title="Your company today" subtitle="Hire and fire anyone from the Org chart page.">
            <div className="stats-row">
              <Stat label="Employees" value={active.length} sub={active.map((e) => e.title).join(' · ') || 'Nobody yet'} />
            </div>
            <button type="button" className="btn ghost" onClick={() => navigate('org')}>
              Open the org chart <ArrowRight size={15} />
            </button>
          </Card>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={project.title}
        subtitle={`Started ${ago(project.startedAt)} · ${project.brief}`}
        actions={<Pill tone={project.phase === 'done' ? 'good' : 'accent'}>{project.phase === 'done' ? 'Done' : 'In progress'}</Pill>}
      />
      <Card className="flush">
        <PhaseStepper phase={project.phase} />
      </Card>

      {latestPrd?.status === 'pending' && (
        <div className="needs-you">
          <FileText size={18} />
          <div>
            <strong>PRD v{latestPrd.version} is waiting for your approval</strong>
            <span className="muted small">“{latestPrd.title}”. Nobody is hired and no work starts until you decide.</span>
          </div>
          <button type="button" className="btn primary" onClick={() => navigate('project')}>
            Review PRD <ArrowRight size={15} />
          </button>
        </div>
      )}

      <div className="stats-grid">
        <Stat label="Team" value={active.length} sub={state.proposals.length ? `+${state.proposals.length} proposed` : `${working} working now`} />
        <Stat label="Tasks done" value={`${done}/${tasks.length}`} sub={tasks.length ? `${Math.round((done / tasks.length) * 100)}% complete` : 'After the PRD is approved'}>
          <Meter value={done} max={Math.max(tasks.length, 1)} tone="good" />
        </Stat>
        <Stat label="Agent runs" value={state.activationsThisProject} sub={`of ${settings.maxActivationsPerProject} allowed`}>
          <Meter value={state.activationsThisProject} max={settings.maxActivationsPerProject} tone={state.activationsThisProject / settings.maxActivationsPerProject > 0.8 ? 'warn' : 'accent'} />
        </Stat>
        <Stat label="Messages" value={state.metrics.messages.length} sub="in this project" />
      </div>

      <div className="grid three">
        <Card title="Progress over time" subtitle="Cumulative, since the project started" className="span-2">
          <ProgressChart state={state} />
        </Card>
        <Card title="Task board" subtitle={`${tasks.length} tasks`} actions={<button type="button" className="btn link" onClick={() => navigate('tasks')}>Open <ArrowRight size={14} /></button>}>
          <TaskStatusBar state={state} />
        </Card>
      </div>

      <div className="grid three">
        <Card title="Agent runs by person">
          <RunsByPerson state={state} />
        </Card>
        <Card title="Live activity" actions={<button type="button" className="btn link" onClick={() => navigate('activity')}>All <ArrowRight size={14} /></button>}>
          <FeedList limit={8} />
        </Card>
        <Card title="Latest from the CEO" actions={<button type="button" className="btn link" onClick={() => navigate('messages')}>Reply <ArrowRight size={14} /></button>}>
          {lastFromCeo ? (
            <blockquote className="quote">
              <MessageSquareQuote size={18} />
              <p>{lastFromCeo.text}</p>
              <footer className="muted small">
                {nameOf(state, lastFromCeo.from)} · {ago(lastFromCeo.ts)}
              </footer>
            </blockquote>
          ) : (
            <p className="muted small">No updates yet.</p>
          )}
        </Card>
      </div>
    </>
  );
}
