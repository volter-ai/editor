interface ProjectPackageJson {
  readonly name?: unknown;
  readonly version?: unknown;
  readonly license?: unknown;
  readonly engines?: unknown;
  readonly scripts?: Readonly<Record<string, unknown>>;
  readonly dependencies?: unknown;
  readonly devDependencies?: unknown;
  readonly optionalDependencies?: unknown;
}

interface PackageLock {
  name?: unknown;
  version?: unknown;
  readonly lockfileVersion?: unknown;
  readonly requires?: unknown;
  readonly packages?: Record<string, Record<string, unknown>>;
}

function jsonRecord(value: unknown, at: string): Record<string, string> {
  if (value === undefined) return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${at}: expected an object`);
  }
  const result: Record<string, string> = {};
  for (const [name, spec] of Object.entries(value)) {
    if (typeof spec !== 'string') throw new Error(`${at}.${name}: expected a string`);
    result[name] = spec;
  }
  return result;
}

function sameEntries(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftEntries = Object.entries(left).sort(([a], [b]) => a.localeCompare(b));
  const rightEntries = Object.entries(right).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries);
}

function assertFrozenDependencySet(
  field: 'dependencies' | 'devDependencies' | 'optionalDependencies',
  pkg: ProjectPackageJson,
  root: Record<string, unknown>,
): void {
  const planned = jsonRecord(pkg[field], `package.json.${field}`);
  const frozen = jsonRecord(root[field], `frozen package-lock.json packages[""].${field}`);
  if (!sameEntries(planned, frozen)) {
    const differences = [...new Set([...Object.keys(planned), ...Object.keys(frozen)])]
      .sort()
      .filter((name) => planned[name] !== frozen[name])
      .map((name) => `${name} (${planned[name] ?? 'absent'} != ${frozen[name] ?? 'absent'})`)
      .join(', ');
    throw new Error(
      `frozen package-lock.json does not match package.json.${field}; ` +
        `regenerate the Godot import lock (${differences})`,
    );
  }
}

function hasInstallScript(scripts: ProjectPackageJson['scripts']): boolean {
  return ['preinstall', 'install', 'postinstall'].some(
    (name) => typeof scripts?.[name] === 'string',
  );
}

/**
 * A git row pinned to a full commit: exact because the commit names its content. npm fetches a
 * hosted one as the host's https tarball of that commit, with no git credentials. `colyseus`
 * (under `@volter/game-editor`) has one required peer published only this way,
 * `uWebSockets.js`, and the monorepo's own lock resolves it the same way.
 */
const COMMIT_PINNED_GIT =
  /^git\+(?:ssh:\/\/git@|https:\/\/)(?:github\.com|gitlab\.com|bitbucket\.org)\/[\w.-]+\/[\w.-]+#[0-9a-f]{40}$/u;

function assertStandalonePackageRows(packages: Record<string, Record<string, unknown>>): void {
  for (const [path, row] of Object.entries(packages)) {
    if (path === '') continue;
    const resolved = row['resolved'];
    const exact =
      typeof row['version'] === 'string' &&
      typeof resolved === 'string' &&
      (typeof row['integrity'] === 'string' || COMMIT_PINNED_GIT.test(resolved));
    const standalone = row['link'] !== true && !String(row['resolved'] ?? '').startsWith('file:');
    if (!exact || !standalone) {
      throw new Error(`${path}: frozen package row is not exact, integral, and standalone`);
    }
  }
}

/** The row a package name resolves to from a row, as Node looks up `node_modules` from it outward. */
function resolveRow(packages: Readonly<Record<string, unknown>>, from: string, name: string): string | undefined {
  for (let base = from; ; ) {
    const candidate = base === '' ? `node_modules/${name}` : `${base}/node_modules/${name}`;
    if (packages[candidate] !== undefined) return candidate;
    if (base === '') return undefined;
    const nested = base.lastIndexOf('/node_modules/');
    base = nested < 0 ? '' : base.slice(0, nested);
  }
}

/**
 * The manifest and lock without the root dependencies `drop` names: the root declarations removed
 * and every lock row no longer reached from the root (by `dependencies`, `optionalDependencies`
 * and `peerDependencies`, the root's `devDependencies` too) removed with them.
 */
export function prunePackageDocuments<Manifest extends { dependencies?: Record<string, string> }, Lock extends { readonly packages?: Record<string, Record<string, unknown>> }>(
  manifest: Manifest,
  lock: Lock,
  drop: ReadonlySet<string>,
): { readonly manifest: Manifest; readonly lock: Lock } {
  const packages = { ...(lock.packages ?? {}) };
  const root = { ...(packages[''] ?? {}) };
  const without = (record: unknown): Record<string, string> =>
    Object.fromEntries(Object.entries(jsonRecord(record, 'dependencies')).filter(([name]) => !drop.has(name)));
  root['dependencies'] = without(root['dependencies']);
  packages[''] = root;
  const reached = new Set<string>(['']);
  const queue = [''];
  while (queue.length > 0) {
    const at = queue.pop() as string;
    const row = packages[at] ?? {};
    const names = ['dependencies', 'optionalDependencies', 'peerDependencies', ...(at === '' ? ['devDependencies'] : [])].flatMap((field) => Object.keys(jsonRecord(row[field], field)));
    for (const name of names) {
      const target = resolveRow(packages, at, name);
      if (target !== undefined && !reached.has(target)) {
        reached.add(target);
        queue.push(target);
      }
    }
  }
  for (const path of Object.keys(packages)) if (!reached.has(path)) delete packages[path];
  return {
    manifest: { ...manifest, dependencies: without(manifest.dependencies) },
    lock: { ...lock, packages },
  };
}

/**
 * Adapt the frozen standalone dependency graph only where project identity is allowed to vary.
 * Package selection has already happened in the toolchain snapshot; this function never resolves,
 * fetches, ranges, or synthesizes a package row.
 */
export function planFrozenPackageLock(
  packageJsonText: string,
  frozenLockBytes: Uint8Array,
): string {
  const pkg = JSON.parse(packageJsonText) as ProjectPackageJson;
  if (typeof pkg.name !== 'string' || typeof pkg.version !== 'string') {
    throw new Error('package.json: name and version must be strings before lock planning');
  }
  const lock = JSON.parse(Buffer.from(frozenLockBytes).toString('utf8')) as PackageLock;
  if (lock.lockfileVersion !== 3 || lock.requires !== true || lock.packages === undefined) {
    throw new Error('frozen Godot import package-lock.json is not a complete npm v3 lock');
  }
  const root = lock.packages[''];
  if (root === undefined) {
    throw new Error('frozen Godot import package-lock.json has no root package row');
  }
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) {
    assertFrozenDependencySet(field, pkg, root);
  }
  assertStandalonePackageRows(lock.packages);

  lock.name = pkg.name;
  lock.version = pkg.version;
  root['name'] = pkg.name;
  root['version'] = pkg.version;
  root['hasInstallScript'] = hasInstallScript(pkg.scripts);
  if (pkg.license === undefined) delete root['license'];
  else root['license'] = pkg.license;
  if (pkg.engines === undefined) delete root['engines'];
  else root['engines'] = pkg.engines;
  return `${JSON.stringify(lock, null, 2)}\n`;
}
