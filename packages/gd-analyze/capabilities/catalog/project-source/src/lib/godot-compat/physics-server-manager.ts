import { registerGodotObjectIdentity } from './object';

export type GodotPhysicsServerFactory<TServer> = () => TServer;

export interface GodotPhysicsServerRegistrationSnapshot {
  readonly name: string;
  readonly priority: number;
  readonly isDefault: boolean;
}

interface GodotPhysicsServerRegistration<TServer> {
  readonly name: string;
  factory: GodotPhysicsServerFactory<TServer>;
  priority: number;
  readonly order: number;
}

class GodotPhysicsServerManagerBase<TServer> {
  private readonly registrations = new Map<string, GodotPhysicsServerRegistration<TServer>>();
  private nextOrder = 0;
  private selectedName = '';
  private selectedServer: TServer | null = null;

  constructor(godotClass: string) {
    registerGodotObjectIdentity(this, godotClass);
  }

  register_server(name: string, createCallback: GodotPhysicsServerFactory<TServer>): void {
    const normalized = this.requireName(name);
    if (typeof createCallback !== 'function') throw new TypeError('PhysicsServerManager create_callback must be callable.');
    const previous = this.registrations.get(normalized);
    this.registrations.set(normalized, {
      name: normalized,
      factory: createCallback,
      priority: previous?.priority ?? 0,
      order: previous?.order ?? this.nextOrder++,
    });
    if (this.selectedName === normalized) this.selectedServer = null;
    this.refreshSelection();
  }

  unregister_server(name: string): void {
    const normalized = this.requireName(name);
    if (!this.registrations.delete(normalized)) return;
    if (this.selectedName === normalized) {
      this.selectedName = '';
      this.selectedServer = null;
    }
    this.refreshSelection();
  }

  set_default_server(name: string, priority: number): void {
    const normalized = this.requireName(name);
    if (!Number.isSafeInteger(priority)) throw new TypeError('PhysicsServerManager priority must be an integer.');
    const registration = this.registrations.get(normalized);
    if (registration === undefined) throw new Error(`PhysicsServerManager has no server named ${normalized}.`);
    registration.priority = priority;
    this.refreshSelection();
  }

  has_server(name: string): boolean {
    return this.registrations.has(this.requireName(name));
  }

  get_servers_count(): number { return this.registrations.size; }

  get_server_name(index: number): string {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.registrations.size) {
      throw new RangeError('PhysicsServerManager server index is out of bounds.');
    }
    return [...this.registrations.values()].sort((a, b) => a.order - b.order)[index]!.name;
  }

  get_server_names(): readonly string[] {
    return [...this.registrations.values()].sort((a, b) => a.order - b.order).map((entry) => entry.name);
  }

  get_default_server_name(): string {
    return this.selectDefault()?.name ?? '';
  }

  get_default_server_priority(): number {
    return this.selectDefault()?.priority ?? 0;
  }

  create_server(name: string): TServer | null {
    return this.registrations.get(this.requireName(name))?.factory() ?? null;
  }

  create_default_server(): TServer | null {
    const registration = this.selectDefault();
    return registration?.factory() ?? null;
  }

  get_default_server(): TServer | null {
    const registration = this.selectDefault();
    if (registration === undefined) return null;
    if (registration.name !== this.selectedName) {
      this.selectedName = registration.name;
      this.selectedServer = null;
    }
    if (this.selectedServer === null) this.selectedServer = registration.factory();
    return this.selectedServer;
  }

  invalidate_default_server(): void {
    this.selectedServer = null;
  }

  get_registrations(): readonly GodotPhysicsServerRegistrationSnapshot[] {
    const defaultName = this.get_default_server_name();
    return [...this.registrations.values()]
      .sort((a, b) => a.order - b.order)
      .map(({ name, priority }) => ({ name, priority, isDefault: name === defaultName }));
  }

  clear(): void {
    this.registrations.clear();
    this.selectedName = '';
    this.selectedServer = null;
    this.nextOrder = 0;
  }

  private requireName(name: string): string {
    if (typeof name !== 'string') throw new TypeError('PhysicsServerManager server name must be StringName.');
    const normalized = name.trim();
    if (normalized.length === 0) throw new RangeError('PhysicsServerManager server name cannot be empty.');
    return normalized;
  }

  private refreshSelection(): void {
    const nextName = this.selectDefault()?.name ?? '';
    if (nextName === this.selectedName) return;
    this.selectedName = nextName;
    this.selectedServer = null;
  }

  private selectDefault(): GodotPhysicsServerRegistration<TServer> | undefined {
    let selected: GodotPhysicsServerRegistration<TServer> | undefined;
    for (const registration of this.registrations.values()) {
      if (
        selected === undefined ||
        registration.priority > selected.priority ||
        (registration.priority === selected.priority && registration.order < selected.order)
      ) selected = registration;
    }
    return selected;
  }
}

export class GodotPhysicsServer2DManager<TServer = unknown> extends GodotPhysicsServerManagerBase<TServer> {
  constructor() { super('PhysicsServer2DManager'); }
}

export class GodotPhysicsServer3DManager<TServer = unknown> extends GodotPhysicsServerManagerBase<TServer> {
  constructor() { super('PhysicsServer3DManager'); }
}

export const GodotPhysicsServer2DManagerSingleton = new GodotPhysicsServer2DManager();
export const GodotPhysicsServer3DManagerSingleton = new GodotPhysicsServer3DManager();

export function createGodotPhysicsServer2DManager<TServer = unknown>(): GodotPhysicsServer2DManager<TServer> {
  return new GodotPhysicsServer2DManager<TServer>();
}

export function createGodotPhysicsServer3DManager<TServer = unknown>(): GodotPhysicsServer3DManager<TServer> {
  return new GodotPhysicsServer3DManager<TServer>();
}
