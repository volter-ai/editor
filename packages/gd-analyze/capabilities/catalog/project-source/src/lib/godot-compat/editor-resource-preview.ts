export interface GodotEditorResourcePreviewCarrier {
  invoke(method: string, args: readonly unknown[]): unknown;
}

export interface GodotResourcePreviewRequest {
  path?: string;
  resource?: unknown;
  receiver: unknown;
  receiverFunc: string;
  userdata: unknown;
}

export class GodotEditorResourcePreviewGenerator {
  constructor(private readonly carrier: GodotEditorResourcePreviewCarrier) {}

  _handles(type: string): unknown {
    return this.carrier.invoke('_handles', [type]);
  }

  _generate(resource: unknown, size: { x: number; y: number }, metadata: Readonly<Record<string, unknown>>): unknown {
    return this.carrier.invoke('_generate', [resource, size, metadata]);
  }

  _generate_from_path(path: string, size: { x: number; y: number }, metadata: Readonly<Record<string, unknown>>): unknown {
    return this.carrier.invoke('_generate_from_path', [path, size, metadata]);
  }

  _generate_small_preview_automatically(): unknown {
    return this.carrier.invoke('_generate_small_preview_automatically', []);
  }

  _can_generate_small_preview(): unknown {
    return this.carrier.invoke('_can_generate_small_preview', []);
  }

  request_draw_and_wait(viewport: unknown): unknown {
    return this.carrier.invoke('request_draw_and_wait', [viewport]);
  }
}

export class GodotEditorResourcePreview {
  private readonly generators: GodotEditorResourcePreviewGenerator[] = [];
  private readonly requests: GodotResourcePreviewRequest[] = [];
  private readonly invalidatedPaths = new Set<string>();
  private readonly listeners = new Set<(path: string) => void>();

  queue_resource_preview(path: string, receiver: unknown, receiverFunc: string, userdata: unknown): void {
    this.requests.push({ path, receiver, receiverFunc, userdata });
  }

  queue_edited_resource_preview(resource: unknown, receiver: unknown, receiverFunc: string, userdata: unknown): void {
    this.requests.push({ resource, receiver, receiverFunc, userdata });
  }

  add_preview_generator(generator: GodotEditorResourcePreviewGenerator): void {
    if (!this.generators.includes(generator)) this.generators.push(generator);
  }

  remove_preview_generator(generator: GodotEditorResourcePreviewGenerator): void {
    const index = this.generators.indexOf(generator);
    if (index >= 0) this.generators.splice(index, 1);
  }

  check_for_invalidation(path: string): void {
    this.invalidatedPaths.add(path);
    this.preview_invalidated(path);
  }

  preview_invalidated(path: string): void {
    for (const listener of [...this.listeners]) listener(path);
  }

  connect_preview_invalidated(listener: (path: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  is_invalidated(path: string): boolean { return this.invalidatedPaths.has(path); }
  clear_invalidation(path: string): void { this.invalidatedPaths.delete(path); }
  get_generators(): readonly GodotEditorResourcePreviewGenerator[] { return this.generators; }
  get_pending_requests(): readonly GodotResourcePreviewRequest[] { return this.requests; }

  pop_pending_request(): GodotResourcePreviewRequest | null {
    return this.requests.shift() ?? null;
  }
}

export class GodotEditorResourceTooltipPlugin {
  private readonly thumbnailRequests: Array<{ path: string; control: unknown }> = [];

  constructor(private readonly carrier: GodotEditorResourcePreviewCarrier) {}

  _handles(type: string): unknown {
    return this.carrier.invoke('_handles', [type]);
  }

  _make_tooltip_for_path(path: string, metadata: Readonly<Record<string, unknown>>, base: unknown): unknown {
    return this.carrier.invoke('_make_tooltip_for_path', [path, metadata, base]);
  }

  request_thumbnail(path: string, control: unknown): void {
    this.thumbnailRequests.push({ path, control });
  }

  get_thumbnail_requests(): readonly Readonly<{ path: string; control: unknown }>[] {
    return this.thumbnailRequests;
  }
}

export function createGodotEditorResourcePreview(): GodotEditorResourcePreview {
  return new GodotEditorResourcePreview();
}

export function createGodotEditorResourcePreviewGenerator(
  carrier: GodotEditorResourcePreviewCarrier,
): GodotEditorResourcePreviewGenerator {
  return new GodotEditorResourcePreviewGenerator(carrier);
}
