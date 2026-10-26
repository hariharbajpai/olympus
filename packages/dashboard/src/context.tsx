import { createContext, useContext } from 'react';
import type { CompanyEvent, CompanyState } from '@olympus/shared';

export type Page = 'overview' | 'org' | 'project' | 'tasks' | 'messages' | 'activity' | 'settings';

export interface AppContextValue {
  state: CompanyState;
  events: CompanyEvent[];
  /** Calls the daemon. Shows the error (or the success message) as a toast. Resolves true on success. */
  call: (path: string, body: unknown, success?: string) => Promise<boolean>;
  navigate: (page: Page) => void;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp must be used inside AppContext');
  return value;
}

/** In Claude Code mode the dashboard queues work; the Owner's session runs it with /olympus:run. */
export function queuedHint(state: CompanyState): string {
  return state.settings.mode === 'claude-code' ? ' Run /olympus:run in Claude Code so the team picks it up.' : '';
}
