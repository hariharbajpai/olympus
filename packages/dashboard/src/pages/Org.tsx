import { useMemo, useState } from 'react';
import { Crown, UserMinus, UserPlus, Users } from 'lucide-react';
import type { CompanyState, Employee, Level } from '@olympus/shared';
import { queuedHint, useApp } from '../context';
import { LEVEL_LABEL, ago, hueFor, modelLabel, statusLabel } from '../format';
import { Avatar, Card, Empty, PageHeader, Pill, StatusDot } from '../ui';

interface TreeNode {
  employee: Employee;
  children: TreeNode[];
}

function buildTree(state: CompanyState): TreeNode[] {
  const active = state.employees.filter((e) => e.status !== 'fired');
  const make = (e: Employee): TreeNode => ({
    employee: e,
    children: active.filter((c) => c.managerId === e.id).map(make),
  });
  return active.filter((e) => e.managerId === null).map(make);
}

export function Org() {
  const { state } = useApp();
  const [hiring, setHiring] = useState<string | null>(null);
  const roots = useMemo(() => buildTree(state), [state]);
  const active = state.employees.filter((e) => e.status !== 'fired');
  const former = state.employees.filter((e) => e.status === 'fired');
  const hasCeo = active.some((e) => e.roleId === 'ceo');
  const hasHr = active.some((e) => e.roleId === 'hr');

  return (
    <>
      <PageHeader
        title="Org chart"
        subtitle="Everyone who works here, and who reports to whom. Proposed hires join after you approve the PRD."
        actions={
          <button type="button" className="btn primary" onClick={() => setHiring(hiring ? null : '')}>
            <UserPlus size={16} /> Hire
          </button>
        }
      />

      {(!hasCeo || !hasHr) && (
        <div className="vacancies">
          {!hasCeo && (
            <div className="vacancy">
              <Crown size={18} />
              <span>
                <strong>No CEO.</strong> Nothing moves without one.
              </span>
              <button type="button" className="btn primary small" onClick={() => setHiring('ceo')}>
                Hire a CEO
              </button>
            </div>
          )}
          {!hasHr && (
            <div className="vacancy">
              <Users size={18} />
              <span>
                <strong>No Head of HR.</strong> Nobody can staff projects.
              </span>
              <button type="button" className="btn primary small" onClick={() => setHiring('hr')}>
                Hire HR
              </button>
            </div>
          )}
        </div>
      )}

      {hiring !== null && <HirePanel initialRole={hiring} onClose={() => setHiring(null)} />}

      <Card className="org-card">
        <div className="org-scroll">
          <div className="tree">
            <ul>
              <li>
                <div className="owner-node">
                  <span className="avatar owner" style={{ width: 36, height: 36 }}>
                    You
                  </span>
                  <div>
                    <strong>Owner</strong>
                    <span className="muted small">Approves the PRD and the release</span>
                  </div>
                </div>
                {roots.length > 0 && (
                  <ul>
                    {roots.map((node) => (
                      <Branch key={node.employee.id} node={node} />
                    ))}
                  </ul>
                )}
              </li>
            </ul>
          </div>
          {active.length === 0 && <Empty icon={<Users size={22} />} title="Nobody works here">Hire a CEO to get started.</Empty>}
        </div>
      </Card>

      <div className="grid two">
        <Card title="Proposed by HR" subtitle={state.proposals.length ? 'HR hires them once you approve the PRD.' : undefined}>
          {state.proposals.length === 0 ? (
            <p className="muted small">No proposals right now.</p>
          ) : (
            <ul className="people-list">
              {state.proposals.map((p) => {
                const role = state.roles.find((r) => r.id === p.roleId);
                return (
                  <li key={p.id}>
                    <Avatar name={p.name} hue={hueFor(role)} size={30} ghost />
                    <div>
                      <strong>{p.name}</strong>
                      <span className="muted small">
                        {role?.title} · {LEVEL_LABEL[p.level]} · {modelLabel(p.model)}
                      </span>
                      {p.reason && <span className="small">{p.reason}</span>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
        <Card title="Former employees">
          {former.length === 0 ? (
            <p className="muted small">Nobody has left.</p>
          ) : (
            <ul className="people-list">
              {former.map((e) => (
                <li key={e.id} className="former">
                  <Avatar name={e.name} hue="var(--neutral-mark)" size={30} />
                  <div>
                    <strong>{e.name}</strong>
                    <span className="muted small">
                      {e.title} · left {e.firedAt ? ago(e.firedAt) : ''}
                    </span>
                    {e.firedReason && <span className="small">Reason: {e.firedReason}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function Branch({ node }: { node: TreeNode }) {
  return (
    <li>
      <PersonCard employee={node.employee} />
      {node.children.length > 0 && (
        <ul>
          {node.children.map((child) => (
            <Branch key={child.employee.id} node={child} />
          ))}
        </ul>
      )}
    </li>
  );
}

function PersonCard({ employee }: { employee: Employee }) {
  const { state, call } = useApp();
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('Owner decision');
  const role = state.roles.find((r) => r.id === employee.roleId);
  const hue = hueFor(role);
  const openTasks = state.tasks.filter((t) => t.assigneeId === employee.id && t.status !== 'done').length;

  const fire = async () => {
    const ok = await call(`/api/employees/${employee.id}/fire`, { reason }, `${employee.name} was fired.`);
    if (ok) setConfirming(false);
  };

  return (
    <article className={`person ${employee.status}`} style={{ ['--hue' as string]: hue }}>
      <header>
        <Avatar name={employee.name} hue={hue} size={34} />
        <div className="who">
          <strong>{employee.name}</strong>
          <span className="muted small">{employee.title}</span>
        </div>
      </header>
      <div className="person-meta small">
        <StatusDot status={employee.status} />
        <span className="status-text">{statusLabel(employee)}</span>
        <span className="muted">· {employee.level ? `${LEVEL_LABEL[employee.level]} · ` : ''}{modelLabel(employee.model)}</span>
      </div>
      <p className="person-activity small" title={employee.activity}>
        {employee.activity}
      </p>
      <div className="person-foot small">
        <span className="muted">
          {employee.activations} runs{openTasks ? ` · ${openTasks} open tasks` : ''}
        </span>
        {!confirming && (
          <button type="button" className="icon-btn" onClick={() => setConfirming(true)} title={`Fire ${employee.name}`} aria-label={`Fire ${employee.name}`}>
            <UserMinus size={15} />
          </button>
        )}
      </div>
      {confirming && (
        <div className="fire-confirm">
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} aria-label="Reason" />
          <div className="row">
            <button type="button" className="btn danger small" onClick={fire} disabled={!reason.trim()}>
              Fire
            </button>
            <button type="button" className="btn ghost small" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

function HirePanel({ initialRole, onClose }: { initialRole: string; onClose: () => void }) {
  const { state, call } = useApp();
  const [roleId, setRoleId] = useState(initialRole || 'ceo');
  const [name, setName] = useState('');
  const [level, setLevel] = useState<Level | ''>('');
  const [busy, setBusy] = useState(false);

  const hire = async () => {
    setBusy(true);
    const role = state.roles.find((r) => r.id === roleId);
    const ok = await call(
      '/api/employees/hire',
      { roleId, name: name.trim() || null, level: level || null },
      `Hired a new ${role?.title ?? 'employee'}.${state.project ? queuedHint(state) : ''}`,
    );
    setBusy(false);
    if (ok) onClose();
  };

  return (
    <Card title="Hire someone" subtitle="As the Owner you can hire anyone directly. CEO, HR and CTO have one seat each. Or in Claude Code: /olympus:hire <role> [name]">
      <div className="form-grid">
        <label>
          <span className="field-label">Role</span>
          <select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            {state.roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="field-label">Name (optional)</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="We’ll pick one" />
        </label>
        <label>
          <span className="field-label">Level (optional)</span>
          <select value={level} onChange={(e) => setLevel(e.target.value as Level | '')}>
            <option value="">Default</option>
            <option value="sde1">SDE-I</option>
            <option value="sde2">SDE-II</option>
            <option value="senior">Senior</option>
            <option value="mts">MTS (runs on Opus)</option>
          </select>
        </label>
      </div>
      <p className="muted small">{state.roles.find((r) => r.id === roleId)?.summary}</p>
      <div className="row end">
        <button type="button" className="btn ghost" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn primary" onClick={hire} disabled={busy}>
          <UserPlus size={16} /> Hire
        </button>
      </div>
      <Pill tone="info">Reports to the nearest manager in the org structure, automatically.</Pill>
    </Card>
  );
}
