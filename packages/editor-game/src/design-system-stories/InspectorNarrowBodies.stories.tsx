/**
 * NARROW-COLUMN coverage over the REAL content-heavy section bodies, at rail
 * width. The projection is subject-agnostic, so what these prove is not the
 * projection but whether the bodies BUILT FOR THE OLD WIDER COLUMN survive the
 * slim rail. Each story renders a real body (or a real composed subject) inside
 * a ~300px `RailColumn`, which is the narrow column's target width, with
 * `overflow: hidden` so anything that spills is VISIBLE rather than scrolled
 * away.
 *
 * Which bodies are REAL vs stand-in (stated honestly, per the review ask):
 *  - CSS editors — the REAL `inspector-widgets` components (BorderEditor,
 *    AlignmentGrid, Gradient/Shadow/Filter composers, ScrubbableInput),
 *    assembled into a fixture subject. The BODY COMPONENTS are production; the
 *    subject wrapping them is synthetic (a live react/DOM subject needs a
 *    running document session + OID index, not constructible in a bounded
 *    story).
 *  - Ingest coverage — the REAL `ingestCoverageSection(deriveCapabilityCoverage(…))`
 *    section, the exact one the Game Inspector composes.
 *  - Typed-three groups — a REAL composed subject: `AuthoringInspectorSurface`
 *    over the shared `createAuthoringFixture` adapter, selected to the mesh, so
 *    its grouped descriptor bodies (Material, Gameplay, loose) render exactly as
 *    the composer builds them.
 *  - Model asset — a REAL composed subject: `AuthoringInspectorSurface` over a
 *    `SourceObject3DAuthoringAdapter` built from a hand-authored THREE scene
 *    (the same fixture the model-asset workflow exercises), so the Geometry /
 *    Animation / Materials / Source sections are the real contributions.
 */

import { UNCAPTURED_REACH } from '../host/adapter-reach';
import { SourceObject3DAuthoringAdapter } from '@volter/editor-threejs/kit/authoring/source-object3d-authoring-adapter';
import { faPalette } from '@fortawesome/free-solid-svg-icons';
import type { Meta, StoryObj } from '@storybook/react';
import { type ReactNode, useState } from 'react';
import * as THREE from 'three';
// Side-effect: registers the model-asset section contributions (Geometry,
// Animation, Materials, Source) into the inspector-section registry.
import '@volter/editor-core/authoring/model-asset-inspector-section';
import { ingestCoverageSection } from '@volter/editor-sdk/kit/CapabilityCoverageSection';
import { InspectionProjectionView } from '@volter/editor-core/components/InspectionProjection';
import { AuthoringInspectorSurface } from '@volter/editor-core/components/Inspector';
import { deriveCapabilityCoverage } from '../host/coverage/capability-coverage';
import { createAuthoringFixture } from '../host/design-system-stories/fixtures/authoring';
import { StoryEditorRuntime, storyThreeStore } from '../host/design-system-stories/fixtures/editor-runtime';
import type { InspectionSection, InspectionSubject } from '@volter/editor-sdk/kit/inspection-model';
import {
  AlignmentGrid,
  type AlignmentValue,
  AnchorPresets,
  BorderEditor,
  BorderRadiusEditor,
  type BorderRadiusValue,
  type BorderValue,
  ColorPicker,
  DEFAULT_SHADOW,
  FilterEditor,
  GradientEditor,
  type GradientValue,
  parseFilterFunctions,
  ScrubbableInput,
  ShadowEditor,
  type ShadowValue,
  uniformBorder,
  uniformRadius,
} from '@volter/editor-sdk/widgets';

/** The narrow column's target width. `overflow: hidden` so a body that was
 *  built wider than the rail SPILLS visibly instead of scrolling. */
const RAIL_WIDTH = 300;
function RailColumn({ children }: { readonly children: ReactNode }) {
  return (
    <div
      style={{
        width: RAIL_WIDTH,
        height: 600,
        display: 'flex',
        border: '1px solid var(--vgai-border-2)',
        borderRadius: 8,
        overflow: 'hidden',
        background: 'var(--vgai-bg-1)',
      }}
    >
      {children}
    </div>
  );
}

function customSection(
  id: string,
  title: string,
  icon: InspectionSection['icon'],
  order: number,
  body: ReactNode,
): InspectionSection {
  return { id, title, icon, order, body: { kind: 'custom', render: () => body } };
}

