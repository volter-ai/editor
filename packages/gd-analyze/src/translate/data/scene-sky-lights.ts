/**
 * Which directional lights feed a WorldEnvironment's sky, decided at plan time (docs/GODOT.md
 * §The lane's law, row 2: the plan decides, emit prints). Godot's sky pass fills its light buffer
 * from the world's directional lights whose sky mode is not `LIGHT_ONLY`, at most four
 * (`_setup_sky`, `rasterizer_scene_gles3.cpp:728-771`; `max_directional_lights`, `:4591`). The
 * plan names, for a node whose idiom takes sky lights (a WorldEnvironment) and whose authored
 * environment draws a sky, the nodes of the same scene whose idiom is a sky light (a
 * DirectionalLight3D), in scene order, authored with a sky mode other than `LIGHT_ONLY`, at most
 * four. Emit prints them as refs on the lights' elements handed to the environment's element (the
 * `skyLights` prop), which reads them in its own frame hook (`world-environment.ts`).
 *
 * What this leaves out, where Godot's world would include it: a light of another scene (an
 * instanced one, or the scene that instances this one), a light an imported model carries, a light
 * a script adds at runtime, and a light authored `LIGHT_ONLY` that a script later lets the sky see;
 * and every light, where the authored environment draws no sky and a script sets one that does.
 */
import type { DirectGodotSceneDocumentPlan, DirectGodotSceneNodePlan } from './direct-project-composition-plan';
import { godotSceneSubnodes, type TargetGodotSceneResourcePlan, type TargetGodotSceneSetterPlan, type TargetGodotSceneValue } from './scene-document-plan';

/** `RasterizerSceneGLES3::sky_globals.max_directional_lights` (`rasterizer_scene_gles3.cpp:4591`). */
const SKY_LIGHTS = 4;

/** `DirectionalLight3D::SKY_MODE_LIGHT_ONLY` (`scene/3d/light_3d.h:173`). */
const SKY_MODE_LIGHT_ONLY = 1;

type SceneWithoutRefs = Omit<DirectGodotSceneDocumentPlan, 'refs'>;

const valueOf = (setters: readonly TargetGodotSceneSetterPlan[], exportName: string): TargetGodotSceneValue | undefined =>
  setters.find((entry) => entry.setter.exportName === exportName)?.value;
const numberOf = (setters: readonly TargetGodotSceneSetterPlan[], exportName: string, initial: number): number => {
  const value = valueOf(setters, exportName);
  return value?.kind === 'number' ? value.value : initial;
};

/**
 * Whether the environment a node authors draws a sky (as `world-environment.ts` draws one): it has a
 * sky with a material, and the sky is the background (`BG_SKY`), is reflected
 * (`REFLECTION_SOURCE_SKY`), or lights the ambient at a share over 0 (`AMBIENT_SOURCE_SKY`);
 * a background of the sky already reflects it and lights the ambient by default.
 */
function drawsSky(scene: SceneWithoutRefs, node: DirectGodotSceneNodePlan): boolean {
  const resource = (value: TargetGodotSceneValue | undefined): TargetGodotSceneResourcePlan | undefined =>
    value?.kind === 'resource' ? scene.resources.find((entry) => entry.key === value.key) : undefined;
  const environment = resource(valueOf(node.setters, 'set_environment'));
  if (environment === undefined) return false;
  const sky = resource(valueOf(environment.setters, 'set_sky'));
  if (sky === undefined || resource(valueOf(sky.setters, 'set_material')) === undefined) return false;
  const set = environment.setters;
  return (
    numberOf(set, 'set_background', 0) === 2 ||
    numberOf(set, 'set_reflection_source', 0) === 2 ||
    (numberOf(set, 'set_ambient_source', 0) === 3 && numberOf(set, 'set_ambient_light_sky_contribution', 1) > 0)
  );
}

/** The scene's sky lights, in scene order: its own nodes, not an instanced scene's. */
function sceneSkyLights(scene: SceneWithoutRefs): readonly { readonly nodePath: string; readonly name: string }[] {
  const lights: { nodePath: string; name: string }[] = [];
  const walk = (node: DirectGodotSceneNodePlan): void => {
    if (node.idiom?.skyLight === true && node.light?.authored?.skyMode !== SKY_MODE_LIGHT_ONLY) lights.push({ nodePath: node.nodePath, name: node.name });
    for (const child of godotSceneSubnodes(node)) walk(child);
  };
  walk(scene.root);
  return lights.slice(0, SKY_LIGHTS);
}

/** The scene with each sky-drawing WorldEnvironment given the lights its sky reads. */
export function planGodotSceneSkyLights(scene: SceneWithoutRefs): SceneWithoutRefs {
  let lights: readonly { readonly nodePath: string; readonly name: string }[] | undefined;
  const stamp = (node: DirectGodotSceneNodePlan): DirectGodotSceneNodePlan => {
    const children = node.children.map(stamp);
    const placements = node.placements?.map((placed) => ({ at: placed.at, node: stamp(placed.node) }));
    const own = node.idiom?.skyLights === true && drawsSky(scene, node) ? (lights ??= sceneSkyLights(scene)) : [];
    return {
      ...node,
      ...(own.length === 0 ? {} : { skyLights: own }),
      children,
      ...(placements === undefined ? {} : { placements }),
    };
  };
  return { ...scene, root: stamp(scene.root) };
}
