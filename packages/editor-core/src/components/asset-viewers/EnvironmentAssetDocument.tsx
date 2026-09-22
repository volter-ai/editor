import { faCloudSun, faSliders } from '@fortawesome/free-solid-svg-icons';
import { NumberInput, themeVars } from '@volter/editor-sdk/widgets';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EXRLoader } from 'three/addons/loaders/EXRLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import type { InspectionSection } from '../../inspection/model';
import { CONTRIBUTED_SECTION_ORDER, PROPERTIES_SECTION_ORDER } from '../../inspection/model';
import { AssetEditorShell } from '../AssetEditorShell';
import { subscribeProjectAsset } from '../asset-editor-persistence';

interface EnvironmentImage {
  readonly texture: THREE.DataTexture;
  readonly width: number;
  readonly height: number;
  readonly format: 'HDR' | 'EXR';
  readonly panorama: boolean;
}

interface PreviewSettings {
  readonly exposure: number;
  readonly intensity: number;
  readonly rotation: number;
  readonly blur: number;
}

function basename(path: string): string {
  return path.split('/').pop() ?? path;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isExr(path: string): boolean {
  return path.split(/[?#]/, 1)[0]!.toLowerCase().endsWith('.exr');
}

async function loadEnvironmentImage(path: string): Promise<EnvironmentImage> {
  const format = isExr(path) ? 'EXR' : 'HDR';
  const loader = format === 'EXR' ? new EXRLoader() : new HDRLoader();
  const texture = await loader.loadAsync(path);
  const image = texture.image as { width?: number; height?: number };
  const width = image.width ?? 0;
  const height = image.height ?? 0;
  const panorama = width > 0 && height > 0 && Math.abs(width / height - 2) <= 0.04;
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.needsUpdate = true;
  return { texture, width, height, format, panorama };
}

function createPreviewScene(image: EnvironmentImage): {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly geometries: readonly THREE.BufferGeometry[];
  readonly materials: readonly THREE.Material[];
} {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 100);
  camera.position.set(6.2, 3.4, 7.8);
  camera.lookAt(0, 0.7, 0);
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  if (!image.panorama) {
    scene.background = new THREE.Color('#11141b');
    const aspect = image.width > 0 && image.height > 0 ? image.width / image.height : 1;
    const geometry = new THREE.PlaneGeometry(
      aspect >= 1 ? 4.8 : 4.8 * aspect,
      aspect >= 1 ? 4.8 / aspect : 4.8,
    );
    const material = new THREE.MeshBasicMaterial({ map: image.texture, toneMapped: true });
    geometries.push(geometry);
    materials.push(material);
    scene.add(new THREE.Mesh(geometry, material));
    camera.position.set(0, 0, 6.5);
    camera.lookAt(0, 0, 0);
    return { scene, camera, geometries, materials };
  }

  scene.background = image.texture;
  scene.environment = image.texture;

  const addMesh = (
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    position: readonly [number, number, number],
  ) => {
    geometries.push(geometry);
    materials.push(material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...position);
    scene.add(mesh);
  };

  addMesh(
    new THREE.SphereGeometry(1, 64, 40),
    new THREE.MeshStandardMaterial({ color: '#d8dde5', roughness: 0.08, metalness: 1 }),
    [-2.3, 1.15, 0],
  );
  addMesh(
    new THREE.SphereGeometry(1, 64, 40),
    new THREE.MeshStandardMaterial({ color: '#c97341', roughness: 0.32, metalness: 0.25 }),
    [0, 1.15, 0],
  );
  addMesh(
    new THREE.SphereGeometry(1, 64, 40),
    new THREE.MeshStandardMaterial({ color: '#d7d5cf', roughness: 0.82, metalness: 0 }),
    [2.3, 1.15, 0],
  );
  const floorGeometry = new THREE.CircleGeometry(5.7, 96);
  const floorMaterial = new THREE.MeshStandardMaterial({
    color: '#737881',
    roughness: 0.58,
    metalness: 0,
  });
  geometries.push(floorGeometry);
  materials.push(floorMaterial);
  const floor = new THREE.Mesh(floorGeometry, floorMaterial);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.08;
  scene.add(floor);

  return { scene, camera, geometries, materials };
}

function EnvironmentPreview({
  image,
  settingsRef,
}: {
  image: EnvironmentImage;
  settingsRef: React.RefObject<PreviewSettings>;
}) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let frame = 0;
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-label', `${image.format} environment preview`);
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    host.replaceChildren(canvas);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const preview = createPreviewScene(image);
    const controls = new OrbitControls(preview.camera, canvas);
    controls.target.set(0, image.panorama ? 0.8 : 0, 0);
    controls.enableDamping = true;
    controls.enablePan = false;
    controls.minDistance = image.panorama ? 3.8 : 4;
    controls.maxDistance = image.panorama ? 14 : 10;
    controls.update();

    const size = { width: 1, height: 1 };
    const draw = () => {
      const settings = settingsRef.current;
      renderer.toneMappingExposure = clamp(settings.exposure, 0.05, 8);
      if (image.panorama) {
        const rotation = THREE.MathUtils.degToRad(settings.rotation);
        preview.scene.backgroundRotation.y = rotation;
        preview.scene.environmentRotation.y = rotation;
        preview.scene.backgroundBlurriness = clamp(settings.blur, 0, 1);
        preview.scene.environmentIntensity = clamp(settings.intensity, 0, 8);
      }
      controls.update();
      renderer.render(preview.scene, preview.camera);
    };
    const resize = () => {
      const bounds = host.getBoundingClientRect();
      size.width = Math.max(1, Math.floor(bounds.width));
      size.height = Math.max(1, Math.floor(bounds.height));
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(size.width, size.height, false);
      preview.camera.aspect = size.width / size.height;
      preview.camera.updateProjectionMatrix();
      draw();
    };
    resize();
    const observer = new ResizeObserver(resize);
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
      controls.dispose();
      for (const geometry of preview.geometries) geometry.dispose();
      for (const material of preview.materials) material.dispose();
      renderer.dispose();
      canvas.remove();
    };
  }, [image, settingsRef]);

  return (
    <div
      ref={hostRef}
      data-testid="environment-preview"
      style={{ width: '100%', height: '100%', minHeight: 260, background: '#11141b' }}
    />
  );
}

