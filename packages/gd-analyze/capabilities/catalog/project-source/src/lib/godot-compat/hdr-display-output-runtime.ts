export type GodotHdrDisplayRid = string | number;
export type GodotHdrTransferFunction = 'srgb' | 'linear' | 'pq' | 'hlg';
export type GodotHdrColorPrimaries = 'srgb' | 'display-p3' | 'rec2020';
export type GodotHdrToneMapper = 'linear' | 'reinhard' | 'filmic' | 'aces';

export interface GodotHdrMasteringMetadata {
  readonly red: readonly [number, number];
  readonly green: readonly [number, number];
  readonly blue: readonly [number, number];
  readonly white: readonly [number, number];
  readonly minimumLuminance: number;
  readonly maximumLuminance: number;
  readonly maximumContentLightLevel: number;
  readonly maximumFrameAverageLightLevel: number;
}

export interface GodotHdrDisplayDescriptor {
  readonly viewport: GodotHdrDisplayRid;
  readonly enabled?: boolean;
  readonly transfer?: GodotHdrTransferFunction;
  readonly primaries?: GodotHdrColorPrimaries;
  readonly toneMapper?: GodotHdrToneMapper;
  readonly paperWhiteNits?: number;
  readonly peakNits?: number;
  readonly blackNits?: number;
  readonly exposure?: number;
  readonly whitePoint?: number;
  readonly gamutMapping?: boolean;
  readonly dithering?: boolean;
  readonly mastering?: Partial<GodotHdrMasteringMetadata>;
}

export interface GodotHdrOutputVariant {
  readonly key: string;
  readonly viewport: GodotHdrDisplayRid;
  readonly format: string;
  readonly colorSpace: string;
  readonly transfer: GodotHdrTransferFunction;
  readonly primaries: GodotHdrColorPrimaries;
  readonly toneMapper: GodotHdrToneMapper;
  readonly hdr: boolean;
  readonly bitsPerChannel: number;
  readonly paperWhiteNits: number;
  readonly peakNits: number;
  readonly blackNits: number;
  readonly exposure: number;
  readonly whitePoint: number;
  readonly gamutMapping: boolean;
  readonly dithering: boolean;
  readonly mastering: GodotHdrMasteringMetadata;
  readonly revision: number;
}

export interface GodotHdrDisplayCapabilities {
  readonly hdrSupported: boolean;
  readonly formats: readonly string[];
  readonly colorSpaces: readonly string[];
  readonly maximumNits?: number;
  readonly minimumNits?: number;
  readonly preferredTransfer?: GodotHdrTransferFunction;
}

export interface GodotHdrDisplaySnapshot {
  readonly viewports: number;
  readonly hdrViewports: number;
  readonly variants: number;
  readonly pipelineBuilds: number;
  readonly metadataUpdates: number;
  readonly generation: number;
}

export interface GodotHdrDisplayBackend<TPipeline = unknown> {
  createPipeline(variant: GodotHdrOutputVariant): TPipeline;
  updateMetadata(viewport: GodotHdrDisplayRid, metadata: GodotHdrMasteringMetadata): void;
  destroyPipeline(pipeline: TPipeline): void;
}

interface DisplayState<TPipeline> {
  descriptor: Required<Omit<GodotHdrDisplayDescriptor, 'mastering'>> & { mastering: GodotHdrMasteringMetadata };
  capabilities: GodotHdrDisplayCapabilities;
  variant: GodotHdrOutputVariant;
  pipeline: TPipeline;
  revision: number;
}

function finite(value: unknown, member: string, minimum = -Infinity, maximum = Infinity): number {
  const result = Number(value);
  if (!Number.isFinite(result) || result < minimum || result > maximum) {
    throw new RangeError(`godot-compat: ${member} requires a finite number in [${minimum}, ${maximum}].`);
  }
  return result;
}

function point(value: readonly [number, number] | undefined, fallback: readonly [number, number], member: string): readonly [number, number] {
  const source = value ?? fallback;
  if (source.length !== 2) throw new TypeError(`godot-compat: ${member} requires two components.`);
  return Object.freeze([
    finite(source[0], `${member}.x`, 0, 1),
    finite(source[1], `${member}.y`, 0, 1),
  ]);
}

