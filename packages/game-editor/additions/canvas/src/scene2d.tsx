import type { Graphics } from 'pixi.js';
import { useCallback } from 'react';

/**
 * This game's 2D scene: a `canvas` root, ordinary `@pixi/react` source, 2D game rendering (sprites,
 * tilemaps, the 2D world). Not its UI: menus and the HUD are the React `dom` root.
 */
export default function Scene2D() {
  const draw = useCallback((graphics: Graphics) => {
    graphics.clear();
    graphics.rect(-40, -40, 80, 80).fill({ color: 0x579eff });
  }, []);
  return (
    <pixiContainer label="Scene">
      <pixiGraphics label="Block" x={160} y={120} draw={draw} />
    </pixiContainer>
  );
}