function PreviewControls({
  panorama,
  settings,
  onChange,
}: {
  panorama: boolean;
  settings: PreviewSettings;
  onChange: (next: PreviewSettings) => void;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 4 }}>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11 }}>
        Exposure
        <NumberInput
          value={settings.exposure}
          onChange={(exposure) => onChange({ ...settings, exposure: clamp(exposure, 0.05, 8) })}
          step={0.05}
          precision={2}
        />
      </label>
      {panorama && (
        <>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11 }}>
            Lighting intensity
            <NumberInput
              value={settings.intensity}
              onChange={(intensity) => onChange({ ...settings, intensity: clamp(intensity, 0, 8) })}
              step={0.05}
              precision={2}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11 }}>
            Rotation
            <NumberInput
              value={settings.rotation}
              onChange={(rotation) => onChange({ ...settings, rotation: rotation % 360 })}
              step={1}
              precision={0}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 5, fontSize: 11 }}>
            Background blur
            <NumberInput
              value={settings.blur}
              onChange={(blur) => onChange({ ...settings, blur: clamp(blur, 0, 1) })}
              step={0.05}
              precision={2}
            />
          </label>
        </>
      )}
      <div style={{ color: themeVars.content.muted, fontSize: 10, lineHeight: 1.45 }}>
        Preview controls are session-only. Bind the image, orientation, and accepted intensity in
        the owning scene source.
      </div>
    </div>
  );
}

