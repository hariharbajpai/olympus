import { type ChangeEvent, useEffect, useState } from 'react';
import { Bot, RotateCcw, Terminal } from 'lucide-react';
import type { RuntimeMode, Settings as SettingsType } from '@olympus/shared';
import { useApp } from '../context';
import { Card, PageHeader } from '../ui';

export function Settings() {
  const { state, call } = useApp();
  const [form, setForm] = useState<SettingsType>(state.settings);
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => setForm(state.settings), [state.settings]);

  const setMode = (mode: RuntimeMode) => {
    void call('/api/settings', { mode }, mode === 'claude-code' ? 'Agents now run in your Claude Code session.' : 'Simulated mode: free, scripted employees.');
  };
  const saveLimits = () =>
    void call(
      '/api/settings',
      {
        maxConcurrency: form.maxConcurrency,
        maxActivationsPerEmployee: form.maxActivationsPerEmployee,
        maxActivationsPerProject: form.maxActivationsPerProject,
      },
      'Limits saved.',
    );
  const num = (key: keyof Pick<SettingsType, 'maxConcurrency' | 'maxActivationsPerEmployee' | 'maxActivationsPerProject'>) => ({
    value: form[key],
    onChange: (e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: Number(e.target.value) }),
    type: 'number',
    min: 1,
    max: 500,
  });

  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid two">
        <Card title="Who runs the employees" subtitle="Switching doesn’t touch the team or the project.">
          <div className="mode-options">
            <button type="button" className={`mode-option ${state.settings.mode === 'claude-code' ? 'on' : ''}`} onClick={() => setMode('claude-code')}>
              <Terminal size={20} />
              <strong>Claude Code</strong>
              <span className="muted small">Real agents, as subagents in your Claude Code session on its own login. Work moves while /olympus:brief or /olympus:run is running.</span>
            </button>
            <button type="button" className={`mode-option ${state.settings.mode === 'simulated' ? 'on' : ''}`} onClick={() => setMode('simulated')}>
              <Bot size={20} />
              <strong>Simulated</strong>
              <span className="muted small">Free, scripted employees that walk through the same flow. Good for trying the dashboard.</span>
            </button>
          </div>
        </Card>
        <Card title="Limits" subtitle="They keep a project from using up your Claude plan.">
          <div className="form-grid">
            <label>
              <span className="field-label">Agent runs per project</span>
              <input {...num('maxActivationsPerProject')} />
            </label>
            <label>
              <span className="field-label">Agent runs per person, per project</span>
              <input {...num('maxActivationsPerEmployee')} />
            </label>
            <label>
              <span className="field-label">People working at once</span>
              <input {...num('maxConcurrency')} />
            </label>
          </div>
          <div className="row end">
            <button type="button" className="btn primary" onClick={saveLimits}>
              Save limits
            </button>
          </div>
        </Card>
      </div>
      <Card title="Danger zone" className="danger-zone">
        <div className="row between wrap">
          <p className="muted small">Reset the company to day one: only the founding CEO and HR, no project, no messages. Code already written stays on disk.</p>
          {confirmReset ? (
            <div className="row">
              <button type="button" className="btn ghost" onClick={() => setConfirmReset(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn danger"
                onClick={async () => {
                  if (await call('/api/company/reset', {}, 'The company is back to day one.')) setConfirmReset(false);
                }}
              >
                Yes, reset
              </button>
            </div>
          ) : (
            <button type="button" className="btn ghost" onClick={() => setConfirmReset(true)}>
              <RotateCcw size={15} /> Reset company
            </button>
          )}
        </div>
      </Card>
    </>
  );
}
