import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Settings } from '@olympus/shared';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repo root: this file lives in packages/daemon/{src,dist}/. */
export const repoRoot = path.resolve(here, '../../..');

/** The dashboard build next to the bundled daemon (installed plugin), else the repo's own build. */
function defaultDashboardDir(): string {
  const bundled = path.join(here, 'dashboard');
  return existsSync(path.join(bundled, 'index.html')) ? bundled : path.join(repoRoot, 'packages/dashboard/dist');
}

/**
 * Loads KEY=value lines from the repo's .env (or OLYMPUS_ENV_FILE) into process.env.
 * Values already set in the environment win. Optional: Olympus needs no API key.
 */
export function loadEnvFile(): string | null {
  const file = process.env.OLYMPUS_ENV_FILE ?? path.join(repoRoot, '.env');
  if (!existsSync(file)) return null;
  process.loadEnvFile(file);
  return file;
}

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive number, got "${raw}"`);
  }
  return value;
}

function expandHome(p: string): string {
  return p === '~' || p.startsWith('~/') ? path.join(os.homedir(), p.slice(1)) : p;
}

export interface DaemonConfig {
  companyName: string;
  host: '127.0.0.1';
  port: number;
  workspaceDir: string;
  stateDir: string;
  /** Each project gets a folder here for the code its engineers write. */
  projectsDir: string;
  dashboardDir: string;
  allowedOrigins: string[];
  /** Defaults for a new company. Saved settings (changed on the dashboard) win. */
  settings: Settings;
  /** How long a Claude Code session may hold an activation before it's given back. */
  hostClaimTimeoutMs: number;
}

export function readConfig(): DaemonConfig {
  const port = numberFromEnv('OLYMPUS_PORT', 4800);
  const workspaceDir = path.resolve(expandHome(process.env.OLYMPUS_WORKSPACE ?? '~/Olympus'));
  const extraOrigins = (process.env.OLYMPUS_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  return {
    companyName: process.env.OLYMPUS_COMPANY_NAME ?? 'Olympus',
    host: '127.0.0.1',
    port,
    workspaceDir,
    stateDir: path.join(workspaceDir, '.olympus'),
    projectsDir: path.join(workspaceDir, 'projects'),
    dashboardDir: process.env.OLYMPUS_DASHBOARD_DIR ?? defaultDashboardDir(),
    allowedOrigins: [`http://127.0.0.1:${port}`, `http://localhost:${port}`, ...extraOrigins],
    settings: {
      mode: process.env.OLYMPUS_MODE === 'simulated' ? 'simulated' : 'claude-code',
      maxConcurrency: numberFromEnv('OLYMPUS_MAX_CONCURRENCY', 4),
      // Limits keep a project from eating the Owner's Claude plan; raise them in Settings.
      maxActivationsPerEmployee: numberFromEnv('OLYMPUS_MAX_ACTIVATIONS', 12),
      maxActivationsPerProject: numberFromEnv('OLYMPUS_MAX_PROJECT_ACTIVATIONS', 60),
    },
    hostClaimTimeoutMs: numberFromEnv('OLYMPUS_HOST_TIMEOUT_MIN', 20) * 60_000,
  };
}