export function EnvironmentAssetDocument({
  documentId,
  assetPath,
  active = true,
}: {
  documentId: string;
  assetPath: string;
  active?: boolean;
}) {
  const [revision, setRevision] = useState(0);
  const [image, setImage] = useState<EnvironmentImage | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [settings, setSettings] = useState<PreviewSettings>({
    exposure: 1,
    intensity: 1,
    rotation: 0,
    blur: 0,
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
    let owned: EnvironmentImage | null = null;
    setImage(null);
    setLoadError(null);
    void loadEnvironmentImage(assetPath).then(
      (next) => {
        owned = next;
        if (cancelled) {
          next.texture.dispose();
          return;
        }
        setImage(next);
      },
      (cause) => {
        if (!cancelled) setLoadError(cause instanceof Error ? cause.message : String(cause));
      },
    );
    return () => {
      cancelled = true;
      owned?.texture.dispose();
    };
  }, [active, assetPath, revision]);

  const sections = useMemo<InspectionSection[]>(
    () => [
      {
        id: 'environment-image',
        title: 'Environment Image',
        icon: faCloudSun,
        order: PROPERTIES_SECTION_ORDER,
        body: {
          kind: 'custom',
          ...(image
            ? {
                data: {
                  format: image.format,
                  width: image.width,
                  height: image.height,
                  panorama: image.panorama,
                },
              }
            : {}),
          render: () => (
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 10px' }}>
              <span style={{ color: themeVars.content.muted }}>Format</span>
              <span>{image?.format ?? '—'}</span>
              <span style={{ color: themeVars.content.muted }}>Resolution</span>
              <span>{image ? `${image.width} × ${image.height}` : '—'}</span>
              <span style={{ color: themeVars.content.muted }}>Projection</span>
              <span>{image?.panorama ? '2:1 equirectangular' : 'Flat image'}</span>
            </div>
          ),
        },
      },
      {
        id: 'environment-preview-settings',
        title: 'Preview',
        icon: faSliders,
        order: CONTRIBUTED_SECTION_ORDER,
        body: {
          kind: 'custom',
          data: { ...settings },
          render: () => (
            <PreviewControls
              panorama={image?.panorama ?? false}
              settings={settings}
              onChange={setSettings}
            />
          ),
        },
      },
    ],
    [image, settings],
  );

  const title = basename(assetPath);
  if (loadError) {
    return (
      <AssetEditorShell
        documentId={documentId}
        active={active}
        type="environment image"
        title={title}
        status="HDR image unavailable"
      >
        <div role="alert" style={{ padding: 20, color: themeVars.semantic.danger }}>
          {loadError}
        </div>
      </AssetEditorShell>
    );
  }

  if (!image) {
    return (
      <AssetEditorShell
        documentId={documentId}
        active={active}
        type="environment image"
        title={title}
        status="Loading HDR image"
      >
        <div style={{ padding: 20, color: themeVars.content.muted }}>Loading environment…</div>
      </AssetEditorShell>
    );
  }

  return (
    <AssetEditorShell
      documentId={documentId}
      active={active}
      type="environment image"
      title={title}
      sections={sections}
      status={`${image.format} · ${image.width} × ${image.height}`}
      fill
    >
      <div style={{ position: 'relative', width: '100%', height: '100%', minHeight: 0 }}>
        <EnvironmentPreview image={image} settingsRef={settingsRef} />
        <div
          style={{
            position: 'absolute',
            left: 12,
            bottom: 12,
            padding: '4px 7px',
            borderRadius: 4,
            background: 'rgba(12,14,20,0.72)',
            color: '#f2f4f8',
            fontSize: 10,
            pointerEvents: 'none',
          }}
        >
          {image.panorama ? 'Drag to orbit · wheel to frame' : 'Non-2:1 image · flat preview'}
        </div>
      </div>
    </AssetEditorShell>
  );
}
