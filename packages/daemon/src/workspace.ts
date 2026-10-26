// The folder a project's code lives in. When the Owner runs Olympus inside a project that already
// has code, the team works in that folder instead of a new one, and gets a short overview of the
// codebase (stack, layout, README, the project's own instructions) so it can plan changes to it.
import { existsSync, readdirSync, readFileSync, realpathSync, statSync, type Dirent } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export type FolderCheck = { ok: true; dir: string } | { ok: false; reason: string };

/** One of Olympus's own folders. `withSubfolders` also rules out everything inside it. */
export interface ReservedDir {
  dir: string;
  withSubfolders: boolean;
}

/**
 * Checks that a folder the Owner works in can hold a project: an existing directory that is not
 * the filesystem root, the home folder (or above it), or one of Olympus's own folders. A project
 * folder Olympus made earlier (inside its projects folder) is fine.
 */
export function checkProjectFolder(raw: string, reservedDirs: ReservedDir[]): FolderCheck {
  if (!path.isAbsolute(raw)) return { ok: false, reason: `“${raw}” is not an absolute path.` };
  let dir: string;
  try {
    dir = realpathSync.native(path.resolve(raw));
    if (!statSync(dir).isDirectory()) return { ok: false, reason: `${raw} is not a folder.` };
  } catch {
    return { ok: false, reason: `The folder ${raw} does not exist.` };
  }
  if (path.parse(dir).root === dir) return { ok: false, reason: 'The filesystem root is not a project folder.' };
  const home = real(os.homedir());
  if (dir === home || isInside(home, dir)) {
    return { ok: false, reason: `${dir} is your home folder (or above it), not a project folder.` };
  }
  for (const reserved of reservedDirs) {
    const own = real(reserved.dir);
    if (dir === own || isInside(own, dir) || (reserved.withSubfolders && isInside(dir, own))) {
      return { ok: false, reason: `${dir} is one of Olympus's own folders, not a project folder.` };
    }
  }
  return { ok: true, dir };
}

