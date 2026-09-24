import type { ResourceDescriptor, ResourceKey, ResourceKind } from '@volter/editor-sdk/kit/history-types';

export type ResourceIdFactory = () => string;

function defaultIdFactory(): string {
  return crypto.randomUUID();
}

function resourceKey(id: string): ResourceKey {
  return `resource:${id}` as ResourceKey;
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** Normalize a StorageBackend path without importing Node path APIs into the browser. */
export function normalizeProjectPath(input: string): string {
  if (input.includes('\0')) throw new Error('Resource path cannot contain a NUL byte.');
  const slashed = input.replaceAll('\\', '/');
  if (slashed.startsWith('/') || /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(slashed)) {
    throw new Error(`Resource path must be project-relative: "${input}".`);
  }

  const output: string[] = [];
  for (const segment of slashed.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      if (output.length === 0) {
        throw new Error(`Resource path escapes the project root: "${input}".`);
      }
      output.pop();
      continue;
    }
    output.push(segment);
  }
  if (output.length === 0) throw new Error('Resource path cannot be empty.');
  return output.join('/');
}

function sessionSegment(input: string, label: string): string {
  const value = input.trim();
  if (
    !value ||
    value === '.' ||
    value === '..' ||
    value.includes('/') ||
    value.includes('\\') ||
    value.includes('\0')
  ) {
    throw new Error(`${label} must be one non-empty path segment.`);
  }
  return value;
}

/** Project-session registry: stable keys are independent from mutable file locations. */
export class ResourceRegistry {
  private readonly descriptors = new Map<ResourceKey, ResourceDescriptor>();
  private readonly keyByLocation = new Map<string, ResourceKey>();
  private readonly inactive = new Set<ResourceKey>();

  constructor(private readonly makeId: ResourceIdFactory = defaultIdFactory) {}

  registerProject(kind: ResourceKind, path: string, displayName?: string): ResourceDescriptor {
    const normalized = normalizeProjectPath(path);
    const location = `project://${normalized}`;
    const existing = this.existingAt(location, kind);
    if (existing) return existing;
    return this.add({
      key: resourceKey(this.makeId()),
      kind,
      scope: 'project',
      displayName: displayName ?? basename(normalized),
      location,
      sessionId: null,
    });
  }

  registerDraft(kind: ResourceKind, displayName: string): ResourceDescriptor {
    const id = this.makeId();
    return this.add({
      key: resourceKey(id),
      kind,
      scope: 'project',
      displayName,
      location: `draft://${id}`,
      sessionId: null,
    });
  }

  registerSession(
    kind: ResourceKind,
    sessionId: string,
    resourceId: string,
    displayName?: string,
  ): ResourceDescriptor {
    const normalizedSession = sessionSegment(sessionId, 'Session id');
    const normalizedResource = normalizeProjectPath(resourceId);
    const location = `session://${normalizedSession}/${normalizedResource}`;
    const existing = this.existingAt(location, kind);
    if (existing) return existing;
    return this.add({
      key: resourceKey(this.makeId()),
      kind,
      scope: 'session',
      displayName: displayName ?? basename(normalizedResource),
      location,
      sessionId: normalizedSession,
    });
  }

  /** Promote a draft or move a project file without changing history identity. */
  setProjectLocation(key: ResourceKey, path: string, displayName?: string): ResourceDescriptor {
    const current = this.requireActive(key);
    if (current.scope !== 'project')
      throw new Error('A session resource cannot become a project file.');
    const normalized = normalizeProjectPath(path);
    const location = `project://${normalized}`;
    const collision = this.keyByLocation.get(location);
    if (collision && collision !== key) {
      throw new Error(`Another resource is already registered at "${location}".`);
    }
    if (current.location) this.keyByLocation.delete(current.location);
    const next: ResourceDescriptor = {
      ...current,
      displayName: displayName ?? basename(normalized),
      location,
    };
    this.descriptors.set(key, next);
    this.keyByLocation.set(location, key);
    return next;
  }

  get(key: ResourceKey): ResourceDescriptor | null {
    return this.descriptors.get(key) ?? null;
  }

  getByLocation(location: string): ResourceDescriptor | null {
    const key = this.keyByLocation.get(location);
    return key ? (this.descriptors.get(key) ?? null) : null;
  }

  isActive(key: ResourceKey): boolean {
    return this.descriptors.has(key) && !this.inactive.has(key);
  }

  /** Keep descriptors for history display, but make their drivers unavailable. */
  expireSession(sessionId: string): ResourceKey[] {
    const expired: ResourceKey[] = [];
    for (const descriptor of this.descriptors.values()) {
      if (descriptor.sessionId !== sessionId || this.inactive.has(descriptor.key)) continue;
      this.inactive.add(descriptor.key);
      expired.push(descriptor.key);
    }
    return expired;
  }

  expireResources(resources: Iterable<ResourceKey>): ResourceKey[] {
    const expired: ResourceKey[] = [];
    for (const key of resources) {
      const descriptor = this.descriptors.get(key);
      if (!descriptor || this.inactive.has(key)) continue;
      this.inactive.add(key);
      if (descriptor.location && this.keyByLocation.get(descriptor.location) === key) {
        this.keyByLocation.delete(descriptor.location);
      }
      expired.push(key);
    }
    return expired;
  }

  clear(): void {
    this.descriptors.clear();
    this.keyByLocation.clear();
    this.inactive.clear();
  }

  private add(descriptor: ResourceDescriptor): ResourceDescriptor {
    if (this.descriptors.has(descriptor.key)) {
      throw new Error(`Duplicate resource key "${descriptor.key}".`);
    }
    if (descriptor.location && this.keyByLocation.has(descriptor.location)) {
      throw new Error(`Duplicate resource location "${descriptor.location}".`);
    }
    this.descriptors.set(descriptor.key, descriptor);
    if (descriptor.location) this.keyByLocation.set(descriptor.location, descriptor.key);
    return descriptor;
  }

  private existingAt(location: string, kind: ResourceKind): ResourceDescriptor | null {
    const key = this.keyByLocation.get(location);
    if (!key) return null;
    const descriptor = this.descriptors.get(key)!;
    if (descriptor.kind !== kind) {
      throw new Error(
        `Resource "${location}" is already registered as ${descriptor.kind}, not ${kind}.`,
      );
    }
    if (this.inactive.has(key)) throw new Error(`Resource "${location}" has expired.`);
    return descriptor;
  }

  private requireActive(key: ResourceKey): ResourceDescriptor {
    const descriptor = this.descriptors.get(key);
    if (!descriptor) throw new Error(`Unknown resource key "${key}".`);
    if (this.inactive.has(key)) throw new Error(`Resource "${key}" has expired.`);
    return descriptor;
  }
}
