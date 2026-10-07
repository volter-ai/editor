/**
 * WHICH OF A PROJECT'S FILES A LIMITED VIEW PUBLISHES — only what the project would commit, and
 * never a secret.
 *
 * A limited view is made to be shared, so the default is to publish less. A file is published
 * when every rule lets it through, in this order:
 *
 *  1. SECRETS, always and regardless of anything else: `.env*`, `.envrc`, `*.local`, `.npmrc`,
 *     `.yarnrc.yml`, `.pypirc`, `.netrc`, `.git-credentials`, `.dockercfg`, `credentials*.json`,
 *     `service-account*.json`, `secrets.*`, `*.tfvars`, `.htpasswd`, `kubeconfig`, `*.db`, `*.sqlite`,
 *     `*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.keystore`, `*.jks`, SSH keys (`id_rsa`, `*.ppk`, …).
 *  2. WHAT THE PROJECT IS NOT: dependencies (`node_modules`), build output (`dist*`), `logs`, the
 *     project's `server/`, VCS and tool folders (any dot-folder but `.volter` and `.storybook`).
 *  3. WHAT A SESSION KEEPS FOR ITSELF: of `.volter/`, only the project's own settings and themes.
 *     Its editor state and workbench storage are a person's workspace (open documents, search
 *     history, `vscode-remote://…/<their home>/…` URIs), so a view opens on the default layout.
 *  4. `.gitignore`: what git would ignore. In a git work tree git itself answers
 *     (`git ls-files --cached --others --exclude-standard`); elsewhere every `.gitignore` from the
 *     project root down is read with git's rules (last match wins, `!` re-includes, a trailing `/`
 *     is a folder, a pattern with a `/` is anchored to its file's folder).
 *
 * What was left out is reported by rule, as counts, never as names or contents.
 */

import { spawnSync } from 'node:child_process';
import { type Dirent, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { LimitedViewProjectFile } from '../../view/page/view-contract';

/** Rule 1: by base name. */
const SECRET_FILES: readonly [string, RegExp][] = [
  ['.env files (.env*, .envrc)', /^\.env(?:rc|\..*)?$/i],
  ['*.local files', /\.local$/i],
  ['package-manager credentials (.npmrc, .yarnrc.yml, .pypirc)', /^(?:\.npmrc|\.yarnrc\.yml|\.pypirc)$/i],
  ['machine credentials (.netrc, .git-credentials, .dockercfg)', /^(?:\.netrc|_netrc|\.git-credentials|\.dockercfg)$/i],
  ['credentials*.json', /^credentials.*\.json$/i],
  ['keys and certificates (*.pem, *.key, *.p12, *.pfx, *.keystore, *.jks)', /\.(?:pem|key|p12|pfx|keystore|jks)$/i],
  ['SSH keys (id_*, *.ppk)', /^id_[a-z0-9]+(?:\.pub)?$|\.ppk$/i],
  ['secrets.* and service-account*.json', /^secrets\.|^service-account.*\.json$/i],
  ['Terraform variables (*.tfvars)', /\.tfvars(?:\.json)?$/i],
  ['server passwords (.htpasswd)', /^\.htpasswd$/i],
  ['kubeconfig', /^(?:kubeconfig|.*\.kubeconfig)$/i],
  ['databases (*.db, *.sqlite)', /\.(?:db|sqlite3?)$/i],
];
/** Rule 2: folders that are not the project, at the root. `node_modules` is skipped at any depth. */
const ROOT_SKIPPED = new Set(['dist', 'dist-ssr', 'dist-wip', 'logs', 'server']);
/** Rule 3: what of `.volter/` is the project's own. */
const VOLTER_KEPT = /^\.volter\/(?:settings\.json|themes\/[^/]+\.json)$/;

export interface ProjectFileSelection {
  readonly files: LimitedViewProjectFile[];
  /** Rule → how many files (or whole folders, where a folder was skipped) it left out. */
  readonly excluded: ReadonlyMap<string, number>;
}

/** One `.gitignore` rule, compiled. */
interface IgnoreRule {
  readonly negated: boolean;
  readonly folderOnly: boolean;
  /** Tested against the path relative to the rule's own folder. */
  readonly test: (relative: string) => boolean;
}

/** git's glob: `**` any depth, `*` and `?` within one segment, `[…]` a class. */
function globToRegExp(glob: string): RegExp {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]!;
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        const slashAfter = glob[i + 2] === '/';
        out += slashAfter ? '(?:.*/)?' : '.*';
        i += slashAfter ? 2 : 1;
      } else out += '[^/]*';
    } else if (ch === '?') out += '[^/]';
    else if (ch === '[') {
      const close = glob.indexOf(']', i + 1);
      if (close === -1) out += '\\[';
      else {
        out += `[${glob.slice(i + 1, close).replace(/^!/, '^').replace(/\\/g, '\\\\')}]`;
        i = close;
      }
    } else if (ch === '\\' && i + 1 < glob.length) out += `\\${glob[++i]}`;
    else out += /[.+^${}()|]/.test(ch) ? `\\${ch}` : ch;
  }
  return new RegExp(`^${out}$`);
}

