/**
 * Thin Godot binding over the mesh capability's general ground projection.
 *
 * Godot projects `texture_albedo` down a Decal node's local -Y through its authored box. The
 * general capability owns that moving local/world projection; this binding supplies the two Godot
 * facts it cannot know: query the port's Rapier world while excluding the owning scene's colliders
 * (a character decal otherwise hits its own capsule at time zero), and sample the texture with the
 * same Godot import settings as every other translated texture.
 *
 * The known deviation remains explicit in the translator's per-node note: this is one flat quad on
 * the first receiver, not Godot's per-fragment wrapping over every surface inside the box.
 */
import RAPIER from '@dimforge/rapier3d-compat';
import { GroundProjectedQuad, type GroundProjectedQuadProps } from '@volter/game-runtime/world3d-react/ground-projection';
import type { GodotColliderLookup, GodotColliderOwner } from './collider-registry';
import { configureGodotTexture } from './texture-3d';

interface GodotGroundDecalContext {
  readonly world: RAPIER.World;
  readonly colliders: GodotColliderLookup<RAPIER.Collider, GodotColliderOwner>;
}

export type GodotGroundDecalProps = Omit<
  GroundProjectedQuadProps,
  'castRay' | 'configureTexture' | 'textureUrl'
> & {
  readonly ctx: GodotGroundDecalContext;
  readonly owner: object;
  readonly texture: string;
};

export function GodotGroundDecal({
  ctx,
  owner,
  texture,
  ...props
}: GodotGroundDecalProps): React.JSX.Element {
  return (
    <GroundProjectedQuad
      {...props}
      name={props.name ?? 'GodotGroundDecal'}
      textureUrl={texture}
      configureTexture={(loaded) => configureGodotTexture(loaded, {})}
      castRay={(origin, direction, reach) =>
        ctx.world.castRay(
          new RAPIER.Ray(origin, direction),
          reach,
          true,
          undefined,
          undefined,
          undefined,
          undefined,
          (collider) => ctx.colliders.get(collider) !== owner,
        )?.timeOfImpact ?? null
      }
    />
  );
}
