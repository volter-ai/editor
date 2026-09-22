/**
 * Image Asset Lab document. A sprite is a frame, not the packed page —
 * Aseprite's canvas, Unity's Sprite inspector, Godot's AtlasTexture.
 * Integer nearest-neighbor zoom (sprite-lab `fitScale`); the atlas is
 * metadata, never the stage.
 */

import { Button, Text, text } from '@volter/editor-sdk/widgets';
import { type ReactNode, type RefObject, useEffect, useRef, useState } from 'react';
import { type ImageScaleMode, resolveImageScale } from '../../asset-workflow/image-view-scale';
import type { PixiSpritesheet, PixiSpritesheetFrame } from '../../asset-workflow/pixi-spritesheet';
import {
  parsePixiSpritesheet,
  sidecarPathForSheet,
  splitSpritesheetAssetPath,
} from '../../asset-workflow/pixi-spritesheet';
import { SpritesheetSpriteView } from './SpritesheetSpriteView';

export function ImageViewer({
  assetPath,
  displayName,
}: {
  assetPath: string;
  displayName?: string;
}) {
  const { sheetPath, frameName } = splitSpritesheetAssetPath(assetPath);
  const resolvedSheetUrl = `/${sheetPath}`;
  const [sheet, setSheet] = useState<PixiSpritesheet | null>(null);
  const [selectedFrame, setSelectedFrame] = useState<string | null>(frameName);
  const [scaleMode, setScaleMode] = useState<ImageScaleMode>('fit');
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [stageBox, setStageBox] = useState({ w: 320, h: 240 });
  const activeFrameName = selectedFrame ?? frameName;
  const frame = activeFrameName
    ? (sheet?.frames.find((entry) => entry.name === activeFrameName) ?? null)
    : null;

  useEffect(() => {
    setSelectedFrame(frameName);
    setScaleMode('fit');
  }, [frameName]);

  useEffect(() => {
    if (!frameName) {
      setSheet(null);
      return;
    }
    let cancelled = false;
    void fetch(`/${sidecarPathForSheet(sheetPath)}`)
      .then((response) => (response.ok ? response.text() : null))
      .then((source) => {
        if (cancelled || !source) return;
        setSheet(parsePixiSpritesheet(source));
      })
      .catch(() => {
        if (!cancelled) setSheet(null);
      });
    return () => {
      cancelled = true;
    };
  }, [frameName, sheetPath]);

  useEffect(() => {
    const node = stageRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect) return;
      setStageBox({ w: Math.max(1, rect.width - 24), h: Math.max(1, rect.height - 24) });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const srcWidth = frame?.sourceWidth ?? natural?.w ?? 0;
  const srcHeight = frame?.sourceHeight ?? natural?.h ?? 0;
  const scale = resolveImageScale(scaleMode, srcWidth, srcHeight, stageBox.w, stageBox.h);
  const title = displayName ?? activeFrameName ?? sheetPath.split('/').pop() ?? assetPath;

  return (
    <div
      data-testid="image-asset-document"
      style={{
        height: '100%',
        minHeight: 240,
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
      }}
    >
      <ImageScaleBar
        title={title}
        srcWidth={srcWidth}
        srcHeight={srcHeight}
        scaleMode={scaleMode}
        scale={scale}
        onScaleMode={setScaleMode}
      />
      <ImageStage
        stageRef={stageRef}
        frameName={frameName}
        frame={frame}
        sheet={sheet}
        sheetUrl={resolvedSheetUrl}
        title={title}
        scale={scale}
        onNatural={setNatural}
      />
      {sheet && sheet.frames.length > 1 ? (
        <SpriteFilmstrip
          sheetUrl={resolvedSheetUrl}
          frames={sheet.frames}
          activeName={activeFrameName}
          onPick={setSelectedFrame}
        />
      ) : null}
    </div>
  );
}

function ImageScaleBar({
  title,
  srcWidth,
  srcHeight,
  scaleMode,
  scale,
  onScaleMode,
}: {
  title: string;
  srcWidth: number;
  srcHeight: number;
  scaleMode: ImageScaleMode;
  scale: number;
  onScaleMode: (mode: ImageScaleMode) => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 6,
        padding: '6px 8px',
      }}
    >
      <Text tone="dim" variant="label">
        {title}
      </Text>
      {srcWidth > 0 && (
        <Text tone="muted" variant="code">
          {srcWidth} × {srcHeight}
          {scaleMode === 'fit' ? ` · ${formatScale(scale)}` : ''}
        </Text>
      )}
      <span style={{ flex: 1 }} />
      {([1, 4, 8, 'fit'] as const).map((mode) => (
        <Button
          key={String(mode)}
          type="button"
          size="compact"
          shape="segment"
          aria-pressed={scaleMode === mode}
          variant={scaleMode === mode ? 'primary' : 'secondary'}
          onClick={() => onScaleMode(mode)}
        >
          {mode === 'fit' ? 'Fit' : `${mode}×`}
        </Button>
      ))}
    </div>
  );
}