function parseGitignore(text: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.replace(/(?<!\\)\s+$/, '');
    if (line === '' || line.startsWith('#')) continue;
    const negated = line.startsWith('!');
    if (negated) line = line.slice(1);
    const folderOnly = line.endsWith('/');
    if (folderOnly) line = line.replace(/\/+$/, '');
    const anchored = line.includes('/');
    line = line.replace(/^\//, '');
    if (line === '') continue;
    const pattern = globToRegExp(anchored ? line : `**/${line}`);
    // A matched folder ignores what is under it; the walk never descends into one.
    rules.push({ negated, folderOnly, test: (relative) => pattern.test(relative) });
  }
  return rules;
}

/** The files git would commit from `root` (tracked, or untracked and not ignored), or `null`
 *  when `root` is not in a git work tree or git is not available. */
function gitCommittable(root: string): Set<string> | null {
  const inside = spawnSync('git', ['-C', root, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8', windowsHide: true });
  if (inside.status !== 0 || inside.stdout.trim() !== 'true') return null;
  const listed = spawnSync('git', ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '.'], {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 256 * 1024 * 1024,
  });
  if (listed.status !== 0) return null;
  return new Set(listed.stdout.split('\0').filter((path) => path !== ''));
}

export function selectProjectFiles(root: string): ProjectFileSelection {
  const files: LimitedViewProjectFile[] = [];
  const excluded = new Map<string, number>();
  const leaveOut = (rule: string) => excluded.set(rule, (excluded.get(rule) ?? 0) + 1);
  const committable = gitCommittable(root);

  /** `.gitignore` rules in effect, outermost folder first, each with the folder it is relative to. */
  const ignoredByFiles = (path: string, isFolder: boolean, scopes: readonly { base: string; rules: IgnoreRule[] }[]): boolean => {
    let ignored = false;
    for (const { base, rules } of scopes) {
      if (base !== '' && !path.startsWith(`${base}/`)) continue;
      const relative = base === '' ? path : path.slice(base.length + 1);
      for (const rule of rules) {
        if (rule.folderOnly && !isFolder) continue;
        if (rule.test(relative)) ignored = !rule.negated;
      }
    }
    return ignored;
  };

  const walk = (dir: string, rel: string, scopes: { base: string; rules: IgnoreRule[] }[]): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    let here = scopes;
    if (committable === null && entries.some((entry) => entry.isFile() && entry.name === '.gitignore')) {
      try {
        here = [...scopes, { base: rel, rules: parseGitignore(readFileSync(join(dir, '.gitignore'), 'utf8')) }];
      } catch {
        /* unreadable: no rules from it */
      }
    }
    for (const entry of entries) {
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || (rel === '' && ROOT_SKIPPED.has(entry.name))) {
          leaveOut('dependency, build and log folders');
          continue;
        }
        if (entry.name.startsWith('.') && !(rel === '' && (entry.name === '.volter' || entry.name === '.storybook'))) {
          leaveOut('VCS and tool folders (dot-folders)');
          continue;
        }
        if (committable === null && ignoredByFiles(path, true, here)) {
          leaveOut('ignored by .gitignore (folders)');
          continue;
        }
        walk(join(dir, entry.name), path, here);
        continue;
      }
      if (!entry.isFile()) continue;
      const secret = SECRET_FILES.find(([, pattern]) => pattern.test(entry.name));
      if (secret) {
        leaveOut(`secrets: ${secret[0]}`);
        continue;
      }
      if (path.startsWith('.volter/') && !VOLTER_KEPT.test(path)) {
        leaveOut('session-owned .volter files (editor state, workbench storage, …)');
        continue;
      }
      if (committable !== null ? !committable.has(path) : ignoredByFiles(path, false, here)) {
        leaveOut('ignored by .gitignore');
        continue;
      }
      const info = statSync(join(dir, entry.name));
      files.push({ path, size: info.size, mtime: Math.floor(info.mtimeMs) });
    }
  };
  walk(root, '', []);
  return { files, excluded };
}
