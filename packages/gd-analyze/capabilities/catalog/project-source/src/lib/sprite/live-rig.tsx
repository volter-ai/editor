/**
 * Live projection of the SAME project-owned `SvgRig` used by the bake tools.
 *
 * A live rig is only warranted when gameplay needs a joint after bake time
 * (aim, look-at, equipment, damage deformation). Ordinary sprite cycles stay
 * baked. This component keeps every named SVG group as a real Pixi Container,
 * so the game can supply a small pose override without introducing another
 * rig document or a mirror scene graph.
 */
import { extend } from '@pixi/react';
import { Assets, Container, Sprite, type Texture } from 'pixi.js';
import { useEffect, useMemo, useState } from 'react';
import {
  type GroupTransform,
  group,
  type Pose,
  poseToSvg,
  type SvgGroupNode,
  type SvgNode,
  type SvgRig,
} from './svg-rig';

extend({ Container, Sprite });

export interface LiveSvgRigProps {
  readonly rig: SvgRig;
  /** Square viewport edge in source-coordinate pixels. */
  readonly cell: number;
  /** Normalized animation phase. The rig decides how phase maps to a pose. */
  readonly phase: number;
  /**
   * Gameplay-owned adjustments by named joint. Properties merge over the
   * animation pose, so `{ weapon: { rotation: aim } }` preserves its motion.
   */
  readonly overrides?: Pose;
}

/** Merge property-level gameplay adjustments over an animation pose. */
export function mergePoses(animation: Pose, overrides: Pose | undefined): Pose {
  if (!overrides) return animation;
  const merged: Record<string, GroupTransform> = { ...animation };
  for (const [name, override] of Object.entries(overrides)) {
    merged[name] = { ...animation[name], ...override };
  }
  return merged;
}

const texturePromises = new Map<string, Promise<Texture>>();

function loadSvgTexture(url: string): Promise<Texture> {
  let pending = texturePromises.get(url);
  if (!pending) {
    pending = Assets.load<Texture>(url);
    texturePromises.set(url, pending);
  }
  return pending;
}

function useSvgTexture(url: string): Texture | null {
  const [texture, setTexture] = useState<Texture | null>(null);
  useEffect(() => {
    let current = true;
    setTexture(null);
    void loadSvgTexture(url).then((loaded) => {
      if (current) setTexture(loaded);
    });
    return () => {
      current = false;
    };
  }, [url]);
  return texture;
}

function Leaf({ cell, node, origin }: { cell: number; node: SvgNode; origin: SvgRig['origin'] }) {
  const url = useMemo(() => {
    const leafRig: SvgRig = {
      origin,
      root: group('__live_leaf__', { children: [node] }),
      pose: () => ({}),
    };
    const svg = poseToSvg(leafRig, 0, { cell });
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }, [cell, node, origin]);
  const texture = useSvgTexture(url);
  if (!texture) return null;
  const offset = origin === 'center' ? -cell / 2 : 0;
  return <pixiSprite texture={texture} x={offset} y={offset} />;
}

function ResolvedGroup({
  cell,
  node,
  origin,
  pose,
}: {
  cell: number;
  node: SvgGroupNode;
  origin: SvgRig['origin'];
  pose: Pose;
}) {
  if (node.clip) {
    throw new Error(
      `LiveSvgRig cannot project clipped group "${node.name}". Keep that subtree baked, or express the mask with native Pixi objects.`,
    );
  }
  const transform = pose[node.name];
  const rest = node.rest;
  const [pivotX, pivotY] = node.pivot ?? [0, 0];
  const [homeX, homeY] = node.position ?? node.pivot ?? [0, 0];
  return (
    <pixiContainer
      alpha={transform?.alpha ?? rest?.alpha ?? 1}
      label={node.name}
      pivot={{ x: pivotX, y: pivotY }}
      rotation={transform?.rotation ?? rest?.rotation ?? 0}
      scale={{
        x: transform?.scaleX ?? rest?.scaleX ?? 1,
        y: transform?.scaleY ?? rest?.scaleY ?? 1,
      }}
      skew={{
        x: transform?.skewX ?? rest?.skewX ?? 0,
        y: transform?.skewY ?? rest?.skewY ?? 0,
      }}
      x={transform?.x ?? rest?.x ?? homeX}
      y={transform?.y ?? rest?.y ?? homeY}
    >
      {node.children.map((child, index) =>
        child.kind === 'group' ? (
          <ResolvedGroup
            cell={cell}
            key={`${child.name}:${index}`}
            node={child}
            origin={origin}
            pose={pose}
          />
        ) : (
          <Leaf cell={cell} key={index} node={child} origin={origin} />
        ),
      )}
    </pixiContainer>
  );
}

export function LiveSvgRig({ cell, overrides, phase, rig }: LiveSvgRigProps): React.JSX.Element {
  const pose = mergePoses(rig.pose(phase), overrides);
  const offset = rig.origin === 'center' ? cell / 2 : 0;
  return (
    <pixiContainer label="Live SVG rig" x={offset} y={offset}>
      <ResolvedGroup cell={cell} node={rig.root} origin={rig.origin} pose={pose} />
    </pixiContainer>
  );
}
