import { useMemo, useState } from 'react';
import type { CompanyState, Employee, OrgRole, ProposedHire } from '@olympus/shared';
import { api } from './api';
import { LEVEL_LABEL, duration, hueFor, initials, modelLabel, statusLabel } from './format';

type OnError = (message: string | null) => void;

interface OrgNode {
  role: OrgRole;
  employees: Employee[];
  proposals: ProposedHire[];
  children: OrgNode[];
  /** People (hired or proposed) in this role or anywhere below it. */
  peopleBelow: number;
}

function buildTree(state: CompanyState): OrgNode[] {
  const make = (role: OrgRole): OrgNode => {
    const children = state.roles.filter((r) => r.reportsTo === role.id).map(make);
    const employees = state.employees.filter((e) => e.roleId === role.id);
    const proposals = state.proposals.filter((p) => p.roleId === role.id);
    const own = employees.length + proposals.length;
    return { role, employees, proposals, children, peopleBelow: own + children.reduce((n, c) => n + c.peopleBelow, 0) };
  };
  return state.roles.filter((r) => r.reportsTo === null).map(make);
}

function visible(nodes: OrgNode[], showOpen: boolean): OrgNode[] {
  return showOpen ? nodes : nodes.filter((n) => n.peopleBelow > 0);
}

export function OrgChart({ state, token, onError }: { state: CompanyState; token: string; onError: OnError }) {
  const [showOpen, setShowOpen] = useState(true);
  const roots = useMemo(() => buildTree(state), [state]);
  const working = state.employees.filter((e) => e.status === 'working').length;
  const hired = state.employees.filter((e) => e.status !== 'fired').length;
  const filledRoles = new Set([...state.employees.map((e) => e.roleId), ...state.proposals.map((p) => p.roleId)]);
  const open = state.roles.filter((r) => !filledRoles.has(r.id)).length;

  return (
    <section className="card" aria-labelledby="org-title">
      <div className="card-head">
        <div>
          <h2 id="org-title">Org chart</h2>
          <span className="muted small">
            {hired} employees · {state.proposals.length} proposed · {open} open roles · {working} working now
          </span>
        </div>
        <label className="toggle">
          <input type="checkbox" checked={showOpen} onChange={(e) => setShowOpen(e.target.checked)} />
          Show open roles
        </label>
      </div>

      <div className="org">
        <div className="owner-node">
          <span className="avatar owner">You</span>
          <div>
            <strong>Owner</strong>
            <div className="muted small">Approves the PRD and the release</div>
          </div>
        </div>
        {roots.map((root) => (
          <Tier key={root.role.id} node={root} showOpen={showOpen} token={token} onError={onError} />
        ))}
      </div>

      <Legend />
    </section>
  );
}

/** A node at the top of the chart (the CEO), its direct reports as a row, and their teams below. */
function Tier({ node, showOpen, token, onError }: { node: OrgNode; showOpen: boolean; token: string; onError: OnError }) {
  const reports = visible(node.children, showOpen);
  const teams = reports.filter((r) => visible(r.children, showOpen).length > 0);
  return (
    <>
      <div className="v-line" aria-hidden />
      <div className="tier-top">
        <People node={node} token={token} onError={onError} />
      </div>
      {reports.length > 0 && (
        <>
          <div className="v-line" aria-hidden />
          <div className="reports-row" style={{ ['--count' as string]: reports.length }}>
            {reports.map((child) => (
              <div key={child.role.id} className="report-cell">
                <People node={child} token={token} onError={onError} />
              </div>
            ))}
          </div>
        </>
      )}
      {teams.map((lead) => (
        <TeamBlock key={lead.role.id} lead={lead} showOpen={showOpen} token={token} onError={onError} />
      ))}
    </>
  );
}

