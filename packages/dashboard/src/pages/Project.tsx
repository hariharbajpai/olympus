import { useEffect, useState } from 'react';
import { Check, FilePlus2, FileText, Folder, MessageSquareWarning, Terminal } from 'lucide-react';
import type { PrdVersion } from '@olympus/shared';
import { queuedHint, useApp } from '../context';
import { LEVEL_LABEL, ago, hueFor, modelLabel, nameOf } from '../format';
import { Avatar, Card, Empty, Markdown, PageHeader, PhaseStepper, Pill, type PillTone } from '../ui';
import { BriefForm, OwnerComposer } from './shared';

const PRD_STATUS: Record<PrdVersion['status'], { label: string; tone: PillTone }> = {
  pending: { label: 'Waiting for you', tone: 'warn' },
  approved: { label: 'Approved', tone: 'good' },
  changes_requested: { label: 'Changes requested', tone: 'bad' },
  superseded: { label: 'Superseded', tone: 'neutral' },
};

export function Project() {
  const { state } = useApp();
  const [newProject, setNewProject] = useState(false);
  const project = state.project;

  if (!project || newProject) {
    return (
      <>
        <PageHeader
          title={project ? 'New project' : 'Project & PRD'}
          subtitle={project ? 'Starting a new project replaces the current one. The team stays.' : 'No project yet.'}
          actions={
            project && (
              <button type="button" className="btn ghost" onClick={() => setNewProject(false)}>
                Back to {project.title}
              </button>
            )
          }
        />
        <Card title="Brief the CEO" subtitle="The CEO turns it into a PRD for your approval.">
          <BriefForm onStarted={() => setNewProject(false)} />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={project.title}
        subtitle={`Started ${ago(project.startedAt)}`}
        actions={
          <button type="button" className="btn ghost" onClick={() => setNewProject(true)}>
            <FilePlus2 size={16} /> New project
          </button>
        }
      />
      <Card className="flush">
        <PhaseStepper phase={project.phase} />
      </Card>

      <div className="grid project-grid">
        <PrdPanel />
        <div className="stack">
          <Card title="The brief">
            <p className="brief-text">{project.brief}</p>
            <p className="muted small folder">
              <Folder size={14} />
              {project.existingCode ? 'Changing your existing code in' : project.ownerFolder ? 'Building in your folder' : 'Code goes in'}{' '}
              <code>{project.workspaceDir}</code>
            </p>
            {project.existingCode && project.overview && (
              <details className="overview">
                <summary className="muted small">Codebase overview the team works from</summary>
                <pre>{project.overview}</pre>
              </details>
            )}
          </Card>
          <Card title="Staffing" subtitle={state.proposals.length ? 'Proposed by HR, hired after approval' : 'Current team'}>
            <ul className="people-list">
              {(state.proposals.length
                ? state.proposals.map((p) => ({ key: p.id, name: p.name, roleId: p.roleId, line: `${LEVEL_LABEL[p.level]} · ${modelLabel(p.model)}`, ghost: true }))
                : state.employees
                    .filter((e) => e.status !== 'fired')
                    .map((e) => ({ key: e.id, name: e.name, roleId: e.roleId, line: e.title, ghost: false }))
              ).map((p) => {
                const role = state.roles.find((r) => r.id === p.roleId);
                return (
                  <li key={p.key}>
                    <Avatar name={p.name} hue={hueFor(role)} size={28} ghost={p.ghost} />
                    <div>
                      <strong>{p.name}</strong>
                      <span className="muted small">{p.ghost ? `${role?.title} · ${p.line}` : p.line}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
          <Card title="Message the CEO">
            <OwnerComposer compact />
          </Card>
        </div>
      </div>
    </>
  );
}

function PrdPanel() {
  const { state, call } = useApp();
  const versions = state.project?.prd ?? [];
  const [selected, setSelected] = useState<number | null>(null);
  const [mode, setMode] = useState<'idle' | 'changes'>('idle');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const latest = versions.at(-1);

  // Follow the newest version as the CEO submits revisions.
  useEffect(() => {
    setSelected(null);
    setMode('idle');
  }, [latest?.version]);

  if (!latest) {
    return (
      <Card title="PRD" className="prd">
        <Empty icon={<FileText size={22} />} title="The CEO is writing the PRD">
          It appears here as soon as it’s submitted. {state.settings.mode === 'claude-code' && 'If nothing is happening, run /olympus:run in Claude Code.'}
        </Empty>
      </Card>
    );
  }

  const shown = versions.find((v) => v.version === selected) ?? latest;
  const status = PRD_STATUS[shown.status];

  const decide = async (decision: 'approve' | 'changes') => {
    setBusy(true);
    const ok = await call(
      '/api/project/prd/decision',
      { decision, comment: comment.trim() || null },
      decision === 'approve'
        ? `PRD v${latest.version} approved. HR hires next, then the team builds.${queuedHint(state)}`
        : `Sent back to the CEO for changes.${queuedHint(state)}`,
    );
    setBusy(false);
    if (ok) {
      setComment('');
      setMode('idle');
    }
  };

  return (
    <Card
      className="prd"
      title={
        <span className="prd-title">
          PRD v{shown.version} · {shown.title}
        </span>
      }
      subtitle={`Submitted by ${nameOf(state, shown.submittedBy)} ${ago(shown.submittedAt)}`}
      actions={<Pill tone={status.tone}>{status.label}</Pill>}
    >
      {versions.length > 1 && (
        <div className="tabs" role="tablist" aria-label="PRD versions">
          {versions.map((v) => (
            <button
              key={v.version}
              type="button"
              role="tab"
              aria-selected={v.version === shown.version}
              className={v.version === shown.version ? 'on' : ''}
              onClick={() => setSelected(v.version)}
            >
              v{v.version}
            </button>
          ))}
        </div>
      )}

      {shown.ownerComment && (
        <p className="callout small">
          <MessageSquareWarning size={15} /> Your note on v{shown.version}: {shown.ownerComment}
        </p>
      )}

      {shown.status === 'pending' && (
        <div className="decision">
          {mode === 'idle' ? (
            <div className="row wrap">
              <button type="button" className="btn primary" onClick={() => decide('approve')} disabled={busy}>
                <Check size={16} /> Approve PRD
              </button>
              <button type="button" className="btn ghost" onClick={() => setMode('changes')} disabled={busy}>
                Request changes
              </button>
              <span className="muted small hint-line">
                <Terminal size={14} /> or <code>/olympus:approve</code> · <code>/olympus:changes …</code>
              </span>
            </div>
          ) : (
            <div className="changes-box">
              <label className="field-label" htmlFor="changes">
                What should the CEO change?
              </label>
              <textarea id="changes" rows={3} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={4000} />
              <div className="row end">
                <button type="button" className="btn ghost" onClick={() => setMode('idle')}>
                  Cancel
                </button>
                <button type="button" className="btn primary" onClick={() => decide('changes')} disabled={busy || !comment.trim()}>
                  Send to the CEO
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <Markdown text={shown.markdown} />
    </Card>
  );
}
