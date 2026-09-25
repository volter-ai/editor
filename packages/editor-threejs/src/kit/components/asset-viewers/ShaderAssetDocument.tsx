import { faCode, faSliders, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons';
import { Checkbox, ColorInput, NumberInput, Select, themeVars } from '@volter/editor-sdk/widgets';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { readProjectTextFile } from '@volter/editor-sdk/kit/editor-api';
import type { InspectionSection } from '@volter/editor-sdk/kit/inspection-model';
import { CONTRIBUTED_SECTION_ORDER, PROPERTIES_SECTION_ORDER } from '@volter/editor-sdk/kit/inspection-model';
import { AssetEditorShell } from '@volter/editor-sdk/kit/components/AssetEditorShell';
import { subscribeProjectAsset } from '@volter/editor-sdk/kit/components/asset-editor-persistence';
import {
  FALLBACK_FRAGMENT_SHADER,
  FALLBACK_VERTEX_SHADER,
  parseShaderDiagnostics,
  previewShaderSource,
  reflectShaderUniforms,
  type ShaderDiagnostic,
  type ShaderStage,
  type ShaderUniformDescriptor,
  shaderCompanionPath,
  shaderStageFromPath,
} from '@volter/editor-sdk/kit/components/asset-viewers/shader-source';

type PreviewGeometry = 'sphere' | 'box' | 'plane';
type UniformPreviewValue = number | boolean | string | number[];

interface ShaderFileState {
  readonly path: string | null;
  readonly source: string;
  readonly available: boolean;
}

type ShaderFiles = Record<ShaderStage, ShaderFileState>;

function fallbackFile(stage: ShaderStage, path: string | null = null): ShaderFileState {
  const source = stage === 'vertex' ? FALLBACK_VERTEX_SHADER : FALLBACK_FRAGMENT_SHADER;
  return { path, source, available: false };
}

function basename(path: string | null): string {
  return path?.split('/').pop() ?? 'Preview fallback';
}

function isColorUniform(uniform: ShaderUniformDescriptor): boolean {
  return uniform.type === 'vec3' && /(colou?r|tint|albedo|emissive)/i.test(uniform.name);
}

function automaticUniform(
  uniform: ShaderUniformDescriptor,
): 'time' | 'resolution' | 'mouse' | null {
  if (/^(u|i)?time$/i.test(uniform.name) && /^(float|double)$/.test(uniform.type)) return 'time';
  if (/^(u|i)?resolution$/i.test(uniform.name) && /^([diu]?vec)[234]$/.test(uniform.type))
    return 'resolution';
  if (/^(u|i)?mouse$/i.test(uniform.name) && /^([diu]?vec)[234]$/.test(uniform.type))
    return 'mouse';
  return null;
}

function defaultUniformValue(uniform: ShaderUniformDescriptor): UniformPreviewValue {
  if (isColorUniform(uniform)) {
    if (/horizon/i.test(uniform.name)) return '#badbe9';
    if (/zenith/i.test(uniform.name)) return '#297aba';
    if (/sun/i.test(uniform.name)) return '#fff0c2';
    return '#6f8cff';
  }
  if (uniform.type === 'bool') return false;
  if (/^(float|double|int|uint)$/.test(uniform.type)) return 0;
  const vector = uniform.type.match(/^(?:[biu]?vec)([234])$/);
  if (vector) return Array.from({ length: Number.parseInt(vector[1]!, 10) }, () => 0);
  return 0;
}

function createCheckerTexture(): THREE.DataTexture {
  const bytes = new Uint8Array([
    38, 43, 58, 255, 176, 190, 255, 255, 176, 190, 255, 255, 38, 43, 58, 255,
  ]);
  const texture = new THREE.DataTexture(bytes, 2, 2, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: this is a bounded dispatcher from native GLSL uniform types to their native Three.js preview values.
function createThreeUniformValue(
  uniform: ShaderUniformDescriptor,
  value: UniformPreviewValue,
  ownedTextures: THREE.Texture[],
): unknown {
  if (uniform.arraySize) {
    const { arraySize, ...element } = uniform;
    return Array.from({ length: arraySize }, () =>
      createThreeUniformValue(element, value, ownedTextures),
    );
  }
  if (/^sampler2D/.test(uniform.type)) {
    const texture = createCheckerTexture();
    ownedTextures.push(texture);
    return texture;
  }
  if (/^sampler/.test(uniform.type)) return null;
  if (uniform.type === 'mat3') return new THREE.Matrix3();
  if (uniform.type === 'mat4') return new THREE.Matrix4();
  if (isColorUniform(uniform))
    return new THREE.Color(typeof value === 'string' ? value : '#6f8cff');
  const vector = uniform.type.match(/^(?:[biu]?vec)([234])$/);
  if (vector) {
    const values = Array.isArray(value) ? value : [];
    const count = Number.parseInt(vector[1]!, 10);
    if (count === 2) return new THREE.Vector2(values[0] ?? 0, values[1] ?? 0);
    if (count === 3) return new THREE.Vector3(values[0] ?? 0, values[1] ?? 0, values[2] ?? 0);
    return new THREE.Vector4(values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, values[3] ?? 0);
  }
  return value;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one bounded native-uniform dispatcher keeps automatic inputs and mutable Three.js value types visible in one place.
function updateThreeUniformValue(
  target: { value: unknown },
  descriptor: ShaderUniformDescriptor,
  previewValue: UniformPreviewValue,
  elapsed: number,
  size: { width: number; height: number },
): void {
  const automatic = automaticUniform(descriptor);
  if (automatic === 'time') {
    target.value = elapsed;
    return;
  }
  if (target.value instanceof THREE.Color && typeof previewValue === 'string') {
    target.value.set(previewValue);
    return;
  }
  const values = Array.isArray(previewValue) ? previewValue : [];
  if (target.value instanceof THREE.Vector2) {
    target.value.set(
      automatic === 'resolution' ? size.width : (values[0] ?? 0),
      automatic === 'resolution' ? size.height : (values[1] ?? 0),
    );
    return;
  }
  if (target.value instanceof THREE.Vector3) {
    target.value.set(
      automatic === 'resolution' ? size.width : (values[0] ?? 0),
      automatic === 'resolution' ? size.height : (values[1] ?? 0),
      automatic === 'resolution' ? 1 : (values[2] ?? 0),
    );
    return;
  }
  if (target.value instanceof THREE.Vector4) {
    target.value.set(
      automatic === 'resolution' ? size.width : (values[0] ?? 0),
      automatic === 'resolution' ? size.height : (values[1] ?? 0),
      automatic === 'resolution' ? 1 : (values[2] ?? 0),
      values[3] ?? 0,
    );
    return;
  }
  if (automatic !== 'mouse' && !descriptor.arraySize && !/^sampler|^mat/.test(descriptor.type)) {
    target.value = previewValue;
  }
}

function geometryFor(kind: PreviewGeometry): THREE.BufferGeometry {
  if (kind === 'box') return new THREE.BoxGeometry(1.35, 1.35, 1.35, 48, 48, 48);
  if (kind === 'plane') return new THREE.PlaneGeometry(2.2, 2.2, 96, 96);
  return new THREE.SphereGeometry(0.95, 96, 64);
}

function ShaderPreview({
  vertexSource,
  fragmentSource,
  descriptors,
  valuesRef,
  geometry,
  onDiagnostics,
}: {
  vertexSource: string;
  fragmentSource: string;
  descriptors: readonly ShaderUniformDescriptor[];
  valuesRef: React.RefObject<Record<string, UniformPreviewValue>>;
  geometry: PreviewGeometry;
  onDiagnostics: (diagnostics: ShaderDiagnostic[]) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let frame = 0;
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-label', 'Live shader preview');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    host.replaceChildren(canvas);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    } catch (cause) {
      onDiagnostics([
        {
          stage: 'program',
          severity: 'error',
          message: cause instanceof Error ? cause.message : String(cause),
        },
      ]);
      return;
    }
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x11141d, 1);
    renderer.debug.checkShaderErrors = true;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100);
    camera.position.set(0, 0, 3.4);
    const ownedTextures: THREE.Texture[] = [];
    const uniforms: Record<string, THREE.IUniform> = {};
    for (const descriptor of descriptors) {
      uniforms[descriptor.name] = {
        value: createThreeUniformValue(
          descriptor,
          valuesRef.current[descriptor.name] ?? defaultUniformValue(descriptor),
          ownedTextures,
        ),
      };
    }
    const material = new THREE.ShaderMaterial({
      vertexShader: previewShaderSource(vertexSource),
      fragmentShader: previewShaderSource(fragmentSource),
      uniforms,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const meshGeometry = geometryFor(geometry);
    const mesh = new THREE.Mesh(meshGeometry, material);
    scene.add(mesh);

    const diagnostics: ShaderDiagnostic[] = [];
    renderer.debug.onShaderError = (gl, program, vertexShader, fragmentShader) => {
      // Three's callback and the DOM context can resolve WebGL opaque handles
      // through separate declaration universes. They are the same handles at
      // runtime; normalize them at this boundary instead of widening either API.
      const compatibleProgram = program as Parameters<typeof gl.getProgramInfoLog>[0];
      const compatibleVertexShader = vertexShader as Parameters<typeof gl.getShaderInfoLog>[0];
      const compatibleFragmentShader = fragmentShader as Parameters<typeof gl.getShaderInfoLog>[0];
      diagnostics.push(
        ...parseShaderDiagnostics(gl.getProgramInfoLog(compatibleProgram) ?? '', 'program'),
        ...parseShaderDiagnostics(gl.getShaderInfoLog(compatibleVertexShader) ?? '', 'vertex'),
        ...parseShaderDiagnostics(gl.getShaderInfoLog(compatibleFragmentShader) ?? '', 'fragment'),
      );
    };

    const size = { width: 1, height: 1 };
    const resize = () => {
      const bounds = host.getBoundingClientRect();
      size.width = Math.max(1, Math.floor(bounds.width));
      size.height = Math.max(1, Math.floor(bounds.height));
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(size.width, size.height, false);
      camera.aspect = size.width / size.height;
      camera.position.z = 3.4 / Math.min(1, camera.aspect);
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    const clock = new THREE.Clock();
    try {
      renderer.compile(scene, camera);
      renderer.render(scene, camera);
      onDiagnostics(
        diagnostics.filter(
          (diagnostic, index, all) =>
            all.findIndex(
              (candidate) =>
                candidate.stage === diagnostic.stage &&
                candidate.line === diagnostic.line &&
                candidate.message === diagnostic.message,
            ) === index,
        ),
      );
    } catch (cause) {
      onDiagnostics([
        {
          stage: 'program',
          severity: 'error',
          message: cause instanceof Error ? cause.message : String(cause),
        },
      ]);
    }

    const render = () => {
      if (disposed) return;
      const elapsed = clock.getElapsedTime();
      for (const descriptor of descriptors) {
        const uniform = uniforms[descriptor.name];
        if (!uniform) continue;
        updateThreeUniformValue(
          uniform,
          descriptor,
          valuesRef.current[descriptor.name] ?? defaultUniformValue(descriptor),
          elapsed,
          size,
        );
      }
      if (geometry !== 'plane') {
        mesh.rotation.y = elapsed * 0.18;
        mesh.rotation.x = Math.sin(elapsed * 0.22) * 0.08;
      }
      renderer.render(scene, camera);
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      renderer.debug.onShaderError = null;
      meshGeometry.dispose();
      material.dispose();
      for (const texture of ownedTextures) texture.dispose();
      renderer.dispose();
      canvas.remove();
    };
  }, [descriptors, fragmentSource, geometry, onDiagnostics, valuesRef, vertexSource]);

  return (
    <div
      ref={hostRef}
      data-testid="shader-preview"
      style={{ width: '100%', height: '100%', minHeight: 240, background: '#11141d' }}
    />
  );
}

function UniformControls({
  descriptors,
  values,
  onChange,
}: {
  descriptors: readonly ShaderUniformDescriptor[];
  values: Record<string, UniformPreviewValue>;
  onChange: (name: string, value: UniformPreviewValue) => void;
}) {
  if (descriptors.length === 0) {
    return <div style={{ color: themeVars.content.muted }}>No uniform declarations found.</div>;
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 4 }}>
      {descriptors.map((uniform) => (
        <UniformControlRow
          key={uniform.name}
          uniform={uniform}
          value={values[uniform.name] ?? defaultUniformValue(uniform)}
          onChange={(value) => onChange(uniform.name, value)}
        />
      ))}
      <div style={{ color: themeVars.content.muted, fontSize: 10, lineHeight: 1.4 }}>
        Preview values are session-only. Author runtime defaults beside the ShaderMaterial in
        TS/TSX.
      </div>
    </div>
  );
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: this is the bounded visual-control projection of native GLSL uniform types.
function UniformControlRow({
  uniform,
  value,
  onChange,
}: {
  uniform: ShaderUniformDescriptor;
  value: UniformPreviewValue;
  onChange: (value: UniformPreviewValue) => void;
}) {
  const automatic = automaticUniform(uniform);
  const vector = uniform.type.match(/^(?:[biu]?vec)([234])$/);
  let control: React.ReactNode;
  if (automatic) {
    control = (
      <div style={{ color: themeVars.content.muted, fontSize: 10 }}>
        Driven by preview {automatic}
      </div>
    );
  } else if (isColorUniform(uniform)) {
    control = (
      <ColorInput value={typeof value === 'string' ? value : '#6f8cff'} onChange={onChange} />
    );
  } else if (uniform.type === 'bool') {
    control = (
      <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11 }}>
        <Checkbox checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
        {value ? 'True' : 'False'}
      </label>
    );
  } else if (/^(float|double|int|uint)$/.test(uniform.type)) {
    control = (
      <NumberInput
        value={typeof value === 'number' ? value : 0}
        onChange={onChange}
        step={uniform.type === 'int' || uniform.type === 'uint' ? 1 : 0.01}
        precision={uniform.type === 'int' || uniform.type === 'uint' ? 0 : 3}
      />
    );
  } else if (vector && Array.isArray(value)) {
    control = (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${vector[1]}, minmax(0, 1fr))`,
          gap: 4,
        }}
      >
        {value.map((component, index) => (
          <NumberInput
            key={`${uniform.name}:${index}`}
            value={component}
            label={'xyzw'[index]!}
            onChange={(next) => {
              const copy = [...value];
              copy[index] = next;
              onChange(copy);
            }}
            step={0.01}
          />
        ))}
      </div>
    );
  } else {
    control = (
      <div style={{ color: themeVars.content.muted, fontSize: 10 }}>
        Reflected for runtime binding; no scalar preview control.
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ color: themeVars.content.primary, fontSize: 11 }}>{uniform.name}</span>
        <span style={{ color: themeVars.content.muted, fontSize: 10 }}>{uniform.type}</span>
      </div>
      {control}
    </div>
  );
}

function DiagnosticList({
  diagnostics,
  files,
}: {
  diagnostics: readonly ShaderDiagnostic[];
  files: ShaderFiles;
}) {
  if (diagnostics.length === 0) {
    return (
      <div style={{ color: themeVars.semantic.success, fontSize: 11, padding: 4 }}>
        Shader program compiled successfully.
      </div>
    );
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 4 }}>
      {diagnostics.map((diagnostic, index) => {
        const file = diagnostic.stage === 'program' ? null : files[diagnostic.stage];
        return (
          <div
            key={`${diagnostic.stage}:${diagnostic.line ?? 0}:${diagnostic.message}:${index}`}
            style={{
              color:
                diagnostic.severity === 'warning'
                  ? themeVars.semantic.warning
                  : themeVars.semantic.danger,
              fontSize: 10,
              lineHeight: 1.45,
            }}
          >
            {file?.available ? basename(file.path) : diagnostic.stage}
            {diagnostic.line
              ? `:${diagnostic.line}${diagnostic.column ? `:${diagnostic.column}` : ''}`
              : ''}
            {' · '}
            {diagnostic.message}
          </div>
        );
      })}
    </div>
  );
}

async function loadShaderFiles(assetPath: string): Promise<ShaderFiles> {
  const source = await readProjectTextFile(assetPath);
  if (source === null) throw new Error(`Could not read ${assetPath}.`);
  const primaryStage = shaderStageFromPath(assetPath, source);
  const companionPath = shaderCompanionPath(assetPath);
  const companionSource = companionPath ? await readProjectTextFile(companionPath) : null;
  const files: ShaderFiles = {
    vertex: fallbackFile('vertex'),
    fragment: fallbackFile('fragment'),
  };
  files[primaryStage] = { path: assetPath, source, available: true };
  const companionStage: ShaderStage = primaryStage === 'vertex' ? 'fragment' : 'vertex';
  files[companionStage] =
    companionSource === null
      ? fallbackFile(companionStage, companionPath)
      : {
          path: companionPath,
          source: companionSource,
          available: true,
        };
  return files;
}

export function ShaderAssetDocument({
  documentId,
  assetPath,
  active = true,
}: {
  documentId: string;
  assetPath: string;
  active?: boolean;
}) {
  const [files, setFiles] = useState<ShaderFiles | null>(null);
  const [fileRevision, setFileRevision] = useState(0);
  const [geometry, setGeometry] = useState<PreviewGeometry>('sphere');
  const [diagnostics, setDiagnostics] = useState<ShaderDiagnostic[]>([]);
  const [uniformValues, setUniformValues] = useState<Record<string, UniformPreviewValue>>({});
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    const reload = () => setFileRevision((revision) => revision + 1);
    const companionPath = shaderCompanionPath(assetPath);
    const unsubscribers = [
      subscribeProjectAsset(assetPath, reload),
      ...(companionPath ? [subscribeProjectAsset(companionPath, reload)] : []),
    ];
    return () => {
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
  }, [active, assetPath]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setFiles(null);
    setLoadError(null);
    void loadShaderFiles(assetPath).then(
      (loaded) => {
        if (cancelled) return;
        setFiles(loaded);
      },
      (cause) => {
        if (!cancelled) setLoadError(cause instanceof Error ? cause.message : String(cause));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [active, assetPath, fileRevision]);

  const descriptors = useMemo(
    () => (files ? reflectShaderUniforms(files.vertex.source, files.fragment.source) : []),
    [files],
  );
  useEffect(() => {
    setUniformValues((current) =>
      Object.fromEntries(
        descriptors.map((descriptor) => [
          descriptor.name,
          current[descriptor.name] ?? defaultUniformValue(descriptor),
        ]),
      ),
    );
  }, [descriptors]);
  const uniformValuesRef = useRef(uniformValues);
  uniformValuesRef.current = uniformValues;

  const sections = useMemo<InspectionSection[]>(
    () => [
      {
        id: 'shader-pair',
        title: 'Shader Pair',
        icon: faCode,
        order: PROPERTIES_SECTION_ORDER,
        body: {
          kind: 'custom',
          render: () => (
            <div
              style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: 4, fontSize: 10 }}
            >
              <span>
                Vertex · {files ? basename(files.vertex.path) : 'Loading…'}
                {files && !files.vertex.available ? ' (preview fallback)' : ''}
              </span>
              <span>
                Fragment · {files ? basename(files.fragment.path) : 'Loading…'}
                {files && !files.fragment.available ? ' (preview fallback)' : ''}
              </span>
              <span style={{ color: themeVars.content.muted }}>
                Ordinary sibling GLSL files; runtime composition stays in TS/TSX.
              </span>
            </div>
          ),
        },
      },
      {
        id: 'shader-uniforms',
        title: 'Uniforms',
        icon: faSliders,
        order: CONTRIBUTED_SECTION_ORDER,
        description: `${descriptors.length} reflected`,
        body: {
          kind: 'custom',
          data: Object.fromEntries(
            descriptors.map((descriptor) => [descriptor.name, uniformValues[descriptor.name]]),
          ),
          render: () => (
            <UniformControls
              descriptors={descriptors}
              values={uniformValues}
              onChange={(name, value) =>
                setUniformValues((current) => ({ ...current, [name]: value }))
              }
            />
          ),
        },
      },
      {
        id: 'shader-diagnostics',
        title: 'Diagnostics',
        icon: diagnostics.length > 0 ? faTriangleExclamation : faCode,
        order: CONTRIBUTED_SECTION_ORDER + 100,
        description:
          diagnostics.length === 0
            ? 'Compiled'
            : `${diagnostics.length} issue${diagnostics.length === 1 ? '' : 's'}`,
        body: {
          kind: 'custom',
          data: { diagnostics },
          render: () => files && <DiagnosticList diagnostics={diagnostics} files={files} />,
        },
      },
    ],
    [descriptors, diagnostics, files, uniformValues],
  );

  if (loadError) {
    return (
      <AssetEditorShell
        documentId={documentId}
        active={active}
        type="shader"
        title={basename(assetPath)}
        status="Shader unavailable"
      >
        <div role="alert" style={{ padding: 20, color: themeVars.semantic.danger }}>
          {loadError}
        </div>
      </AssetEditorShell>
    );
  }
  if (!files) {
    return (
      <AssetEditorShell
        documentId={documentId}
        active={active}
        type="shader"
        title={basename(assetPath)}
        status="Loading GLSL"
      >
        <div style={{ padding: 20, color: themeVars.content.muted }}>Loading shader files…</div>
      </AssetEditorShell>
    );
  }

  return (
    <AssetEditorShell
      documentId={documentId}
      active={active}
      type="shader"
      title={basename(assetPath)}
      sections={sections}
      status={
        diagnostics.length === 0
          ? `GLSL · compiles · ${descriptors.length} uniforms`
          : `GLSL · ${diagnostics.length} compile issues`
      }
      fill
    >
      <div
        style={{
          width: '100%',
          height: '100%',
          minHeight: 0,
          position: 'relative',
          background: themeVars.surface.panel,
        }}
      >
        <ShaderPreview
          vertexSource={files.vertex.source}
          fragmentSource={files.fragment.source}
          descriptors={descriptors}
          valuesRef={uniformValuesRef}
          geometry={geometry}
          onDiagnostics={setDiagnostics}
        />
        <div style={{ position: 'absolute', left: 10, top: 10 }}>
          <Select
            aria-label="Preview geometry"
            value={geometry}
            onChange={(event) => setGeometry(event.target.value as PreviewGeometry)}
          >
            <option value="sphere">Sphere</option>
            <option value="box">Box</option>
            <option value="plane">Plane</option>
          </Select>
        </div>
        {diagnostics.length > 0 && (
          <div
            style={{
              position: 'absolute',
              left: 12,
              right: 12,
              bottom: 12,
              maxHeight: 120,
              overflow: 'auto',
              padding: 8,
              border: `1px solid ${themeVars.semantic.danger}`,
              borderRadius: 6,
              background: themeVars.surface.overlay,
            }}
          >
            <DiagnosticList diagnostics={diagnostics} files={files} />
          </div>
        )}
      </div>
    </AssetEditorShell>
  );
}