function transfer(value: unknown): GodotHdrTransferFunction {
  if (value !== 'srgb' && value !== 'linear' && value !== 'pq' && value !== 'hlg') {
    throw new TypeError(`godot-compat: unknown HDR transfer function ${String(value)}.`);
  }
  return value;
}

function primaries(value: unknown): GodotHdrColorPrimaries {
  if (value !== 'srgb' && value !== 'display-p3' && value !== 'rec2020') {
    throw new TypeError(`godot-compat: unknown HDR color primaries ${String(value)}.`);
  }
  return value;
}

function toneMapper(value: unknown): GodotHdrToneMapper {
  if (value !== 'linear' && value !== 'reinhard' && value !== 'filmic' && value !== 'aces') {
    throw new TypeError(`godot-compat: unknown tone mapper ${String(value)}.`);
  }
  return value;
}

function mastering(value: Partial<GodotHdrMasteringMetadata> | undefined): GodotHdrMasteringMetadata {
  const minimum = finite(value?.minimumLuminance ?? 0.0001, 'HDR mastering minimum luminance', 0);
  const maximum = finite(value?.maximumLuminance ?? 1000, 'HDR mastering maximum luminance', minimum);
  return Object.freeze({
    red: point(value?.red, [0.708, 0.292], 'HDR mastering red'),
    green: point(value?.green, [0.17, 0.797], 'HDR mastering green'),
    blue: point(value?.blue, [0.131, 0.046], 'HDR mastering blue'),
    white: point(value?.white, [0.3127, 0.329], 'HDR mastering white'),
    minimumLuminance: minimum,
    maximumLuminance: maximum,
    maximumContentLightLevel: finite(value?.maximumContentLightLevel ?? maximum, 'HDR maximum content light level', 0),
    maximumFrameAverageLightLevel: finite(value?.maximumFrameAverageLightLevel ?? Math.min(400, maximum), 'HDR maximum frame average light level', 0),
  });
}

function descriptor(value: GodotHdrDisplayDescriptor): DisplayState<unknown>['descriptor'] {
  const blackNits = finite(value.blackNits ?? 0.0001, 'HDR black nits', 0);
  const peakNits = finite(value.peakNits ?? 1000, 'HDR peak nits', blackNits);
  return Object.freeze({
    viewport: value.viewport,
    enabled: value.enabled ?? false,
    transfer: transfer(value.transfer ?? 'srgb'),
    primaries: primaries(value.primaries ?? 'srgb'),
    toneMapper: toneMapper(value.toneMapper ?? 'aces'),
    paperWhiteNits: finite(value.paperWhiteNits ?? 203, 'HDR paper white nits', blackNits, peakNits),
    peakNits,
    blackNits,
    exposure: finite(value.exposure ?? 1, 'HDR exposure', 0),
    whitePoint: finite(value.whitePoint ?? 6, 'HDR white point', Number.EPSILON),
    gamutMapping: value.gamutMapping ?? true,
    dithering: value.dithering ?? true,
    mastering: mastering(value.mastering),
  });
}

function capabilities(value: GodotHdrDisplayCapabilities): GodotHdrDisplayCapabilities {
  if (!Array.isArray(value.formats) || value.formats.length === 0 || !Array.isArray(value.colorSpaces) || value.colorSpaces.length === 0) {
    throw new TypeError('godot-compat: HDR display capabilities require formats and color spaces.');
  }
  return Object.freeze({
    hdrSupported: Boolean(value.hdrSupported),
    formats: Object.freeze([...value.formats]),
    colorSpaces: Object.freeze([...value.colorSpaces]),
    maximumNits: finite(value.maximumNits ?? 1000, 'display maximum nits', 0),
    minimumNits: finite(value.minimumNits ?? 0, 'display minimum nits', 0),
    ...(value.preferredTransfer === undefined
      ? {}
      : { preferredTransfer: transfer(value.preferredTransfer) }),
  });
}

export class GodotHdrDisplayOutputRuntime<TPipeline = unknown> {
  private readonly displays = new Map<GodotHdrDisplayRid, DisplayState<TPipeline>>();
  private readonly watchers = new Set<(variant: GodotHdrOutputVariant) => void>();
  private generation = 1;
  private pipelineBuilds = 0;
  private metadataUpdates = 0;

  constructor(private backend: GodotHdrDisplayBackend<TPipeline>) {}