function ImageStage({
  stageRef,
  frameName,
  frame,
  sheet,
  sheetUrl,
  title,
  scale,
  onNatural,
}: {
  stageRef: RefObject<HTMLDivElement | null>;
  frameName: string | null;
  frame: PixiSpritesheetFrame | null;
  sheet: PixiSpritesheet | null;
  sheetUrl: string;
  title: string;
  scale: number;
  onNatural: (size: { w: number; h: number }) => void;
}) {
  let body: ReactNode;
  if (frameName && !frame) {
    body = (
      <Text tone="muted" variant="body">
        {sheet ? `No sprite named ${frameName}` : 'Loading sprite…'}
      </Text>
    );
  } else if (frame) {
    body = <SpritesheetSpriteView sheetUrl={sheetUrl} frame={frame} scale={scale} />;
  } else {
    body = (
      <img
        src={sheetUrl}
        alt={title}
        style={{
          imageRendering: 'pixelated',
          display: 'block',
          transform: `scale(${scale})`,
          transformOrigin: 'center center',
        }}
        onLoad={(event) => {
          const image = event.currentTarget;
          onNatural({ w: image.naturalWidth, h: image.naturalHeight });
        }}
      />
    );
  }
  return (
    <div
      ref={stageRef}
      className="vgai-asset-transparency-well"
      data-testid="sprite-stage"
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'auto',
      }}
    >
      {body}
    </div>
  );
}

function SpriteFilmstrip({
  sheetUrl,
  frames,
  activeName,
  onPick,
}: {
  sheetUrl: string;
  frames: readonly PixiSpritesheetFrame[];
  activeName: string | null;
  onPick: (name: string) => void;
}) {
  return (
    <div
      data-testid="sprite-filmstrip"
      style={{
        display: 'flex',
        gap: 6,
        overflowX: 'auto',
        padding: '8px 8px 10px',
        borderTop: `1px solid ${text[3]}`,
      }}
    >
      {frames.map((entry) => {
        const selected = entry.name === activeName;
        return (
          <button
            key={entry.name}
            type="button"
            title={entry.name}
            aria-pressed={selected}
            onClick={() => onPick(entry.name)}
            style={{
              border: selected ? `1px solid ${text[1]}` : '1px solid transparent',
              background: 'transparent',
              padding: 2,
              cursor: 'pointer',
              flex: '0 0 auto',
            }}
          >
            <SpritesheetSpriteView sheetUrl={sheetUrl} frame={entry} maxEdge={40} />
            <div
              style={{
                fontSize: 9,
                color: selected ? text[1] : text[3],
                maxWidth: 56,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {entry.name}
            </div>
          </button>
        );
      })}
    </div>
  );
}

function formatScale(scale: number): string {
  return scale >= 1 ? `${scale}×` : `1/${Math.round(1 / scale)}×`;
}
