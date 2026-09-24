import { faCircleHalfStroke, faSliders } from '@fortawesome/free-solid-svg-icons';
import { Checkbox, NumberInput, themeVars } from '@volter/editor-sdk/widgets';
import { EffectComposer, EffectPass, LUT3DEffect, RenderPass } from 'postprocessing';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { LUTCubeLoader } from 'three/addons/loaders/LUTCubeLoader.js';
import { readProjectTextFile } from '../../editor-api';
import type { InspectionSection } from '@volter/editor-sdk/kit/inspection-model';
import { CONTRIBUTED_SECTION_ORDER, PROPERTIES_SECTION_ORDER } from '@volter/editor-sdk/kit/inspection-model';
import { AssetEditorShell } from '../AssetEditorShell';
import { subscribeProjectAsset } from '../asset-editor-persistence';

interface CubeLut {
  readonly title: string | null;
  readonly size: number;
  readonly domainMin: THREE.Vector3;
  readonly domainMax: THREE.Vector3;
  readonly texture3D: THREE.Data3DTexture;
}

interface PreviewSettings {
  readonly intensity: number;
  readonly split: number;
  readonly tetrahedral: boolean;
}

function basename(path: string): string {
  return path.split('/').pop() ?? path;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function vectorLabel(value: THREE.Vector3): string {
  return [value.x, value.y, value.z].map((component) => component.toFixed(2)).join(', ');
}

function buildComparisonScene(): {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  dispose: () => void;
} {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#171a22');
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  camera.position.set(6.6, 4.6, 8.8);
  camera.lookAt(0, 0.7, 0);

  scene.add(new THREE.HemisphereLight('#dce8ff', '#322a27', 2.1));
  const key = new THREE.DirectionalLight('#fff3db', 3.8);
  key.position.set(4, 7, 5);
  scene.add(key);

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const addMesh = (
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    position: readonly [number, number, number],
  ): THREE.Mesh => {
    geometries.push(geometry);
    materials.push(material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    return mesh;
  };

  const swatches = [
    ['#e64d45', -2.4],
    ['#e5ad42', -1.2],
    ['#55b86a', 0],
    ['#47a9d8', 1.2],
    ['#8a68d7', 2.4],
  ] as const;
  for (const [color, x] of swatches) {
    addMesh(
      new THREE.SphereGeometry(0.48, 48, 32),
      new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.08 }),
      [x, 0.65, 0],
    );
  }

  const neutralValues = [0.06, 0.18, 0.5, 0.82, 1];
  neutralValues.forEach((value, index) => {
    const channel = Math.round(value * 255);
    addMesh(
      new THREE.BoxGeometry(0.78, 0.78, 0.78),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(`rgb(${channel}, ${channel}, ${channel})`),
        roughness: 0.72,
      }),
      [-2.4 + index * 1.2, 1.85, -0.1],
    );
  });

  const floor = addMesh(
    new THREE.PlaneGeometry(9, 6),
    new THREE.MeshStandardMaterial({ color: '#777b86', roughness: 0.92 }),
    [0, 0.08, -1.8],
  );
  floor.rotation.x = -Math.PI / 2;

  return {
    scene,
    camera,
    dispose: () => {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
    },
  };
}

function LutPreview({
  lut,
  settingsRef,
}: {
  lut: CubeLut;
  settingsRef: React.RefObject<PreviewSettings>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let frame = 0;
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-label', 'LUT before and after preview');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    host.replaceChildren(canvas);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = true;

    const comparison = buildComparisonScene();
    const composer = new EffectComposer(renderer);
    const lutEffect = new LUT3DEffect(lut.texture3D, { tetrahedralInterpolation: true });
    composer.addPass(new RenderPass(comparison.scene, comparison.camera));
    composer.addPass(new EffectPass(comparison.camera, lutEffect));

    const size = { width: 1, height: 1 };
    const draw = () => {
      const settings = settingsRef.current;
      const divider = Math.round(size.width * clamp(settings.split, 0.05, 0.95));
      lutEffect.blendMode.opacity.value = clamp(settings.intensity, 0, 1);
      lutEffect.tetrahedralInterpolation = settings.tetrahedral;

      renderer.setScissorTest(false);
      renderer.setRenderTarget(null);
      renderer.clear();
      renderer.setScissorTest(true);
      renderer.setScissor(0, 0, divider, size.height);
      renderer.render(comparison.scene, comparison.camera);
      renderer.setScissor(divider, 0, size.width - divider, size.height);
      composer.render();
      renderer.setScissorTest(false);
    };
    const resize = () => {
      const bounds = host.getBoundingClientRect();
      size.width = Math.max(1, Math.floor(bounds.width));
      size.height = Math.max(1, Math.floor(bounds.height));
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(size.width, size.height, false);
      composer.setSize(size.width, size.height);
      comparison.camera.aspect = size.width / size.height;
      comparison.camera.updateProjectionMatrix();
    };
    resize();
    draw();
    const observer = new ResizeObserver(() => {
      resize();
      // ResizeObserver still fires for a hidden tab; repaint the still frame
      // because requestAnimationFrame may remain suspended there.
      draw();
    });
    observer.observe(host);

    const render = () => {
      if (disposed) return;
      draw();
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      composer.dispose();
      lutEffect.dispose();
      comparison.dispose();
      renderer.dispose();
      canvas.remove();
    };
  }, [lut, settingsRef]);

  return (
    <div
      ref={hostRef}
      data-testid="lut-preview"
      style={{ width: '100%', height: '100%', minHeight: 260, background: '#171a22' }}
    />
  );
}