  configure(value: GodotHdrDisplayDescriptor, capabilitiesValue: GodotHdrDisplayCapabilities): GodotHdrOutputVariant {
    const nextDescriptor = descriptor(value);
    const nextCapabilities = capabilities(capabilitiesValue);
    const variant = this.resolveVariant(nextDescriptor, nextCapabilities);
    const retained = this.displays.get(value.viewport);
    if (retained !== undefined) this.backend.destroyPipeline(retained.pipeline);
    const pipeline = this.backend.createPipeline(variant);
    this.pipelineBuilds++;
    this.backend.updateMetadata(value.viewport, variant.mastering);
    this.metadataUpdates++;
    this.displays.set(value.viewport, {
      descriptor: nextDescriptor as DisplayState<TPipeline>['descriptor'],
      capabilities: nextCapabilities,
      variant,
      pipeline,
      revision: ++this.generation,
    });
    for (const watcher of this.watchers) watcher(variant);
    return variant;
  }

  update(
    viewport: GodotHdrDisplayRid,
    patch: Partial<Omit<GodotHdrDisplayDescriptor, 'viewport'>>,
  ): GodotHdrOutputVariant {
    const state = this.require(viewport);
    return this.configure({ ...state.descriptor, ...patch, viewport }, state.capabilities);
  }

  updateCapabilities(viewport: GodotHdrDisplayRid, value: GodotHdrDisplayCapabilities): GodotHdrOutputVariant {
    const state = this.require(viewport);
    return this.configure(state.descriptor, value);
  }

  remove(viewport: GodotHdrDisplayRid): boolean {
    const state = this.displays.get(viewport);
    if (state === undefined) return false;
    this.backend.destroyPipeline(state.pipeline);
    this.displays.delete(viewport);
    this.generation++;
    return true;
  }

  getVariant(viewport: GodotHdrDisplayRid): GodotHdrOutputVariant {
    return this.require(viewport).variant;
  }

  getPipeline(viewport: GodotHdrDisplayRid): TPipeline {
    return this.require(viewport).pipeline;
  }

  encodeLuminance(viewport: GodotHdrDisplayRid, nitsValue: number): number {
    const variant = this.require(viewport).variant;
    const nits = finite(nitsValue, 'HDR luminance', 0);
    if (variant.transfer === 'pq') {
      const m1 = 2610 / 16384;
      const m2 = 2523 / 32;
      const c1 = 3424 / 4096;
      const c2 = 2413 / 128;
      const c3 = 2392 / 128;
      const normalized = Math.max(0, Math.min(1, nits / 10000));
      const powered = normalized ** m1;
      return ((c1 + c2 * powered) / (1 + c3 * powered)) ** m2;
    }
    if (variant.transfer === 'hlg') {
      const normalized = nits / Math.max(variant.peakNits, Number.EPSILON);
      return normalized <= 1 / 12
        ? Math.sqrt(3 * normalized)
        : 0.17883277 * Math.log(12 * normalized - 0.28466892) + 0.55991073;
    }
    const normalized = nits / Math.max(variant.paperWhiteNits, Number.EPSILON);
    return variant.transfer === 'srgb'
      ? normalized <= 0.0031308 ? normalized * 12.92 : 1.055 * normalized ** (1 / 2.4) - 0.055
      : normalized;
  }

  decodeLuminance(viewport: GodotHdrDisplayRid, encodedValue: number): number {
    const variant = this.require(viewport).variant;
    const encoded = finite(encodedValue, 'encoded HDR luminance', 0);
    if (variant.transfer === 'pq') {
      const m1 = 2610 / 16384;
      const m2 = 2523 / 32;
      const c1 = 3424 / 4096;
      const c2 = 2413 / 128;
      const c3 = 2392 / 128;
      const powered = encoded ** (1 / m2);
      return 10000 * (Math.max(powered - c1, 0) / Math.max(c2 - c3 * powered, Number.EPSILON)) ** (1 / m1);
    }
    if (variant.transfer === 'hlg') {
      const normalized = encoded <= 0.5
        ? encoded * encoded / 3
        : (Math.exp((encoded - 0.55991073) / 0.17883277) + 0.28466892) / 12;
      return normalized * variant.peakNits;
    }
    const linear = variant.transfer === 'srgb'
      ? encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4
      : encoded;
    return linear * variant.paperWhiteNits;
  }

