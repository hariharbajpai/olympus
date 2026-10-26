#!/usr/bin/env node
import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);

// packages/cli/src/index.ts
import { spawn as spawn2 } from "node:child_process";
import { existsSync as existsSync2, readFileSync as readFileSync2 } from "node:fs";

// packages/cli/src/daemon-control.ts
import { spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
var port = Number(process.env.OLYMPUS_PORT ?? 4800);
var base = `http://127.0.0.1:${port}`;
var workspace = path.resolve(
  (process.env.OLYMPUS_WORKSPACE ?? "~/Olympus").replace(/^~(?=$|\/)/, os.homedir())
);
var stateDir = path.join(workspace, ".olympus");
var logFile = path.join(stateDir, "daemon.log");
var pidFile = path.join(stateDir, "daemon.pid");
function findDaemonEntry() {
  if (process.env.OLYMPUS_DAEMON_ENTRY) return process.env.OLYMPUS_DAEMON_ENTRY;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const bundled = path.join(here, "olympus-daemon.mjs");
  if (existsSync(bundled)) return bundled;
  let dir = here;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, "packages/daemon/dist/main.js");
    if (existsSync(candidate)) return candidate;
    dir = path.dirname(dir);
  }
  return null;
}
async function health() {
  try {
    const res = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1e3) });
    if (!res.ok) return null;
    const body = await res.json();
    return body.name === "olympus-daemon" ? body : null;
  } catch {
    return null;
  }
}
function ownerToken() {
  const file = path.join(stateDir, "owner-token");
  return existsSync(file) ? readFileSync(file, "utf8").trim() : null;
}
function dashboardUrl() {
  const token = ownerToken();
  return token ? `${base}/?token=${token}` : base;
}
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function tail(file, lines) {
  if (!existsSync(file)) return "";
  return readFileSync(file, "utf8").trimEnd().split("\n").slice(-lines).join("\n");
}
function cleanEnv() {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(CLAUDE|ANTHROPIC)/i.test(key)) continue;
    env[key] = value;
  }
  return env;
}
async function ensureDaemon() {
  const running = await health();
  if (running) return { ok: true, started: false, pid: running.pid };
  const entry = findDaemonEntry();
  if (!entry) {
    return { ok: false, error: "Could not find the daemon build (packages/daemon/dist/main.js). Run `npm run build` in the Olympus repo." };
  }
  mkdirSync(stateDir, { recursive: true });
  const log = openSync(logFile, "a");
  const child = spawn(process.execPath, [entry], {
    detached: true,
    stdio: ["ignore", log, log],
    cwd: path.dirname(entry),
    env: cleanEnv()
  });
  child.unref();
  closeSync(log);
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    const up = await health();
    if (up) return { ok: true, started: true, pid: up.pid };
  }
  return { ok: false, error: `The daemon did not start. Last lines of ${logFile}:
${tail(logFile, 15)}` };
}
var DaemonError = class extends Error {
};
async function daemonFetch(apiPath, body) {
  const token = ownerToken();
  if (!token) throw new DaemonError("No owner token yet. Start Olympus first (/olympus:start).");
  let res;
  try {
    res = await fetch(`${base}${apiPath}`, {
      method: body === void 0 ? "GET" : "POST",
      headers: {
        "x-olympus-token": token,
        ...body === void 0 ? {} : { "content-type": "application/json" }
      },
      body: body === void 0 ? void 0 : JSON.stringify(body),
      signal: AbortSignal.timeout(1e4)
    });
  } catch {
    throw new DaemonError("The Olympus daemon is not running. Start it with /olympus:start.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new DaemonError(data.error ?? `Daemon request failed (${res.status}).`);
  return data;
}

// packages/cli/src/index.ts
function openBrowser(url) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn2(cmd, args, { detached: true, stdio: "ignore" }).unref();
  } catch {
  }
}
async function summary() {
  const state = await daemonFetch("/api/state").catch(() => null);
  if (!state) return "";
  const team = state.employees.filter((e) => e.status !== "fired").map((e) => `${e.name} (${e.title}): ${e.status}`).join("; ");
  const project = state.project ? `${state.project.title} \xB7 phase ${state.project.phase} \xB7 tasks ${state.tasks.filter((t) => t.status === "done").length}/${state.tasks.length}` : "none yet";
  return [
    `Team: ${team || "nobody"}`,
    `Project: ${project}`,
    `Mode: ${state.settings.mode === "claude-code" ? "Claude Code (agents run in your session: /olympus:brief, /olympus:run)" : "simulated"}`
  ].join("\n");
}
async function start(open) {
  const result = await ensureDaemon();
  if (!result.ok) {
    console.error(result.error);
    return 1;
  }
  console.log(
    result.started ? `Started the Olympus daemon (pid ${result.pid}).` : `The Olympus daemon is already running (pid ${result.pid}).`
  );
  const url = dashboardUrl();
  console.log(`Dashboard: ${url}`);
  console.log(await summary());
  if (open) openBrowser(url);
  return 0;
}
var sleep2 = (ms) => new Promise((r) => setTimeout(r, ms));
async function stop() {
  if (!await health()) {
    console.log("The Olympus daemon is not running.");
    return 0;
  }
  if (ownerToken()) await daemonFetch("/api/shutdown", {}).catch(() => null);
  for (let i = 0; i < 20; i++) {
    await sleep2(250);
    if (!await health()) {
      console.log("Stopped the Olympus daemon.");
      return 0;
    }
  }
  if (existsSync2(pidFile)) {
    const pid = Number(readFileSync2(pidFile, "utf8"));
    if (Number.isInteger(pid) && pid > 0) {
      try {
        process.kill(pid, "SIGTERM");
        console.log(`Sent SIGTERM to the daemon (pid ${pid}).`);
        return 0;
      } catch {
      }
    }
  }
  console.error(`Could not stop the daemon at ${base}. Check \`olympus status\`.`);
  return 1;
}
async function status() {
  const running = await health();
  if (!running) {
    console.log("The Olympus daemon is not running. Start it with /olympus:start (or `olympus start`).");
    return 0;
  }
  console.log(`The Olympus daemon is running (pid ${running.pid}, since ${running.startedAt}).`);
  console.log(`Dashboard: ${dashboardUrl()}`);
  console.log(await summary());
  return 0;
}
async function main() {
  const [command = "status", ...flags] = process.argv.slice(2);
  switch (command) {
    case "start":
      return start(!flags.includes("--no-open"));
    case "stop":
      return stop();
    case "status":
      return status();
    case "open":
      if (!await health()) {
        console.log("The daemon is not running. Run `olympus start`.");
        return 1;
      }
      openBrowser(dashboardUrl());
      console.log(`Opened ${dashboardUrl()}`);
      return 0;
    case "url":
      console.log(dashboardUrl());
      return 0;
    default:
      console.log("Usage: olympus <start [--no-open] | stop | status | open | url>");
      return command === "help" || command === "--help" ? 0 : 1;
  }
}
main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err);
    process.exit(1);
  }
);
