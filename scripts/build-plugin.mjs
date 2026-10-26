// Makes the plugin self-contained, so it works when Claude Code installs it from GitHub:
//   plugin/dist/olympus.mjs         CLI (/olympus:start, :status, :stop)
//   plugin/dist/olympus-mcp.mjs     the plugin's "company" MCP server
//   plugin/dist/olympus-daemon.mjs  the daemon (API, WebSocket, scheduler)
//   plugin/dist/dashboard/          the built dashboard the daemon serves
// plugin/dist is committed on purpose: an installed plugin is a copy of plugin/ and has no build step.
// Run `npm run build` and commit plugin/dist whenever the source changes.
import { cpSync, existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const entries = [
  ['packages/cli/src/index.ts', 'plugin/dist/olympus.mjs'],
  ['packages/mcp/src/index.ts', 'plugin/dist/olympus-mcp.mjs'],
  ['packages/daemon/src/main.ts', 'plugin/dist/olympus-daemon.mjs'],
];

for (const [from, to] of entries) {
  await build({
    entryPoints: [path.join(root, from)],
    outfile: path.join(root, to),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    legalComments: 'none',
    logLevel: 'warning',
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
    },
  });
  console.log(`plugin: wrote ${to}`);
}

const dashboardFrom = path.join(root, 'packages/dashboard/dist');
const dashboardTo = path.join(root, 'plugin/dist/dashboard');
if (!existsSync(path.join(dashboardFrom, 'index.html'))) {
  console.error('Missing packages/dashboard/dist. Build the dashboard first: npm run build -w @olympus/dashboard');
  process.exit(1);
}
rmSync(dashboardTo, { recursive: true, force: true });
cpSync(dashboardFrom, dashboardTo, { recursive: true });
console.log('plugin: wrote plugin/dist/dashboard/');
