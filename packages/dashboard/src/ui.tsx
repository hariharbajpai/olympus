import type { ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check } from 'lucide-react';
import type { EmployeeStatus, ProjectPhase } from '@olympus/shared';
import { PHASES, initials } from './format';

export function Avatar({ name, hue, size = 36, ghost = false }: { name: string; hue: string; size?: number; ghost?: boolean }) {
  return (
    <span
      className={`avatar${ghost ? ' ghost' : ''}`}
      style={{ ['--hue' as string]: hue, width: size, height: size, fontSize: Math.round(size * 0.36) }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

export function StatusDot({ status }: { status: EmployeeStatus }) {
  return <span className={`status-dot ${status}`} aria-hidden />;
}

export type PillTone = 'neutral' | 'accent' | 'good' | 'warn' | 'bad' | 'info';

export function Pill({ tone = 'neutral', children }: { tone?: PillTone; children: ReactNode }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </header>
  );
}

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = '',
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p className="muted small">{subtitle}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Empty({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <strong>{title}</strong>
      {children && <div className="muted small">{children}</div>}
    </div>
  );
}

export function Meter({ value, max, tone = 'accent' }: { value: number; max: number; tone?: 'accent' | 'good' | 'warn' }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className={`meter ${tone}`} role="meter" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <span style={{ width: `${pct}%` }} />
    </div>
  );
}

export function PhaseStepper({ phase }: { phase: ProjectPhase }) {
  const current = PHASES.findIndex((p) => p.id === phase);
  return (
    <ol className="stepper" aria-label="Project phase">
      {PHASES.map((p, i) => {
        const state = i < current || phase === 'done' ? 'done' : i === current ? 'current' : 'next';
        return (
          <li key={p.id} className={state} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="step-dot">{state === 'done' ? <Check size={12} strokeWidth={3} /> : i + 1}</span>
            <span className="step-label">{p.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

export function Stat({ label, value, sub, children }: { label: string; value: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub muted small">{sub}</span>}
      {children}
    </div>
  );
}
