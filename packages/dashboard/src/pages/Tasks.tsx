import { SquareKanban } from 'lucide-react';
import { TaskStatusBar } from '../charts';
import { useApp } from '../context';
import { TASK_COLUMNS, ago, hueFor, nameOf } from '../format';
import { Avatar, Card, Empty, PageHeader } from '../ui';

export function Tasks() {
  const { state } = useApp();
  const lead = ['tech-lead', 'cto', 'ceo']
    .map((roleId) => state.employees.find((e) => e.roleId === roleId && e.status !== 'fired'))
    .find(Boolean);

  return (
    <>
      <PageHeader
        title="Task board"
        subtitle={lead ? `${lead.name} (${lead.title}) runs the board and hears about every finished or blocked task.` : 'Tasks appear once the PRD is approved.'}
      />
      {state.tasks.length === 0 ? (
        <Card>
          <Empty icon={<SquareKanban size={22} />} title="No tasks yet">
            After you approve the PRD, HR hires the team and the Tech Lead breaks the work into tasks here.
          </Empty>
        </Card>
      ) : (
        <>
          <Card className="flush">
            <TaskStatusBar state={state} />
          </Card>
          <div className="kanban">
            {TASK_COLUMNS.map((col) => {
              const tasks = state.tasks.filter((t) => t.status === col.id);
              return (
                <section key={col.id} className={`column ${col.id}`} aria-label={col.label}>
                  <header>
                    <span className={`col-dot ${col.id}`} aria-hidden />
                    {col.label}
                    <span className="count">{tasks.length}</span>
                  </header>
                  <div className="column-body">
                    {tasks.length === 0 && <p className="muted small col-empty">Nothing here</p>}
                    {tasks.map((t) => {
                      const assignee = state.employees.find((e) => e.id === t.assigneeId);
                      const role = state.roles.find((r) => r.id === assignee?.roleId);
                      const last = t.notes.at(-1);
                      return (
                        <article key={t.id} className="task">
                          <div className="task-top">
                            <span className="task-id">{t.id}</span>
                            <span className="muted small">{ago(t.updatedAt)}</span>
                          </div>
                          <strong>{t.title}</strong>
                          {t.description && <p className="muted small task-desc">{t.description}</p>}
                          {last && <p className="small task-note">“{last.text}”</p>}
                          <div className="task-foot small">
                            {assignee ? (
                              <>
                                <Avatar name={assignee.name} hue={hueFor(role)} size={22} />
                                <span>{assignee.name}</span>
                              </>
                            ) : (
                              <span className="muted">Unassigned</span>
                            )}
                            <span className="muted push">by {nameOf(state, t.createdBy)}</span>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