function real(p: string): string {
  try {
    return realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
}

/** True when `child` is strictly inside `parent`. */
function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

// ───────────────────────────── codebase overview ─────────────────────────────

const MAX_ENTRIES = 4000;
const MAX_DEPTH = 6;
const MAX_OVERVIEW = 8000;
/** Folders that hold dependencies or build output, not the project's own code. Dot-folders are skipped too. */
const SKIP_DIRS = new Set([
  'node_modules', 'bower_components', 'dist', 'build', 'out', 'target', 'coverage', 'vendor',
  '__pycache__', 'venv', 'env', 'Pods', 'DerivedData', 'bin', 'obj',
]);
const IGNORED_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

const LANGUAGES: Record<string, string> = {
  ts: 'TypeScript', tsx: 'TypeScript', mts: 'TypeScript', cts: 'TypeScript',
  js: 'JavaScript', jsx: 'JavaScript', mjs: 'JavaScript', cjs: 'JavaScript',
  py: 'Python', ipynb: 'Jupyter', go: 'Go', rs: 'Rust', java: 'Java', kt: 'Kotlin', kts: 'Kotlin',
  swift: 'Swift', m: 'Objective-C', mm: 'Objective-C', rb: 'Ruby', php: 'PHP', cs: 'C#',
  c: 'C', h: 'C/C++', cc: 'C++', cpp: 'C++', cxx: 'C++', hpp: 'C++', dart: 'Dart', scala: 'Scala',
  ex: 'Elixir', exs: 'Elixir', lua: 'Lua', r: 'R', sql: 'SQL', sh: 'Shell', bash: 'Shell', zsh: 'Shell',
  html: 'HTML', css: 'CSS', scss: 'CSS', sass: 'CSS', less: 'CSS', vue: 'Vue', svelte: 'Svelte',
};

/** Build and dependency files worth showing, in this order. */
const MANIFESTS = [
  'package.json', 'pyproject.toml', 'requirements.txt', 'setup.py', 'Pipfile', 'go.mod', 'Cargo.toml',
  'pom.xml', 'build.gradle', 'build.gradle.kts', 'Gemfile', 'composer.json', 'pubspec.yaml',
  'Package.swift', 'Makefile', 'Dockerfile', 'docker-compose.yml', 'compose.yaml',
];
const INSTRUCTION_FILES = ['CLAUDE.md', 'AGENTS.md', '.claude/CLAUDE.md'];
const README_FILES = ['README.md', 'README', 'readme.md', 'Readme.md', 'README.rst', 'README.txt'];

export interface CodebaseScan {
  /** False for an empty folder (or one with only hidden files): the team then builds from scratch. */
  hasFiles: boolean;
  overview: string;
}

/** A quick, read-only look at a folder: languages, layout, manifests, README and instructions. */
export function scanCodebase(dir: string): CodebaseScan {
  const top = listDir(dir).filter((e) => !e.name.startsWith('.') && !IGNORED_FILES.has(e.name));
  if (top.length === 0) return { hasFiles: false, overview: `Folder: ${dir}\nThe folder is empty.` };

  const languages = new Map<string, number>();
  const filesUnder = new Map<string, number>();
  let scanned = 0;
  let truncated = false;
  const queue: Array<{ abs: string; depth: number; topName: string | null }> = [{ abs: dir, depth: 0, topName: null }];
  while (queue.length > 0) {
    const { abs, depth, topName } = queue.shift()!;
    for (const entry of listDir(abs)) {
      if (scanned >= MAX_ENTRIES) {
        truncated = true;
        break;
      }
      if (entry.name.startsWith('.') || IGNORED_FILES.has(entry.name) || entry.isSymbolicLink()) continue;
      const owner = topName ?? entry.name;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        if (depth + 1 < MAX_DEPTH) queue.push({ abs: path.join(abs, entry.name), depth: depth + 1, topName: owner });
        continue;
      }
      if (!entry.isFile()) continue;
      scanned++;
      if (topName) filesUnder.set(topName, (filesUnder.get(topName) ?? 0) + 1);
      const lang = LANGUAGES[path.extname(entry.name).slice(1).toLowerCase()];
      if (lang) languages.set(lang, (languages.get(lang) ?? 0) + 1);
    }
    if (truncated) break;
  }

  const sections: string[] = [`Folder: ${dir}`, `Git: ${gitInfo(dir)}`];
  sections.push(`Files looked at: ${scanned}${truncated ? ` (stopped at ${MAX_ENTRIES}; the project is bigger)` : ''}`);
  const langs = [...languages.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (langs.length) sections.push(`Main languages: ${langs.map(([l, n]) => `${l} (${n} file${n === 1 ? '' : 's'})`).join(', ')}`);

  const layout = top
    .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
    .slice(0, 40)
    .map((e) => (e.isDirectory() ? `- ${e.name}/ (${filesUnder.get(e.name) ?? 0} files${SKIP_DIRS.has(e.name) ? ', skipped' : ''})` : `- ${e.name}`));
  sections.push(`Top level:\n${layout.join('\n')}${top.length > 40 ? `\n- … and ${top.length - 40} more` : ''}`);

  const manifests = MANIFESTS.filter((name) => existsSync(path.join(dir, name))).map((name) => describeManifest(dir, name));
  if (existsSync(path.join(dir, '.github/workflows'))) manifests.push('- .github/workflows/ (CI is set up)');
  if (manifests.length) sections.push(`Build and dependency files:\n${manifests.join('\n')}`);

  const instructions = INSTRUCTION_FILES.find((name) => existsSync(path.join(dir, name)));
  if (instructions) {
    sections.push(`The project's own instructions (${instructions}; follow them):\n${head(path.join(dir, instructions), 40, 2000)}`);
  }
  const readme = README_FILES.find((name) => existsSync(path.join(dir, name)));
  if (readme) sections.push(`${readme} (start):\n${head(path.join(dir, readme), 50, 2500)}`);

  let overview = sections.join('\n\n');
  if (overview.length > MAX_OVERVIEW) overview = `${overview.slice(0, MAX_OVERVIEW - 1).trimEnd()}…`;
  return { hasFiles: true, overview };
}

function listDir(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function gitInfo(dir: string): string {
  const dotGit = path.join(dir, '.git');
  try {
    if (!existsSync(dotGit)) return 'not a git repository (or a sub-folder of one)';
    if (statSync(dotGit).isFile()) return 'a git worktree';
    const ref = readFileSync(path.join(dotGit, 'HEAD'), 'utf8').trim();
    return ref.startsWith('ref: refs/heads/') ? `repository, branch ${ref.slice('ref: refs/heads/'.length)}` : 'repository (detached HEAD)';
  } catch {
    return 'repository';
  }
}

function head(file: string, lines: number, maxChars: number): string {
  try {
    const text = readFileSync(file, 'utf8').split('\n').slice(0, lines).join('\n').trim();
    return text.length > maxChars ? `${text.slice(0, maxChars - 1).trimEnd()}…` : text;
  } catch {
    return '(could not read)';
  }
}

function describeManifest(dir: string, name: string): string {
  const file = path.join(dir, name);
  if (name === 'package.json') {
    try {
      const pkg = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
      const keys = (v: unknown) => (v && typeof v === 'object' ? Object.keys(v as object) : []);
      const deps = [...keys(pkg.dependencies), ...keys(pkg.devDependencies)];
      const parts = [
        typeof pkg.name === 'string' ? `name "${pkg.name}"` : '',
        typeof pkg.description === 'string' ? `“${pkg.description.slice(0, 120)}”` : '',
        keys(pkg.scripts).length ? `scripts: ${keys(pkg.scripts).slice(0, 15).join(', ')}` : '',
        pkg.workspaces ? `workspaces: ${JSON.stringify(pkg.workspaces).slice(0, 200)}` : '',
        deps.length ? `dependencies: ${deps.slice(0, 25).join(', ')}${deps.length > 25 ? ', …' : ''}` : '',
      ].filter(Boolean);
      return `- package.json: ${parts.join(' · ') || 'present'}`;
    } catch {
      return '- package.json (could not parse)';
    }
  }
  if (name === 'Makefile' || name === 'Dockerfile' || name.includes('compose')) return `- ${name}`;
  const body = head(file, 12, 600)
    .split('\n')
    .map((line) => `    ${line}`)
    .join('\n');
  return `- ${name}:\n${body}`;
}
