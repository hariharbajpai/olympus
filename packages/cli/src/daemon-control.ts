// Finding, starting and calling the Olympus daemon. Shared by the CLI and the plugin MCP server.
// Node built-ins only, so both can be bundled into single files inside the plugin.
import { spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { HealthResponse } from '@olympus/shared';

export const port = Number(process.env.OLYMPUS_PORT ?? 4800);
export const base = `http://127.0.0.1:${port}`;
export const workspace = path.resolve(
  (process.env.OLYMPUS_WORKSPACE ?? '~/Olympus').replace(/^~(?=$|\/)/, os.homedir()),
);
export const stateDir = path.join(workspace, '.olympus');
export const logFile = path.join(stateDir, 'daemon.log');
export const pidFile = path.join(stateDir, 'daemon.pid');

/**
 * Finds the daemon: OLYMPUS_DAEMON_ENTRY, then the bundle next to this file (plugin/dist/olympus-daemon.mjs,
 * which is how an installed plugin ships it), then packages/daemon/dist/main.js walking up from this file
 * (development in the repo).
 */
export function findDaemonEntry(): string | null {
  if (process.env.OLYMPUS_DAEMON_ENTRY) return process.env.OLYMPUS_DAEMON_ENTRY;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const bundled = path.join(here, 'olympus-daemon.mjs');
  if (existsSync(bundled)) return bundled;
  let dir = here;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, 'packages/daemon/dist/main.js');
    if (existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  return null;
}

export async function health(): Promise<HealthResponse | null> {
  try {
    const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) });
    if (!res.ok) return null;
    const body = (await res.json()) as HealthResponse;
    return body.name === 'olympus-daemon' ? body : null;
  } catch {
    return null;
  }
}

export function ownerToken(): string | null {
  const file = path.join(stateDir, 'owner-token');
  return existsSync(file) ? readFileSync(file, 'utf8').trim() : null;
}

export function dashboardUrl(): string {
  const token = ownerToken();
  return token ? `${base}/?token=${token}` : base;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function tail(file: string, lines: number): string {
  if (!existsSync(file)) return '';
  return readFileSync(file, 'utf8').trimEnd().split('\n').slice(-lines).join('\n');
}

/** Variables the Claude Code app sets for its own session. The daemon doesn't need them. */
function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(CLAUDE|ANTHROPIC)/i.test(key)) continue;
    env[key] = value;
  }
  return env;
}

export type EnsureResult = { ok: true; started: boolean; pid: number } | { ok: false; error: string };

/** Starts the daemon in the background unless it's already running. */
export async function ensureDaemon(): Promise<EnsureResult> {
  const running = await health();
  if (running) return { ok: true, started: false, pid: running.pid };
  const entry = findDaemonEntry();
  if (!entry) {
    return { ok: false, error: 'Could not find the daemon build (packages/daemon/dist/main.js). Run `npm run build` in the Olympus repo.' };
  }
  mkdirSync(stateDir, { recursive: true });
  const log = openSync(logFile, 'a');
  const child = spawn(process.execPath, [entry], {
    detached: true,
    stdio: ['ignore', log, log],
    cwd: path.dirname(entry),
    env: cleanEnv(),
  });
  child.unref();
  closeSync(log);
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    const up = await health();
    if (up) return { ok: true, started: true, pid: up.pid };
  }
  return { ok: false, error: `The daemon did not start. Last lines of ${logFile}:\n${tail(logFile, 15)}` };
}

export class DaemonError extends Error {}

/** Calls the daemon API with the owner token. POST when a body is given. */
export async function daemonFetch<T>(apiPath: string, body?: unknown): Promise<T> {
  const token = ownerToken();
  if (!token) throw new DaemonError('No owner token yet. Start Olympus first (/olympus:start).');
  let res: Response;
  try {
    res = await fetch(`${base}${apiPath}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'x-olympus-token': token,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new DaemonError('The Olympus daemon is not running. Start it with /olympus:start.');
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new DaemonError(data.error ?? `Daemon request failed (${res.status}).`);
  return data;
}
