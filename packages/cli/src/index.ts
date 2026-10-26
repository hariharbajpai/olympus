#!/usr/bin/env node
// olympus CLI: boots, stops and checks the company daemon.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import type { CompanyState } from '@olympus/shared';
import { base, daemonFetch, dashboardUrl, ensureDaemon, health, ownerToken, pidFile } from './daemon-control.js';

function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
  } catch {
    // No browser available; the URL is printed anyway.
  }
}

async function summary(): Promise<string> {
  const state = await daemonFetch<CompanyState>('/api/state').catch(() => null);
  if (!state) return '';
  const team = state.employees
    .filter((e) => e.status !== 'fired')
    .map((e) => `${e.name} (${e.title}): ${e.status}`)
    .join('; ');
  const project = state.project
    ? `${state.project.title} · phase ${state.project.phase} · tasks ${state.tasks.filter((t) => t.status === 'done').length}/${state.tasks.length}`
    : 'none yet';
  return [
    `Team: ${team || 'nobody'}`,
    `Project: ${project}`,
    `Mode: ${state.settings.mode === 'claude-code' ? 'Claude Code (agents run in your session: /olympus:brief, /olympus:run)' : 'simulated'}`,
  ].join('\n');
}

async function start(open: boolean): Promise<number> {
  const result = await ensureDaemon();
  if (!result.ok) {
    console.error(result.error);
    return 1;
  }
  console.log(
    result.started
      ? `Started the Olympus daemon (pid ${result.pid}).`
      : `The Olympus daemon is already running (pid ${result.pid}).`,
  );
  const url = dashboardUrl();
  console.log(`Dashboard: ${url}`);
  console.log(await summary());
  if (open) openBrowser(url);
  return 0;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function stop(): Promise<number> {
  if (!(await health())) {
    console.log('The Olympus daemon is not running.');
    return 0;
  }
  if (ownerToken()) await daemonFetch('/api/shutdown', {}).catch(() => null);
  for (let i = 0; i < 20; i++) {
    await sleep(250);
    if (!(await health())) {
      console.log('Stopped the Olympus daemon.');
      return 0;
    }
  }
  if (existsSync(pidFile)) {
    const pid = Number(readFileSync(pidFile, 'utf8'));
    if (Number.isInteger(pid) && pid > 0) {
      try {
        process.kill(pid, 'SIGTERM');
        console.log(`Sent SIGTERM to the daemon (pid ${pid}).`);
        return 0;
      } catch {
        // fall through
      }
    }
  }
  console.error(`Could not stop the daemon at ${base}. Check \`olympus status\`.`);
  return 1;
}

async function status(): Promise<number> {
  const running = await health();
  if (!running) {
    console.log('The Olympus daemon is not running. Start it with /olympus:start (or `olympus start`).');
    return 0;
  }
  console.log(`The Olympus daemon is running (pid ${running.pid}, since ${running.startedAt}).`);
  console.log(`Dashboard: ${dashboardUrl()}`);
  console.log(await summary());
  return 0;
}

async function main(): Promise<number> {
  const [command = 'status', ...flags] = process.argv.slice(2);
  switch (command) {
    case 'start':
      return start(!flags.includes('--no-open'));
    case 'stop':
      return stop();
    case 'status':
      return status();
    case 'open':
      if (!(await health())) {
        console.log('The daemon is not running. Run `olympus start`.');
        return 1;
      }
      openBrowser(dashboardUrl());
      console.log(`Opened ${dashboardUrl()}`);
      return 0;
    case 'url':
      console.log(dashboardUrl());
      return 0;
    default:
      console.log('Usage: olympus <start [--no-open] | stop | status | open | url>');
      return command === 'help' || command === '--help' ? 0 : 1;
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