/** Everyone below one of the CEO's direct reports (for example the CTO's engineering org). */
function TeamBlock({ lead, showOpen, token, onError }: { lead: OrgNode; showOpen: boolean; token: string; onError: OnError }) {
  const leadName = lead.employees[0]?.name ?? lead.proposals[0]?.name;
  const members = visible(lead.children, showOpen);
  return (
    <div className="team-block" style={{ ['--hue' as string]: hueFor(lead.role) }}>
      <div className="team-head">
        <strong>{lead.role.department} team</strong>
        <span className="muted small">
          reports to {lead.role.title}
          {leadName ? ` · ${leadName}` : ' (open)'}
        </span>
      </div>
      <div className="team-grid">
        {members.map((member) => (
          <div key={member.role.id} className="team-cell">
            <Branch node={member} showOpen={showOpen} token={token} onError={onError} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** A role's people, then everyone who reports to it as an indented tree. */
function Branch({ node, showOpen, token, onError }: { node: OrgNode; showOpen: boolean; token: string; onError: OnError }) {
  const children = visible(node.children, showOpen);
  return (
    <>
      <People node={node} token={token} onError={onError} />
      {children.length > 0 && (
        <ul className="tree" aria-label={`Reports to ${node.role.title}`}>
          {children.map((child) => (
            <li key={child.role.id}>
              <Branch node={child} showOpen={showOpen} token={token} onError={onError} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function People({ node, token, onError }: { node: OrgNode; token: string; onError: OnError }) {
  const hue = hueFor(node.role);
  if (node.employees.length === 0 && node.proposals.length === 0) {
    return <OpenRoleCard role={node.role} hue={hue} />;
  }
  return (
    <div className="people">
      {node.employees.map((e) => (
        <EmployeeCard key={e.id} employee={e} hue={hue} token={token} onError={onError} />
      ))}
      {node.proposals.map((p) => (
        <ProposedCard key={p.id} hire={p} role={node.role} hue={hue} />
      ))}
    </div>
  );
}

function EmployeeCard({ employee, hue, token, onError }: { employee: Employee; hue: string; token: string; onError: OnError }) {
  const [confirming, setConfirming] = useState(false);
  const [reason, setReason] = useState('Fired by the Owner');
  const fired = employee.status === 'fired';

  const fire = async () => {
    onError(null);
    try {
      await api(token, `/api/employees/${employee.id}/fire`, { reason });
      setConfirming(false);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <article className={`employee ${employee.status}`} style={{ ['--hue' as string]: hue }}>
      <header>
        <span className="avatar">{initials(employee.name)}</span>
        <div className="who">
          <strong>{employee.name}</strong>
          <span className="muted small">{employee.title}</span>
        </div>
        <span className={`pill ${employee.status}`}>{statusLabel(employee)}</span>
      </header>
      <p className={`activity ${employee.status === 'working' ? 'live' : ''}`}>
        {fired ? `Reason: ${employee.firedReason ?? 'not given'}` : employee.activity}
      </p>
      <dl className="stats">
        <div>
          <dt>Model</dt>
          <dd>
            {modelLabel(employee.model)} · {employee.effort}
          </dd>
        </div>
        <div>
          <dt>Runs</dt>
          <dd>{employee.activations}</dd>
        </div>
        <div>
          <dt>Last</dt>
          <dd>{employee.lastDurationMs === null ? '–' : duration(employee.lastDurationMs)}</dd>
        </div>
      </dl>
      {!fired &&
        (confirming ? (
          <div className="fire-confirm">
            <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} aria-label="Reason" />
            <button type="button" className="danger" onClick={fire} disabled={!reason.trim()}>
              Fire
            </button>
            <button type="button" className="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button type="button" className="ghost small-btn" onClick={() => setConfirming(true)}>
            Fire…
          </button>
        ))}
    </article>
  );
}

function ProposedCard({ hire, role, hue }: { hire: ProposedHire; role: OrgRole; hue: string }) {
  return (
    <article className="role-card proposed" style={{ ['--hue' as string]: hue }} title={hire.reason}>
      <header>
        <span className="avatar ghosted">{initials(hire.name)}</span>
        <div className="who wrap">
          <strong>{hire.name}</strong>
          <span className="muted small">{role.title}</span>
        </div>
      </header>
      <p className="small proposed-meta">
        <span className="pill proposed">Proposed</span>
        <span className="muted">
          {LEVEL_LABEL[hire.level]} · {modelLabel(hire.model)}
        </span>
      </p>
      {hire.reason && <p className="muted small reason">{hire.reason}</p>}
    </article>
  );
}

function OpenRoleCard({ role, hue }: { role: OrgRole; hue: string }) {
  return (
    <article className="role-card open" style={{ ['--hue' as string]: hue }}>
      <strong>{role.title}</strong>
      <span className="muted small">Open · {role.summary}</span>
    </article>
  );
}

function Legend() {
  return (
    <div className="legend muted small">
      <span>
        <i className="sw solid" /> Hired
      </span>
      <span>
        <i className="sw dashed" /> Proposed by HR (hired after you approve the PRD)
      </span>
      <span>
        <i className="sw faint" /> Open role
      </span>
    </div>
  );
}
