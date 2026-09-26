export type GodotNavigationServerFactory<TServer> = () => TServer;

interface GodotNavigationServerRegistration<TServer> {
  name: string;
  factory: GodotNavigationServerFactory<TServer>;
  priority: number;
  order: number;
}

export class GodotNavigationServerManager<TServer> {
  private readonly registrations = new Map<string, GodotNavigationServerRegistration<TServer>>();
  private nextOrder = 0;
  private activeName = '';
  private activeServer: TServer | null = null;

  register_server(name: string, createCallback: GodotNavigationServerFactory<TServer>): void {
    if (name === '') throw new TypeError('NavigationServerManager server name cannot be empty.');
    if (typeof createCallback !== 'function') throw new TypeError('NavigationServerManager create_callback must be callable.');
    const current = this.registrations.get(name);
    this.registrations.set(name, {
      name,
      factory: createCallback,
      priority: current?.priority ?? 0,
      order: current?.order ?? this.nextOrder++,
    });
    if (this.activeName === name) this.activeServer = null;
  }

  set_default_server(name: string, priority: number): void {
    if (!Number.isSafeInteger(priority)) throw new TypeError('NavigationServerManager priority must be an integer.');
    const registration = this.registrations.get(name);
    if (registration === undefined) throw new Error(`NavigationServerManager has no server named ${name}.`);
    registration.priority = priority;
    const selected = this.selectDefault();
    if (selected?.name !== this.activeName) {
      this.activeName = selected?.name ?? '';
      this.activeServer = null;
    }
  }

  unregister_server(name: string): void {
    if (!this.registrations.delete(name)) return;
    if (this.activeName !== name) return;
    this.activeName = '';
    this.activeServer = null;
  }

  has_server(name: string): boolean { return this.registrations.has(name); }
  get_server_names(): readonly string[] { return [...this.registrations.keys()].sort(); }
  get_default_server_name(): string { return this.selectDefault()?.name ?? ''; }

  get_default_server(): TServer | null {
    const registration = this.selectDefault();
    if (registration === undefined) return null;
    if (this.activeName !== registration.name) {
      this.activeName = registration.name;
      this.activeServer = null;
    }
    if (this.activeServer === null) this.activeServer = registration.factory();
    return this.activeServer;
  }

  create_server(name: string): TServer | null {
    return this.registrations.get(name)?.factory() ?? null;
  }

  clear(): void {
    this.registrations.clear();
    this.activeName = '';
    this.activeServer = null;
  }

  private selectDefault(): GodotNavigationServerRegistration<TServer> | undefined {
    let selected: GodotNavigationServerRegistration<TServer> | undefined;
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

export class GodotNavigationServer2DManager<TServer = unknown> extends GodotNavigationServerManager<TServer> {}
export class GodotNavigationServer3DManager<TServer = unknown> extends GodotNavigationServerManager<TServer> {}

export const GodotNavigationServer2DManagerSingleton = new GodotNavigationServer2DManager();
export const GodotNavigationServer3DManagerSingleton = new GodotNavigationServer3DManager();

export function createGodotNavigationServer2DManager<TServer = unknown>(): GodotNavigationServer2DManager<TServer> {
  return new GodotNavigationServer2DManager<TServer>();
}

export function createGodotNavigationServer3DManager<TServer = unknown>(): GodotNavigationServer3DManager<TServer> {
  return new GodotNavigationServer3DManager<TServer>();
}
