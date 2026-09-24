import { RENDER_FEATURES, type RenderFeatureValue } from './render-features';

/**
 * Cascade resolution for render settings: engine default → scene → entity, with
 * tri-state inherit (an absent value inherits from the next level up)..
 */

/** A partial override map (scene-level or entity-level). Absent key = inherit. */
export type RenderScope = Partial<Record<string, RenderFeatureValue>>;

/** Fully-resolved settings: every registry key present. */
export type ResolvedRenderSettings = Record<string, RenderFeatureValue>;

/**
 * Resolve effective settings. `entity` overrides only apply to features whose
 * `perEntity` flag is set; non-per-entity features resolve across engine→scene
 * only. `??` walks up the chain on `undefined` (inherit) but lets an explicit
 * `false`/`0` override (they are not nullish).
 */
export function resolveRenderSettings(
  scene?: RenderScope,
  entity?: RenderScope,
): ResolvedRenderSettings {
  const out: ResolvedRenderSettings = {};
  for (const f of RENDER_FEATURES) {
    const entityVal = f.perEntity ? entity?.[f.key] : undefined;
    out[f.key] = entityVal ?? scene?.[f.key] ?? f.default;
  }
  return out;
}

/**
 * A small observable holding the live scene-level resolved settings. Live
 * features re-apply when a value changes (subscribers are notified with the
 * changed key). This is the seam a future player-facing graphics menu would
 * drive — for now it backs the editor toggles + the runtime systems.
 */
export class RenderSettings {
  private values: ResolvedRenderSettings;
  private listeners = new Set<(key: string, value: RenderFeatureValue) => void>();

  constructor(scene?: RenderScope) {
    this.values = resolveRenderSettings(scene);
  }

  get(key: string): RenderFeatureValue {
    return this.values[key]!;
  }

  /** Set a scene-level value; notifies subscribers if it changed. */
  set(key: string, value: RenderFeatureValue): void {
    if (this.values[key] === value) return;
    this.values[key] = value;
    for (const fn of this.listeners) fn(key, value);
  }

  /** Resolve the effective value for an entity (entity override → scene → default). */
  forEntity(key: string, entity?: RenderScope): RenderFeatureValue {
    const f = entity?.[key];
    return f ?? this.values[key]!;
  }

  subscribe(fn: (key: string, value: RenderFeatureValue) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  snapshot(): ResolvedRenderSettings {
    return { ...this.values };
  }
}
