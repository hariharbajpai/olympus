import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Company } from './company.js';
import { loadEnvFile, readConfig } from './config.js';
import { EventBus } from './events.js';
import { HostRuntime } from './runtime/host.js';
import { SimulatedRuntime } from './runtime/simulated.js';
import { buildServer } from './server.js';

function ownerToken(stateDir: string): string {
  const file = path.join(stateDir, 'owner-token');
  if (existsSync(file)) {
    const saved = readFileSync(file, 'utf8').trim();
    if (saved.length >= 32) return saved;
  }
  const token = randomBytes(24).toString('hex');
  writeFileSync(file, token + '\n', { mode: 0o600 });
  chmodSync(file, 0o600);
  return token;
}

async function main(): Promise<void> {
  const envFile = loadEnvFile();
  const config = readConfig();
  mkdirSync(config.stateDir, { recursive: true });

  const bus = new EventBus(path.join(config.stateDir, 'events.jsonl'));
  const company = new Company({
    config,
    bus,
    runtimes: { host: new HostRuntime(config.hostClaimTimeoutMs), simulated: new SimulatedRuntime() },
  });

  const pidFile = path.join(config.stateDir, 'daemon.pid');
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[daemon] ${signal}: stopping agents and closing the server`);
    company.shutdown();
    await app.close().catch(() => {});
    rmSync(pidFile, { force: true });
    process.exit(0);
  };

  const app = await buildServer({
    company,
    bus,
    token: ownerToken(config.stateDir),
    port: config.port,
    allowedOrigins: config.allowedOrigins,
    dashboardDir: config.dashboardDir,
    onShutdownRequest: () => void shutdown('shutdown request'),
  });

  try {
    await app.listen({ host: config.host, port: config.port });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    console.error(
      code === 'EADDRINUSE'
        ? `[daemon] Port ${config.port} is already in use. Is another Olympus daemon running? Try: olympus status`
        : `[daemon] Could not start: ${String(err)}`,
    );
    process.exit(1);
  }

  writeFileSync(pidFile, String(process.pid));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  console.log(`[daemon] Olympus daemon on http://${config.host}:${config.port} (pid ${process.pid})`);
  console.log(`[daemon] workspace: ${config.workspaceDir}${envFile ? ` · env file: ${envFile}` : ''}`);
  console.log('[daemon] agents run inside your Claude Code session (/olympus:brief, /olympus:run)');
}

main().catch((err) => {
  console.error('[daemon] fatal:', err);
  process.exit(1);
});
