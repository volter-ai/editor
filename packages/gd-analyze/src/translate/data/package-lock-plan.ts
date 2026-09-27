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

function assertStandalonePackageRows(packages: Record<string, Record<string, unknown>>): void {
  for (const [path, row] of Object.entries(packages)) {
    if (path === '') continue;
    const exact =
      typeof row['version'] === 'string' &&
      typeof row['resolved'] === 'string' &&
      typeof row['integrity'] === 'string';
    const standalone = row['link'] !== true && !String(row['resolved'] ?? '').startsWith('file:');
    if (!exact || !standalone) {
      throw new Error(`${path}: frozen package row is not exact, integral, and standalone`);
    }
  }
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