  getSnapshot(): GodotHdrDisplaySnapshot {
    return Object.freeze({
      viewports: this.displays.size,
      hdrViewports: [...this.displays.values()].filter((state) => state.variant.hdr).length,
      variants: this.displays.size,
      pipelineBuilds: this.pipelineBuilds,
      metadataUpdates: this.metadataUpdates,
      generation: this.generation,
    });
  }

  watch(listener: (variant: GodotHdrOutputVariant) => void): () => void {
    this.watchers.add(listener);
    return () => this.watchers.delete(listener);
  }

  replaceBackend(backend: GodotHdrDisplayBackend<TPipeline>): void {
    const values = [...this.displays.values()].map((state) => ({ descriptor: state.descriptor, capabilities: state.capabilities }));
    for (const state of this.displays.values()) this.backend.destroyPipeline(state.pipeline);
    this.displays.clear();
    this.backend = backend;
    for (const value of values) this.configure(value.descriptor, value.capabilities);
    this.generation++;
  }

  dispose(): void {
    for (const state of this.displays.values()) this.backend.destroyPipeline(state.pipeline);
    this.displays.clear();
    this.watchers.clear();
    this.generation++;
  }

  private resolveVariant(
    value: DisplayState<TPipeline>['descriptor'],
    capabilities: GodotHdrDisplayCapabilities,
  ): GodotHdrOutputVariant {
    const hdr = value.enabled && capabilities.hdrSupported;
    const requestedTransfer = hdr ? (capabilities.preferredTransfer ?? value.transfer) : 'srgb';
    const requestedPrimaries = hdr ? value.primaries : 'srgb';
    const formatCandidates = hdr
      ? ['rgba16f', 'rgb10a2', 'rgba16unorm', 'rgba8unorm']
      : ['rgba8unorm-srgb', 'bgra8unorm-srgb', 'rgba8unorm'];
    const format = formatCandidates.find((candidate) => capabilities.formats.includes(candidate)) ?? capabilities.formats[0]!;
    const colorSpaceCandidates = hdr
      ? requestedTransfer === 'pq' ? ['hdr10-st2084', 'rec2020-pq', 'extended-srgb-linear'] : ['rec2020-hlg', 'extended-srgb-linear']
      : ['srgb', 'display-p3'];
    const colorSpace = colorSpaceCandidates.find((candidate) => capabilities.colorSpaces.includes(candidate)) ?? capabilities.colorSpaces[0]!;
    const peakNits = Math.min(value.peakNits, capabilities.maximumNits ?? value.peakNits);
    const blackNits = Math.max(value.blackNits, capabilities.minimumNits ?? value.blackNits);
    const bitsPerChannel = format.includes('16') ? 16 : format.includes('10') ? 10 : 8;
    const masteringValue = Object.freeze({
      ...value.mastering,
      minimumLuminance: Math.max(value.mastering.minimumLuminance, blackNits),
      maximumLuminance: Math.min(value.mastering.maximumLuminance, peakNits),
      maximumContentLightLevel: Math.min(value.mastering.maximumContentLightLevel, peakNits),
      maximumFrameAverageLightLevel: Math.min(value.mastering.maximumFrameAverageLightLevel, peakNits),
    });
    const key = [format, colorSpace, requestedTransfer, requestedPrimaries, value.toneMapper, bitsPerChannel, hdr ? 1 : 0].join('/');
    return Object.freeze({
      key,
      viewport: value.viewport,
      format,
      colorSpace,
      transfer: requestedTransfer,
      primaries: requestedPrimaries,
      toneMapper: value.toneMapper,
      hdr,
      bitsPerChannel,
      paperWhiteNits: Math.min(value.paperWhiteNits, peakNits),
      peakNits,
      blackNits,
      exposure: value.exposure,
      whitePoint: value.whitePoint,
      gamutMapping: value.gamutMapping,
      dithering: value.dithering,
      mastering: masteringValue,
      revision: ++this.generation,
    });
  }

  private require(viewport: GodotHdrDisplayRid): DisplayState<TPipeline> {
    const value = this.displays.get(viewport);
    if (value === undefined) throw new Error('godot-compat: HDR display viewport is not configured.');
    return value;
  }
}

export function createGodotHdrDisplayOutputRuntime<TPipeline = unknown>(
  backend: GodotHdrDisplayBackend<TPipeline>,
): GodotHdrDisplayOutputRuntime<TPipeline> {
  return new GodotHdrDisplayOutputRuntime(backend);
}