function columnSubject(input: {
  readonly id: string;
  readonly title: string;
  readonly kindLabel: string;
  readonly sections: readonly InspectionSection[];
}): InspectionSubject {
  return {
    id: input.id,
    title: input.title,
    identity: { rename: { readOnly: false, set: () => undefined }, kindLabel: input.kindLabel },
    presentation: { preferred: 'column' },
    quickActions: [],
    related: [],
    sections: input.sections,
  };
}

// ---- CSS editors (real widget bodies) ------------------------------------

function StyleBody() {
  const [color, setColor] = useState('#12203a');
  const [border, setBorder] = useState<BorderValue>(
    uniformBorder({ width: 1, style: 'solid', color: '#4f8cff' }),
  );
  const [radius, setRadius] = useState<BorderRadiusValue>(uniformRadius(8));
  return (
    <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <ColorPicker value={color} onChange={setColor} onChangeEnd={setColor} />
      <BorderEditor value={border} onChange={setBorder} onChangeEnd={setBorder} />
      <BorderRadiusEditor value={radius} onChange={setRadius} onChangeEnd={setRadius} />
    </div>
  );
}

function FillBody() {
  const [gradient, setGradient] = useState<GradientValue>({
    type: 'linear',
    angle: 180,
    stops: [
      { color: '#ff7f50', position: 0 },
      { color: '#4f8cff', position: 1 },
    ],
  });
  return (
    <div style={{ padding: 8 }}>
      <GradientEditor value={gradient} onChange={setGradient} onChangeEnd={setGradient} />
    </div>
  );
}

function EffectsBody() {
  const [shadows, setShadows] = useState<ShadowValue[]>([DEFAULT_SHADOW]);
  const [filter, setFilter] = useState(parseFilterFunctions('blur(4px) saturate(120%)'));
  return (
    <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <ShadowEditor value={shadows} onChange={setShadows} onChangeEnd={setShadows} />
      <FilterEditor value={filter} onChange={setFilter} onChangeEnd={setFilter} />
    </div>
  );
}

function LayoutBody() {
  const [alignment, setAlignment] = useState<AlignmentValue>({
    justify: 'center',
    align: 'center',
  });
  return (
    <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <AlignmentGrid value={alignment} onChange={setAlignment} />
      <AnchorPresets onSelect={() => undefined} />
    </div>
  );
}

function PositionBody() {
  const [x, setX] = useState(0);
  const [y, setY] = useState(0);
  const [w, setW] = useState(240);
  const [h, setH] = useState(64);
  return (
    <div
      style={{
        padding: 8,
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 6,
      }}
    >
      <ScrubbableInput label="X" value={x} unit="px" onChange={setX} onChangeEnd={setX} />
      <ScrubbableInput label="Y" value={y} unit="px" onChange={setY} onChangeEnd={setY} />
      <ScrubbableInput label="W" value={w} unit="px" onChange={setW} onChangeEnd={setW} />
      <ScrubbableInput label="H" value={h} unit="px" onChange={setH} onChangeEnd={setH} />
    </div>
  );
}

const cssSubject = columnSubject({
  id: 'dom:header-bar',
  title: 'HeaderBar',
  kindLabel: 'div · react',
  sections: [
    customSection('group:style', 'Style', faPalette, 2000, <StyleBody />),
    customSection('group:fill', 'Fill', faPalette, 2100, <FillBody />),
    customSection('group:effects', 'Effects', faPalette, 2200, <EffectsBody />),
    customSection('group:layout', 'Layout', faPalette, 2300, <LayoutBody />),
    customSection('group:position', 'Position', faPalette, 2400, <PositionBody />),
  ],
});

// ---- Ingest coverage (the real composed section) -------------------------

