export type GodotRenderSortRid = string | number;

export type GodotRenderSortPass = 'depth' | 'opaque' | 'alpha' | 'shadow' | 'motion' | 'overlay';

export interface GodotRenderSortItem<TPayload = unknown> {
  readonly id: GodotRenderSortRid;
  readonly pass: GodotRenderSortPass;
  readonly pipeline: GodotRenderSortRid | null;
  readonly material: GodotRenderSortRid | null;
  readonly geometry: GodotRenderSortRid | null;
  readonly priority?: number;
  readonly depth?: number;
  readonly layer?: number;
  readonly transparent?: boolean;
  readonly order?: number;
  readonly payload: TPayload;
}

export interface GodotRenderSortKey {
  readonly high: number;
  readonly low: number;
  readonly pass: number;
  readonly layer: number;
  readonly priority: number;
  readonly pipeline: number;
  readonly material: number;
  readonly depth: number;
  readonly order: number;
  readonly transparent: boolean;
}

export interface GodotSortedRenderItem<TPayload = unknown> {
  readonly source: GodotRenderSortItem<TPayload>;
  readonly key: GodotRenderSortKey;
  readonly originalIndex: number;
  readonly sortedIndex: number;
}

export interface GodotRenderSortBatch<TPayload = unknown> {
  readonly key: string;
  readonly pass: GodotRenderSortPass;
  readonly pipeline: GodotRenderSortRid | null;
  readonly material: GodotRenderSortRid | null;
  readonly geometry: GodotRenderSortRid | null;
  readonly first: number;
  readonly count: number;
  readonly items: readonly GodotSortedRenderItem<TPayload>[];
}

export interface GodotRenderSortResult<TPayload = unknown> {
  readonly frame: number;
  readonly items: readonly GodotSortedRenderItem<TPayload>[];
  readonly batches: readonly GodotRenderSortBatch<TPayload>[];
  readonly opaqueCount: number;
  readonly transparentCount: number;
  readonly passRanges: ReadonlyMap<GodotRenderSortPass, Readonly<{ first: number; count: number }>>;
  readonly generation: number;
}

export interface GodotRenderSortSnapshot {
  readonly frame: number;
  readonly sorts: number;
  readonly items: number;
  readonly batches: number;
  readonly uniquePipelines: number;
  readonly uniqueMaterials: number;
  readonly generation: number;
}

const PASS_IDS: Record<GodotRenderSortPass, number> = {
  depth: 0,
  opaque: 1,
  shadow: 2,
  motion: 3,
  alpha: 4,
  overlay: 5,
};

interface MutableSortItem<TPayload> {
  source: GodotRenderSortItem<TPayload>;
  key: GodotRenderSortKey;
  originalIndex: number;
}

function finite(value: unknown, member: string, minimum = -Infinity, maximum = Infinity): number {
  const result = Number(value);
  if (!Number.isFinite(result) || result < minimum || result > maximum) {
    throw new RangeError(`godot-compat: ${member} requires a finite number in [${minimum}, ${maximum}].`);
  }
  return result;
}

function integer(value: unknown, member: string, minimum: number, maximum: number): number {
  const result = finite(value, member, minimum, maximum);
  if (!Number.isSafeInteger(result)) throw new TypeError(`godot-compat: ${member} requires an integer.`);
  return result;
}

function pass(value: unknown): GodotRenderSortPass {
  if (value !== 'depth' && value !== 'opaque' && value !== 'alpha'
    && value !== 'shadow' && value !== 'motion' && value !== 'overlay') {
    throw new TypeError(`godot-compat: unknown render sort pass ${String(value)}.`);
  }
  return value;
}

function ridKey(value: GodotRenderSortRid | null): string {
  return value === null ? '-' : `${typeof value}:${String(value)}`;
}

