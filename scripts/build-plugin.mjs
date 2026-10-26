// Bundles the CLI and the MCP server into single files inside the plugin:
//   plugin/dist/olympus.mjs      (olympus CLI, used by /olympus:start, :status, :stop)
//   plugin/dist/olympus-mcp.mjs  (the plugin's "company" MCP server)
// The daemon stays in packages/daemon/dist; the bundles find it by walking up from the plugin.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const entries = [
  ['packages/cli/src/index.ts', 'plugin/dist/olympus.mjs'],
  ['packages/mcp/src/index.ts', 'plugin/dist/olympus-mcp.mjs'],
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

// Lets the bundles find the daemon even if Claude Code copies the plugin out of this repo.
writeFileSync(
  path.join(root, 'plugin/dist/daemon-entry.json'),
  JSON.stringify({ entry: path.join(root, 'packages/daemon/dist/main.js') }, null, 2) + '\n',
);
console.log('plugin: wrote plugin/dist/daemon-entry.json');
