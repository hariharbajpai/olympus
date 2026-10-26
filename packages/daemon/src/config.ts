import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Effort } from '@olympus/shared';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repo root: this file lives in packages/daemon/{src,dist}/. */
export const repoRoot = path.resolve(here, '../../..');

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
  dashboardDir: string;
  allowedOrigins: string[];
  maxConcurrency: number;
  maxActivationsPerEmployee: number;
  maxActivationsPerRun: number;
  /** How long a Claude Code session may hold an activation before it's given back. */
  hostClaimTimeoutMs: number;
  /** Shown on the dashboard. The real model comes from each plugin agent's frontmatter. */
  models: Record<'ceo' | 'hr', { model: string; effort: Effort }>;
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
    dashboardDir: process.env.OLYMPUS_DASHBOARD_DIR ?? path.join(repoRoot, 'packages/dashboard/dist'),
    allowedOrigins: [`http://127.0.0.1:${port}`, `http://localhost:${port}`, ...extraOrigins],
    maxConcurrency: numberFromEnv('OLYMPUS_MAX_CONCURRENCY', 4),
    // Phase 0 keeps runs short so they don't eat into the Owner's Claude plan.
    maxActivationsPerEmployee: numberFromEnv('OLYMPUS_MAX_ACTIVATIONS', 3),
    maxActivationsPerRun: numberFromEnv('OLYMPUS_MAX_RUN_ACTIVATIONS', 8),
    hostClaimTimeoutMs: numberFromEnv('OLYMPUS_HOST_TIMEOUT_MIN', 20) * 60_000,
    models: {
      ceo: { model: 'claude-opus-5-5', effort: 'medium' },
      hr: { model: 'claude-sonnet-5-5', effort: 'low' },
    },
  };
}