function hash(value: GodotRenderSortRid | null): number {
  if (value === null) return 0;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value >>> 0;
  const source = ridKey(value);
  let result = 2166136261;
  for (let index = 0; index < source.length; index++) {
    result ^= source.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function depthKey(value: number, transparent: boolean, minimum: number, maximum: number): number {
  const normalized = maximum <= minimum ? 0 : Math.max(0, Math.min(1, (value - minimum) / (maximum - minimum)));
  const quantized = Math.round(normalized * 0xffff) & 0xffff;
  return transparent ? 0xffff - quantized : quantized;
}

function byte(value: GodotRenderSortKey, index: number): number {
  if (index < 4) return (value.low >>> (index * 8)) & 0xff;
  return (value.high >>> ((index - 4) * 8)) & 0xff;
}

export class GodotRenderSortKeyRuntime {
  private readonly pipelineIds = new Map<string, number>();
  private readonly materialIds = new Map<string, number>();
  private readonly watchers = new Set<(result: GodotRenderSortResult<unknown>) => void>();
  private generation = 1;
  private frame = 0;
  private sorts = 0;
  private itemCount = 0;
  private batchCount = 0;

  createKey<TPayload>(
    item: GodotRenderSortItem<TPayload>,
    depthMinimum = 0,
    depthMaximum = 10000,
  ): GodotRenderSortKey {
    const renderPass = pass(item.pass);
    const transparent = item.transparent ?? (renderPass === 'alpha' || renderPass === 'overlay');
    const layer = integer(item.layer ?? 0, 'render sort layer', 0, 31);
    const priority = integer(item.priority ?? 0, 'render sort priority', -128, 127) + 128;
    const pipeline = this.compactId(this.pipelineIds, item.pipeline, 0xfff);
    const material = this.compactId(this.materialIds, item.material, 0xfff);
    const depth = depthKey(
      finite(item.depth ?? 0, 'render sort depth'),
      transparent,
      finite(depthMinimum, 'render sort depth minimum'),
      finite(depthMaximum, 'render sort depth maximum'),
    );
    const order = integer(item.order ?? 0, 'render sort order', 0, 0xffff);
    const high = (
      ((PASS_IDS[renderPass] & 0x7) << 29)
      | ((layer & 0x1f) << 24)
      | ((priority & 0xff) << 16)
      | ((pipeline >>> 4) & 0xffff)
    ) >>> 0;
    const low = (
      ((pipeline & 0xf) << 28)
      | ((material & 0xfff) << 16)
      | (transparent ? depth : order)
    ) >>> 0;
    return Object.freeze({
      high,
      low,
      pass: PASS_IDS[renderPass],
      layer,
      priority: priority - 128,
      pipeline,
      material,
      depth,
      order,
      transparent,
    });
  }

  sort<TPayload>(
    frameValue: number,
    values: readonly GodotRenderSortItem<TPayload>[],
    depthMinimum = 0,
    depthMaximum = 10000,
  ): GodotRenderSortResult<TPayload> {
    const frame = integer(frameValue, 'render sort frame', 0, Number.MAX_SAFE_INTEGER);
    if (frame < this.frame) throw new RangeError('godot-compat: render sort frame cannot move backwards.');
    if (!Array.isArray(values)) throw new TypeError('godot-compat: render sort requires an array.');
    this.frame = frame;
    const source: MutableSortItem<TPayload>[] = values.map((item, originalIndex) => ({
      source: Object.freeze({ ...item, pass: pass(item.pass) }),
      key: this.createKey(item, depthMinimum, depthMaximum),
      originalIndex,
    }));
    const sorted = this.radixSort(source);
    const items = sorted.map((item, sortedIndex) => Object.freeze({
      source: item.source,
      key: item.key,
      originalIndex: item.originalIndex,
      sortedIndex,
    }));
    const batches = this.buildBatches(items);
    const passRanges = new Map<GodotRenderSortPass, { first: number; count: number }>();
    for (let index = 0; index < items.length; index++) {
      const itemPass = items[index]!.source.pass;
      const range = passRanges.get(itemPass);
      if (range === undefined) passRanges.set(itemPass, { first: index, count: 1 });
      else range.count++;
    }
    const result: GodotRenderSortResult<TPayload> = Object.freeze({
      frame,
      items: Object.freeze(items),
      batches: Object.freeze(batches),
      opaqueCount: items.filter((item) => !item.key.transparent).length,
      transparentCount: items.filter((item) => item.key.transparent).length,
      passRanges: new Map([...passRanges].map(([itemPass, range]) => [itemPass, Object.freeze(range)])),
      generation: ++this.generation,
    });
    this.sorts++;
    this.itemCount += items.length;
    this.batchCount += batches.length;
    for (const watcher of this.watchers) watcher(result as GodotRenderSortResult<unknown>);
    return result;
  }

  compare(left: GodotRenderSortKey, right: GodotRenderSortKey): number {
    return left.high - right.high || left.low - right.low;
  }

  encode(key: GodotRenderSortKey): bigint {
    return (BigInt(key.high) << 32n) | BigInt(key.low);
  }

  decode(value: bigint): Readonly<{ high: number; low: number }> {
    if (value < 0n || value > 0xffff_ffff_ffff_ffffn) throw new RangeError('godot-compat: render sort key requires uint64.');
    return Object.freeze({
      high: Number((value >> 32n) & 0xffff_ffffn) >>> 0,
      low: Number(value & 0xffff_ffffn) >>> 0,
    });
  }

  getSnapshot(): GodotRenderSortSnapshot {
    return Object.freeze({
      frame: this.frame,
      sorts: this.sorts,
      items: this.itemCount,
      batches: this.batchCount,
      uniquePipelines: this.pipelineIds.size,
      uniqueMaterials: this.materialIds.size,
      generation: this.generation,
    });
  }

  watch(listener: (result: GodotRenderSortResult<unknown>) => void): () => void {
    this.watchers.add(listener);
    return () => this.watchers.delete(listener);
  }

  resetIds(): void {
    this.pipelineIds.clear();
    this.materialIds.clear();
    this.generation++;
  }

  dispose(): void {
    this.resetIds();
    this.watchers.clear();
  }

  private radixSort<TPayload>(source: MutableSortItem<TPayload>[]): MutableSortItem<TPayload>[] {
    if (source.length < 2) return source;
    let input = [...source];
    let output = new Array<MutableSortItem<TPayload>>(input.length);
    for (let byteIndex = 0; byteIndex < 8; byteIndex++) {
      const counts = new Uint32Array(256);
      for (const item of input) counts[byte(item.key, byteIndex)]!++;
      let offset = 0;
      for (let index = 0; index < counts.length; index++) {
        const count = counts[index]!;
        counts[index] = offset;
        offset += count;
      }
      for (const item of input) {
        const digit = byte(item.key, byteIndex);
        output[counts[digit]!] = item;
        counts[digit]!++;
      }
      [input, output] = [output, input];
    }
    const equalRuns: Array<{ begin: number; end: number }> = [];
    let begin = 0;
    for (let index = 1; index <= input.length; index++) {
      if (index < input.length && this.compare(input[begin]!.key, input[index]!.key) === 0) continue;
      if (index - begin > 1) equalRuns.push({ begin, end: index });
      begin = index;
    }
    for (const run of equalRuns) {
      const stable = input.slice(run.begin, run.end).sort((left, right) => left.originalIndex - right.originalIndex);
      input.splice(run.begin, stable.length, ...stable);
    }
    return input;
  }

  private buildBatches<TPayload>(
    items: readonly GodotSortedRenderItem<TPayload>[],
  ): GodotRenderSortBatch<TPayload>[] {
    const batches: GodotRenderSortBatch<TPayload>[] = [];
    let first = 0;
    while (first < items.length) {
      const head = items[first]!;
      const key = this.batchKey(head.source);
      let end = first + 1;
      while (end < items.length && this.batchKey(items[end]!.source) === key) end++;
      batches.push(Object.freeze({
        key,
        pass: head.source.pass,
        pipeline: head.source.pipeline,
        material: head.source.material,
        geometry: head.source.geometry,
        first,
        count: end - first,
        items: Object.freeze(items.slice(first, end)),
      }));
      first = end;
    }
    return batches;
  }

  private batchKey<TPayload>(item: GodotRenderSortItem<TPayload>): string {
    return [item.pass, ridKey(item.pipeline), ridKey(item.material), ridKey(item.geometry), item.transparent ? 1 : 0].join('/');
  }

  private compactId(map: Map<string, number>, rid: GodotRenderSortRid | null, maximum: number): number {
    const key = ridKey(rid);
    let value = map.get(key);
    if (value !== undefined) return value;
    value = map.size <= maximum ? map.size : hash(rid) % (maximum + 1);
    map.set(key, value);
    return value;
  }
}

export function createGodotRenderSortKeyRuntime(): GodotRenderSortKeyRuntime {
  return new GodotRenderSortKeyRuntime();
}
