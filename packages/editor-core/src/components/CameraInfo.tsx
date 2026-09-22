import { EditorSurface, Inline, Text } from '@volter/editor-sdk/widgets';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useEditorStats } from '../editor-runtime';
import { orbitLearned, subscribeOrbitLearned } from '../viewport-controls-hint';
import {
  useEditorKeymapHints,
  viewportControlsHint,
  viewportControlsHintTrackpad,
} from './ViewportControlsHint';

function fmt(n: number): string {
  return n.toFixed(2);
}

export function CameraInfo() {
  const stats = useEditorStats();
  const [pos, setPos] = useState({ x: 0, y: 0, z: 0 });
  const [target, setTarget] = useState({ x: 0, y: 0, z: 0 });
  const rafRef = useRef(0);
  const learned = useSyncExternalStore(subscribeOrbitLearned, orbitLearned, orbitLearned);
  useEditorKeymapHints();

  useEffect(() => {
    function tick() {
      const cam = stats.cameraPosition;
      const tgt = stats.cameraTarget;
      setPos((prev) =>
        prev.x !== cam.x || prev.y !== cam.y || prev.z !== cam.z
          ? { x: cam.x, y: cam.y, z: cam.z }
          : prev,
      );
      setTarget((prev) =>
        prev.x !== tgt.x || prev.y !== tgt.y || prev.z !== tgt.z
          ? { x: tgt.x, y: tgt.y, z: tgt.z }
          : prev,
      );
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [stats]);

  return (
    // P6-U6 (owner taste decision 3: HUD overlays → real islands): under
    // islands chrome the pill wears the shared glass-island material
    // (compact tier; pointer-events stays none — it is a readout, not a
    // control). Bars chrome keeps the pre-U6 overlay surface + blur.
    <EditorSurface
      variant="overlay"
      border
      className="vgai-camera-info vgai-chrome-island vgai-glass-island"
      data-island-scale="compact"
    >
      <Inline gap={8} align="center" style={{ whiteSpace: 'nowrap' }}>
        <Text variant="code">
          Pos {fmt(pos.x)} {fmt(pos.y)} {fmt(pos.z)}
        </Text>
        <Text variant="code">
          Target {fmt(target.x)} {fmt(target.y)} {fmt(target.z)}
        </Text>
      </Inline>
      {/* The bindings, shown until this user's first real orbit — the
          teaching gap a human build session measured (viewport-controls-hint.ts).
          Its own row, so the readout never wraps around it. */}
      {!learned && (
        <>
          <Text
            variant="code"
            data-testid="viewport-controls-hint"
            style={{ whiteSpace: 'nowrap' }}
          >
            {viewportControlsHint()}
          </Text>
          <Text variant="code" style={{ whiteSpace: 'nowrap' }}>
            {viewportControlsHintTrackpad()}
          </Text>
        </>
      )}
    </EditorSurface>
  );
}