const coverageReport = deriveCapabilityCoverage({
  worldId: 'wild-three-game',
  reach: UNCAPTURED_REACH,
  surface: 'three',
  reachMechanism:
    "the game's own three was unreachable or version-mismatched at mount, so nothing was captured",
  loop: {
    verdict: 'gated',
    evidence: {
      pendingWhileHeld: 1,
      firedWhileHeld: 0,
      progressBefore: 412,
      progressAfter: 412,
      windowMs: 1500,
    },
  },
  loopReason: 'verified: one scheduled callback withheld and no draw advanced',
  contract: {
    declared: true,
    root: true,
    start: false,
    pause: true,
    resume: true,
    systems: { commands: ['level.quickStart', 'hud.message'], state: ['player', 'runtime'] },
  },
  ownership: { writable: false, reason: 'vendored upstream bytes are locked' },
  dataWriter: null,
  writeReach: null,
  systemAdapters: [
    { slot: 'physics', state: 'unanswered' },
    {
      slot: 'networking',
      state: 'empty',
      evidence: 'no socket, peer or state-fetch call anywhere in the game source',
    },
    { slot: 'navigation', state: 'bound' },
    { slot: 'audio', state: 'bound' },
    { slot: 'camera', state: 'bound' },
    { slot: 'debug', state: 'bound' },
    { slot: 'renderDebug', state: 'bound' },
  ],
  projectVerbs: [
    {
      slot: 'export',
      state: 'absent',
      evidence: 'every root this project declares is an ingest root',
      missing: 'this game can never leave the editor',
      fix: 'there is no mechanism today — the export path supports only built-in three roots',
    },
  ],
});

const coverageSubject = columnSubject({
  id: 'game:wild-three-game',
  title: 'wild-three-game',
  kindLabel: 'Ingested game',
  sections: [ingestCoverageSection(coverageReport)],
});

// ---- Composed-subject fixtures (real adapters) ---------------------------

/** A real THREE model scene → the source-object3d model adapter, the same
 *  fixture the model-asset workflow exercises. */
function buildModelAdapter(store: ConstructorParameters<typeof SourceObject3DAuthoringAdapter>[0]) {
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  root.name = 'Ship';
  const material = new THREE.MeshStandardMaterial({ color: 0x884422 });
  material.name = 'Hull';
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), material);
  mesh.name = 'Hull mesh';
  root.add(mesh);
  root.animations = [
    new THREE.AnimationClip('Hover', 2, [
      new THREE.VectorKeyframeTrack('Ship.position', [0, 2], [0, 0, 0, 0, 1, 0]),
    ]),
  ];
  scene.add(root);
  return new SourceObject3DAuthoringAdapter(store, scene, {
    documentId: 'ship.glb',
    title: 'ship.glb',
    sourcePath: '/models/ship.glb',
    documentKind: 'asset',
    modelSource: { kind: 'project-file', path: '/models/ship.glb' },
  });
}

const meta = {
  title: 'Design System/Product Systems/Inspector Narrow Bodies',
  parameters: { controls: { disable: true }, layout: 'centered' },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

/** (1) react/DOM CSS editors — the real border/gradient/shadow/filter/alignment
 *  widgets, at rail width. */
export const CssEditorsColumn: Story = {
  render: () => (
    <RailColumn>
      <InspectionProjectionView subject={cssSubject} presentation="column" surface="dom" />
    </RailColumn>
  ),
};

/** (2) The real ingest coverage section. */
export const IngestCoverageColumn: Story = {
  render: () => (
    <RailColumn>
      <InspectionProjectionView subject={coverageSubject} presentation="column" surface="three" />
    </RailColumn>
  ),
};

/** (3) Typed-three grouped descriptor bodies — a real composed mesh subject
 *  (Material / Gameplay groups + loose fields). */
export const TypedThreeGroupsColumn: Story = {
  render: () => {
    const adapter = createAuthoringFixture();
    return (
      <StoryEditorRuntime>
        {(runtime) => (
          <RailColumn>
            <AuthoringInspectorSurface
              store={runtime.store}
              adapter={adapter}
              documentSelection={{ adapter, nodeId: 'player' }}
              presentation="column"
              surface="three"
            />
          </RailColumn>
        )}
      </StoryEditorRuntime>
    );
  },
};

/** (4) Model-asset sections — a real composed subject (Geometry / Animation /
 *  Materials / Source) from a hand-authored THREE scene. */
export const ModelAssetColumn: Story = {
  render: () => (
    <StoryEditorRuntime>
      {(runtime) => {
        const adapter = buildModelAdapter(storyThreeStore(runtime));
        return (
          <RailColumn>
            <AuthoringInspectorSurface
              store={runtime.store}
              adapter={adapter}
              documentSelection={{ adapter, nodeId: adapter.documentId }}
              presentation="column"
              surface="asset-lab"
            />
          </RailColumn>
        );
      }}
    </StoryEditorRuntime>
  ),
};
