/**
 * A DirectionalLight3D or OmniLight3D as the three light a three.js developer would write for it
 * (docs/GODOT.md §The lane's law, row 2): the planner decides every prop here, and emit prints them.
 *
 * - `intensity` is the energy times pi: Godot's shader divides the Lambert term by pi as three's
 *   does (`light-3d.ts`); a light in `SKY_MODE_SKY_ONLY` lights nothing in the scene
 *   (`rasterizer_scene_gles3.cpp:1724`);
 * - an omni light's range is the distance its attenuation reaches zero at, its attenuation three's
 *   decay exponent (`get_omni_spot_attenuation`, `scene.glsl:429`);
 * - a shadow is three's shadow map: a directional light's box `SHADOW_MAX_DISTANCE` around the
 *   view, its bias `SHADOW_BIAS / 100` of the box's depth, its normal bias scaled by the texel,
 *   the map 4096 texels for orthogonal shadows and 2048 for split ones; an omni light's bias over
 *   its range; the shadow's opacity three's shadow intensity;
 * - a directional light's authored values ride along for the sky pass, which reads them.
 */
import type { TargetGodotSceneSetterPlan, TargetGodotSceneValue } from './scene-document-plan';

/** A light prop's value, as emit prints it. */
export type GodotSceneLightPropValue =
  | { readonly kind: 'literal'; readonly value: number | boolean | string }
  | { readonly kind: 'numbers'; readonly values: readonly number[] };

/** The three light a scene's light node is, with its props in order. */
export interface GodotSceneLightPlan {
  readonly element: 'directionalLight' | 'pointLight';
  readonly props: readonly { readonly name: string; readonly value: GodotSceneLightPropValue }[];
  /** A directional light's authored values, handed to compat's sky pass (`onUpdate`). */
  readonly authored?: {
    readonly color?: readonly number[];
    readonly params: readonly { readonly index: number; readonly value: number }[];
    readonly shadow: boolean;
    readonly skyMode: number;
    readonly blendSplits?: true;
  };
}

const value = (setters: readonly TargetGodotSceneSetterPlan[], exportName: string, index?: number): TargetGodotSceneValue | undefined =>
  setters.find((entry) => entry.setter.exportName === exportName && (index === undefined || entry.index === index))?.value;
const number = (entry: TargetGodotSceneValue | undefined) => (entry?.kind === 'number' ? entry.value : undefined);
const literal = (entry: number | boolean | string): GodotSceneLightPropValue => ({ kind: 'literal', value: entry });

/** A Godot colour's components as the sRGB hex three reads (`#rrggbb`). */
function hexColor(components: readonly number[]): string {
  const channel = (entry: number) => Math.round(Math.min(Math.max(entry, 0), 1) * 255).toString(16).padStart(2, '0');
  return `#${components.slice(0, 3).map(channel).join('')}`;
}

/** The three light for a light node's authored setters. */
export function godotSceneLightPlan(setters: readonly TargetGodotSceneSetterPlan[], directional: boolean): GodotSceneLightPlan {
  const param = (index: number, initial: number) => number(value(setters, 'set_param', index)) ?? initial;
  const colorValue = value(setters, 'set_color');
  const color = colorValue !== undefined && 'components' in colorValue ? colorValue.components : undefined;
  const shadowValue = value(setters, 'set_shadow');
  const shadow = shadowValue?.kind === 'bool' && shadowValue.value;
  const skyMode = number(value(setters, 'set_sky_mode')) ?? 0;
  const energy = skyMode === 2 ? 0 : param(0, 1);
  const props: { name: string; value: GodotSceneLightPropValue }[] = [
    { name: 'intensity', value: literal(Math.fround(energy) * Math.PI) },
  ];
  if (color !== undefined && !color.slice(0, 3).every((component) => component === 1)) props.push({ name: 'color', value: literal(hexColor(color)) });
  if (!directional) {
    props.push({ name: 'distance', value: literal(Math.max(0.001, param(4, 5))) }, { name: 'decay', value: literal(param(6, 1)) });
  }
  if (shadow) {
    props.push({ name: 'castShadow', value: literal(true) });
    const mode = number(value(setters, 'set_shadow_mode')) ?? 2;
    if (directional) {
      const distance = param(9, 100);
      const size = mode === 0 ? 4096 : 2048;
      props.push(
        { name: 'shadow-bias', value: literal(-param(15, 0.1) / 100) },
        { name: 'shadow-normalBias', value: literal((param(14, 2) * 2 * distance) / size) },
        { name: 'shadow-mapSize', value: { kind: 'numbers', values: [size, size] } },
        { name: 'shadow-camera-left', value: literal(-distance) },
        { name: 'shadow-camera-right', value: literal(distance) },
        { name: 'shadow-camera-bottom', value: literal(-distance) },
        { name: 'shadow-camera-top', value: literal(distance) },
        { name: 'shadow-camera-near', value: literal(-distance) },
        { name: 'shadow-camera-far', value: literal(distance) },
      );
    } else {
      const range = Math.max(0.001, param(4, 5));
      props.push({ name: 'shadow-bias', value: literal(-param(15, 0.1) / (range - 0.5)) }, { name: 'shadow-mapSize', value: { kind: 'numbers', values: [1024, 1024] } });
    }
    if (param(17, 1) !== 1) props.push({ name: 'shadow-intensity', value: literal(Math.fround(param(17, 1))) });
  }
  if (!directional) return { element: 'pointLight', props };
  const blend = value(setters, 'set_blend_splits');
  return {
    element: 'directionalLight',
    props,
    authored: {
      ...(color === undefined ? {} : { color }),
      params: setters.flatMap((setter) => (setter.setter.exportName === 'set_param' && typeof setter.index === 'number' ? [{ index: setter.index, value: number(setter.value) ?? 0 }] : [])),
      shadow,
      skyMode,
      ...(blend?.kind === 'bool' && blend.value ? { blendSplits: true as const } : {}),
    },
  };
}