function PreviewControls({
  settings,
  onChange,
}: {
  settings: PreviewSettings;
  onChange: (next: PreviewSettings) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 4 }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11 }}>
        Intensity
        <NumberInput
          value={settings.intensity}
          onChange={(intensity) => onChange({ ...settings, intensity: clamp(intensity, 0, 1) })}
          step={0.01}
          precision={2}
        />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11 }}>
        Comparison split
        <NumberInput
          value={settings.split}
          onChange={(split) => onChange({ ...settings, split: clamp(split, 0.05, 0.95) })}
          step={0.01}
          precision={2}
        />
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11 }}>
        <Checkbox
          checked={settings.tetrahedral}
          onChange={(event) => onChange({ ...settings, tetrahedral: event.target.checked })}
        />
        Tetrahedral interpolation
      </label>
      <div style={{ color: themeVars.content.muted, fontSize: 10, lineHeight: 1.45 }}>
        Preview controls are session-only. Bind the LUT and accepted intensity in the owning TSX
        post-processing composition.
      </div>
    </div>
  );
}

async function loadCubeLut(assetPath: string): Promise<CubeLut> {
  const source = await readProjectTextFile(assetPath);
  if (source === null) throw new Error(`CUBE LUT not found: ${assetPath}`);
  return new LUTCubeLoader().parse(source) as CubeLut;
}

export function LutAssetDocument({
  documentId,
  assetPath,
  active = true,
}: {
  documentId: string;
  assetPath: string;
  active?: boolean;
}) {
  const [revision, setRevision] = useState(0);
  const [lut, setLut] = useState<CubeLut | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [settings, setSettings] = useState<PreviewSettings>({
    intensity: 1,
    split: 0.5,
    tetrahedral: true,
  });
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    if (!active) return;
    return subscribeProjectAsset(assetPath, () => setRevision((value) => value + 1));
  }, [active, assetPath]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let owned: CubeLut | null = null;
    setLut(null);
    setLoadError(null);
    void loadCubeLut(assetPath).then(
      (next) => {
        owned = next;
        if (cancelled) {
          next.texture3D.dispose();
          return;
        }
        setLut(next);
      },
      (cause) => {
        if (!cancelled) setLoadError(cause instanceof Error ? cause.message : String(cause));
      },
    );
    return () => {
      cancelled = true;
      owned?.texture3D.dispose();
    };
  }, [active, assetPath, revision]);

  const sections = useMemo<InspectionSection[]>(
    () => [
      {
        id: 'lut-profile',
        title: 'Color Grade',
        icon: faCircleHalfStroke,
        order: PROPERTIES_SECTION_ORDER,
        body: {
          kind: 'custom',
          ...(lut
            ? {
                data: {
                  title: lut.title,
                  size: lut.size,
                  domainMin: lut.domainMin.toArray(),
                  domainMax: lut.domainMax.toArray(),
                },
              }
            : {}),
          render: () => (
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 10px' }}>
              <span style={{ color: themeVars.content.muted }}>Title</span>
              <span>{lut?.title || basename(assetPath)}</span>
              <span style={{ color: themeVars.content.muted }}>Cube</span>
              <span>{lut ? `${lut.size}³` : '—'}</span>
              <span style={{ color: themeVars.content.muted }}>Domain</span>
              <span>
                {lut ? `${vectorLabel(lut.domainMin)} → ${vectorLabel(lut.domainMax)}` : '—'}
              </span>
            </div>
          ),
        },
      },
      {
        id: 'lut-preview-settings',
        title: 'Preview',
        icon: faSliders,
        order: CONTRIBUTED_SECTION_ORDER,
        body: {
          kind: 'custom',
          data: { ...settings },
          render: () => <PreviewControls settings={settings} onChange={setSettings} />,
        },
      },
    ],
    [assetPath, lut, settings],
  );

  if (loadError) {
    return (
      <AssetEditorShell
        documentId={documentId}
        active={active}
        type="color grade"
        title={basename(assetPath)}
        status="CUBE LUT unavailable"
      >
        <div role="alert" style={{ padding: 20, color: themeVars.semantic.danger }}>
          {loadError}
        </div>
      </AssetEditorShell>
    );
  }

  if (!lut) {
    return (
      <AssetEditorShell
        documentId={documentId}
        active={active}
        type="color grade"
        title={basename(assetPath)}
        status="Loading CUBE LUT"
      >
        <div style={{ padding: 20, color: themeVars.content.muted }}>Loading color grade…</div>
      </AssetEditorShell>
    );
  }

  return (
    <AssetEditorShell
      documentId={documentId}
      active={active}
      type="color grade"
      title={basename(assetPath)}
      sections={sections}
      status={`CUBE LUT · ${lut.size}³`}
      fill
    >
      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          minHeight: 0,
          background: '#171a22',
        }}
      >
        <LutPreview lut={lut} settingsRef={settingsRef} />
        <div
          style={{
            position: 'absolute',
            left: 12,
            top: 12,
            padding: '4px 7px',
            borderRadius: 4,
            background: 'rgba(12,14,20,0.72)',
            color: '#f2f4f8',
            fontSize: 10,
            pointerEvents: 'none',
          }}
        >
          Original
        </div>
        <div
          style={{
            position: 'absolute',
            right: 12,
            top: 12,
            padding: '4px 7px',
            borderRadius: 4,
            background: 'rgba(12,14,20,0.72)',
            color: '#f2f4f8',
            fontSize: 10,
            pointerEvents: 'none',
          }}
        >
          {lut.title || 'Graded'}
        </div>
      </div>
    </AssetEditorShell>
  );
}
