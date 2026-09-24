// The section's own styles travel with it: the kit's `editor-styles.css` may
// not @import a package's stylesheet (it would name a package), so the module
// that draws them imports them.
import './model-asset-inspector-section.css';
import {
  inspectModel,
  inspectModelRig,
  inspectObject3DNode,
  type ModelInspection,
  type ModelRigInspection,
  modelSelectionObjects,
  type Object3DNodeInspection,
} from '@volter/editor-core/asset-workflow/model-inspection';
import { setAuthoringSelection } from '@volter/editor-core/authoring/consumer-actions';
import { SourceObject3DAuthoringAdapter } from '@volter/editor-core/authoring/source-object3d-authoring-adapter';
import { openToolDocument } from '@volter/editor-core/components/tool-documents';
import { useEditorStore } from '@volter/editor-core/editor-runtime';
import { createHmrRegistrationGroup } from '@volter/editor-core/hmr-registration-group';
import {
  CONTRIBUTED_SECTION_ORDER,
  type InspectionSection,
  PROPERTIES_SECTION_ID,
} from '@volter/editor-core/inspection/model';
import { registerInspectorSections } from '@volter/editor-core/inspector-section-registry';
import {
  type ProjectOutputProvenance,
  provenanceForProjectAsset,
} from '@volter/editor-core/project-provenance';
import {
  getDocumentToolContributions,
  getGlobalToolContributions,
  subscribeToolContributions,
} from '@volter/editor-core/tool-loader';
import type { AuthoringAdapter, EditorNode } from '@volter/editor-project/adapter';
import { object3DAuthoringSubjectOf } from '@volter/threejs-runtime/adapter/object3d-authoring-subject';
import { getUserData } from '@volter/threejs-runtime/ecs/user-data';
import {
  faBone,
  faCircleNodes,
  faCube,
  faDiagramProject,
  faFileLines,
  faPalette,
  faPersonRunning,
} from '@fortawesome/free-solid-svg-icons';
import type { SplatMesh } from '@sparkjsdev/spark';
import {
  Button,
  EditorBanner,
  EditorIcon,
  EditorSurface,
  editorIcons,
  FieldGroup,
  FieldRow,
  StateSurface,
  Text,
  TextInput,
} from '@volter/editor-sdk/widgets';
import { useEffect, useState, useSyncExternalStore } from 'react';
import * as THREE from 'three';

function isObject3DModelDocument(node: EditorNode | null, adapter: AuthoringAdapter): boolean {
  return adapter instanceof SourceObject3DAuthoringAdapter && node?.id === adapter.documentId;
}

function isObject3DModelNode(node: EditorNode | null, adapter: AuthoringAdapter): boolean {
  return (
    adapter instanceof SourceObject3DAuthoringAdapter &&
    node !== null &&
    node.id !== adapter.documentId
  );
}

function Readout({
  children,
  code = false,
}: {
  readonly children: React.ReactNode;
  readonly code?: boolean;
}) {
  return (
    <Text
      variant={code ? 'code' : 'body'}
      selectable
      truncate
      title={typeof children === 'string' ? children : undefined}
    >
      {children}
    </Text>
  );
}

function findSplat(root: THREE.Object3D | null): SplatMesh | null {
  let found: SplatMesh | null = null;
  root?.traverse((object) => {
    if (!found && getUserData(object, 'gaussianSplat')) found = object as SplatMesh;
  });
  return found;
}

function SplatBody({ splat }: { readonly splat: SplatMesh }) {
  const metadata = getUserData(splat, 'gaussianSplat')!;
  const size = splat.getBoundingBox().getSize(new THREE.Vector3());
  return (
    <FieldGroup>
      <FieldRow label="Gaussians">
        <Readout>{metadata.numSplats.toLocaleString()}</Readout>
      </FieldRow>
      <FieldRow label="Format">
        <Readout>SPZ</Readout>
      </FieldRow>
      <FieldRow label="Bounds">
        <Readout>{`${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)}`}</Readout>
      </FieldRow>
      <FieldRow label="Level of detail">
        <Readout>Full source</Readout>
      </FieldRow>
      <FieldRow label="Picking">
        <Readout>Gaussian raycast</Readout>
      </FieldRow>
      <FieldRow
        label="Collision"
        hint="Gaussian splats are visual environment data; use a separate mesh collider."
      >
        <Readout>Separate collider required</Readout>
      </FieldRow>
    </FieldGroup>
  );
}

function GeometryBody({
  inspection,
  rig,
}: {
  readonly inspection: ModelInspection | null;
  readonly rig: ModelRigInspection | null;
}) {
  if (!inspection) {
    return (
      <StateSurface
        compact
        tone="error"
        title="Model unavailable"
        description="The native Object3D graph could not be inspected."
      />
    );
  }
  const issues = [
    ...(inspection.meshes === 0 ? ['The asset has no renderable geometry.'] : []),
    ...(inspection.geometry.nonFiniteAttributeValues > 0
      ? [
          `${inspection.geometry.nonFiniteAttributeValues.toLocaleString()} non-finite geometry values can break bounds and selection.`,
        ]
      : []),
    ...(rig && !rig.valid ? ['Rig or animation bindings require attention.'] : []),
  ];
  // No header of its own — every block in this file is an identified
  // SECTION now, and the PROJECTION heads each one with its title and icon
  // (`components/InspectionProjection.tsx`).
  return (
    <>
      {issues.length > 0 && (
        <EditorBanner tone="warning" icon={<EditorIcon icon={editorIcons.status.warning} />}>
          <div>
            {issues.map((issue) => (
              <div key={issue}>{issue}</div>
            ))}
          </div>
        </EditorBanner>
      )}
      <FieldGroup>
        <FieldRow label="Meshes">
          <Readout>{inspection.meshes.toLocaleString()}</Readout>
        </FieldRow>
        <FieldRow label="Primitives">
          <Readout>{inspection.primitives.toLocaleString()}</Readout>
        </FieldRow>
        <FieldRow label="Vertices">
          <Readout>{inspection.vertices.toLocaleString()}</Readout>
        </FieldRow>
        <FieldRow label="Triangles">
          <Readout>{inspection.triangles.toLocaleString()}</Readout>
        </FieldRow>
        <FieldRow label="Indexing">
          <Readout>
            {inspection.geometry.indexedMeshes} indexed · {inspection.geometry.nonIndexedMeshes}{' '}
            non-indexed
          </Readout>
        </FieldRow>
        <FieldRow label="Attributes">
          <Readout>
            {inspection.geometry.attributes.map((attribute) => attribute.name).join(', ') || 'None'}
          </Readout>
        </FieldRow>
        <FieldRow label="UV channels">
          <Readout>{inspection.geometry.uvChannels.join(', ') || 'None'}</Readout>
        </FieldRow>
        <FieldRow label="Morph targets">
          <Readout>{inspection.morphTargets}</Readout>
        </FieldRow>
        <FieldRow label="Bounds">
          <Readout>
            {inspection.bounds
              ? `${inspection.bounds.x.toFixed(2)} × ${inspection.bounds.y.toFixed(2)} × ${inspection.bounds.z.toFixed(2)}`
              : 'None'}
          </Readout>
        </FieldRow>
        <FieldRow label="GPU estimate">
          <Readout>{(inspection.memoryBytes / 1_048_576).toFixed(2)} MiB</Readout>
        </FieldRow>
        <FieldRow label="Invalid values">
          <Text tone={inspection.geometry.nonFiniteAttributeValues ? 'warning' : 'muted'}>
            {inspection.geometry.nonFiniteAttributeValues.toLocaleString()}
          </Text>
        </FieldRow>
        <FieldRow label="LODs">
          <Readout>
            {inspection.geometry.lodGroups
              ? `${inspection.geometry.lodLevels} levels`
              : 'Not authored'}
          </Readout>
        </FieldRow>
        <FieldRow
          label="Collision"
          hint="Collision remains a source/import operation when no model metadata exists."
        >
          <Readout>Not authored</Readout>
        </FieldRow>
      </FieldGroup>
    </>
  );
}

function RigBody({ rig }: { readonly rig: ModelRigInspection }) {
  const problems = [
    ['Non-normalized weights', rig.nonNormalizedVertices],
    ['Zero-weight vertices', rig.zeroWeightVertices],
    ['Invalid joint indices', rig.invalidJointIndices],
    ['Inverse-bind mismatches', rig.inverseBindMismatches],
    ['External bones', rig.externalBones],
    ['Non-finite animation values', rig.nonFiniteAnimationValues],
    ['Unresolved track targets', rig.unresolvedTrackTargets.length],
  ] as const;
  return (
    <>
      {!rig.valid && (
        <EditorBanner tone="warning" icon={<EditorIcon icon={editorIcons.status.warning} />}>
          Review the non-zero integrity checks below.
        </EditorBanner>
      )}
      <FieldGroup>
        <FieldRow label="Deformation">
          <Readout>{rig.kind === 'skinned' ? 'Skinned mesh' : 'Rigid attachments'}</Readout>
        </FieldRow>
        <FieldRow label="Bones">
          <Readout>{rig.uniqueBones}</Readout>
        </FieldRow>
        <FieldRow label="Root bones">
          <Readout>{rig.rootBones.join(', ') || 'None'}</Readout>
        </FieldRow>
        {rig.kind === 'skinned' ? (
          <>
            <FieldRow label="Skeletons">
              <Readout>{rig.skeletons}</Readout>
            </FieldRow>
            <FieldRow label="Bind mode">
              <Readout>{rig.bindModes.join(', ') || 'None'}</Readout>
            </FieldRow>
            <FieldRow label="Weighted vertices">
              <Readout>{rig.weightedVertices.toLocaleString()}</Readout>
            </FieldRow>
          </>
        ) : null}
        {problems
          .filter(([, count]) => count > 0)
          .map(([label, count]) => (
            <FieldRow key={label} label={label}>
              <Text tone="warning">{count.toLocaleString()}</Text>
            </FieldRow>
          ))}
        {rig.unresolvedTrackTargets.length ? (
          <FieldRow label="Missing targets">
            <Readout>{rig.unresolvedTrackTargets.join(', ')}</Readout>
          </FieldRow>
        ) : null}
      </FieldGroup>
    </>
  );
}

function MaterialsBody({
  adapter,
  inspection,
}: {
  readonly adapter: SourceObject3DAuthoringAdapter;
  readonly inspection: ModelInspection | null;
}) {
  const [query, setQuery] = useState('');
  const root = adapter.documentRootObject;
  const materials = (inspection?.materialSlots ?? [])
    .map((material, sourceIndex) => ({
      material,
      // A loaded graph can contain distinct material objects carrying the same
      // serialized UUID. The UUID remains the selection identity, while the
      // traversal slot disambiguates React rows without changing that meaning.
      rowKey: `${material.id}:${sourceIndex}`,
    }))
    .filter(({ material }) =>
      `${material.name} ${material.type} ${material.textureSlots.join(' ')}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
    );
  const inspectMaterialUser = (materialId: string) => {
    if (!root) return;
    const firstUser = modelSelectionObjects(root, { kind: 'material', id: materialId })[0];
    const firstUserId = firstUser ? adapter.hierarchy.idForObject3D?.(firstUser) : null;
    if (firstUserId) setAuthoringSelection(adapter, [firstUserId]);
  };
  return (
    <>
      <FieldGroup>
        <FieldRow label="Filter" htmlFor="model-material-filter">
          <TextInput
            id="model-material-filter"
            type="search"
            value={query}
            placeholder="Name, type, or map"
            onChange={(event) => setQuery(event.target.value)}
          />
        </FieldRow>
      </FieldGroup>
      <div className="vgai-model-inspector-list">
        {materials.map(({ material, rowKey }) => (
          <EditorSurface key={rowKey} variant="raised" border className="vgai-model-inspector-row">
            <span
              className="vgai-model-material-swatch"
              style={{ background: material.color ?? undefined }}
              aria-hidden="true"
            />
            <div>
              <Text as="strong" variant="label" truncate>
                {material.name}
              </Text>
              <Text variant="caption" tone="muted" truncate>
                {material.type} · {material.usageCount} object{material.usageCount === 1 ? '' : 's'}{' '}
                · {material.textureSlots.join(', ') || 'no maps'}
                {material.transparent ? ' · transparent' : ''}
              </Text>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="compact"
              onClick={() => inspectMaterialUser(material.id)}
            >
              Inspect
            </Button>
          </EditorSurface>
        ))}
        {materials.length === 0 ? <StateSurface compact title="No matching materials" /> : null}
      </div>
    </>
  );
}

function SourceBody({
  adapter,
  provenance,
  provenanceLoaded,
}: {
  readonly adapter: SourceObject3DAuthoringAdapter;
  readonly provenance: ProjectOutputProvenance | null;
  readonly provenanceLoaded: boolean;
}) {
  const store = useEditorStore();
  useSyncExternalStore(subscribeToolContributions, getGlobalToolContributions);
  const sourceContribution = provenance
    ? getDocumentToolContributions().find(
        (contribution) => contribution.tool?.name === provenance.operationName,
      )
    : undefined;
  return (
    <>
      {sourceContribution ? (
        <div className="vgai-model-inspector-actions">
          <Button
            type="button"
            variant="ghost"
            size="compact"
            onClick={() => openToolDocument(store, sourceContribution.id)}
          >
            Open Source
          </Button>
        </div>
      ) : null}
      <FieldGroup>
        <FieldRow label="Path">
          <Readout code>{adapter.options.sourcePath}</Readout>
        </FieldRow>
        <FieldRow label="Truth">
          <Readout>{adapter.provenance.label}</Readout>
        </FieldRow>
        <FieldRow label="Ownership" hint={adapter.provenance.detail}>
          <Readout>{adapter.provenance.source}</Readout>
        </FieldRow>
        {!provenanceLoaded ? (
          <FieldRow label="Provenance">
            <Readout>Loading…</Readout>
          </FieldRow>
        ) : null}
        {provenance ? (
          <>
            <FieldRow label="Generated by">
              <Readout>{provenance.operationName}</Readout>
            </FieldRow>
            <FieldRow label="Tool">
              <Readout code>{provenance.operationSource ?? 'Not recorded'}</Readout>
            </FieldRow>
            <FieldRow label="Generated">
              <Readout>{new Date(provenance.createdAt).toLocaleString()}</Readout>
            </FieldRow>
            <FieldRow label="Output hash">
              <Readout code>{provenance.output.sha256}</Readout>
            </FieldRow>
          </>
        ) : provenanceLoaded ? (
          <FieldRow label="Provenance">
            <Readout>Not recorded</Readout>
          </FieldRow>
        ) : null}
      </FieldGroup>
    </>
  );
}

/** Cached per ROOT OBJECT (`null` = this root has no summary to tell), because
 *  the composer reads a section's description on every inspector render and
 *  `inspectModel` walks the whole graph. Same freshness the body already
 *  assumes — its `useMemo` is keyed on the root too. */
const modelSummaryByRoot = new WeakMap<THREE.Object3D, string | null>();

/**
 * The model SUMMARY a document's section carries as its description ("1 meshes
 * · 12 triangles") — the line the body's own header used to print beside a
 * second copy of the section's title.
 *
 * A Gaussian splat document has no mesh/triangle story to tell (its own
 * `Gaussian Splat` block carries the numbers), so it gets no description
 * rather than a fabricated "1 meshes · 0 triangles".
 */
function modelDocumentDescription(adapter: AuthoringAdapter): string | undefined {
  const root = (adapter as SourceObject3DAuthoringAdapter).documentRootObject ?? null;
  if (!root) return undefined;
  const cached = modelSummaryByRoot.get(root);
  if (cached !== undefined) return cached ?? undefined;
  const inspection = findSplat(root) ? null : inspectModel(root);
  const summary = inspection
    ? `${inspection.meshes} meshes · ${inspection.triangles.toLocaleString()} triangles`
    : null;
  modelSummaryByRoot.set(root, summary);
  return summary ?? undefined;
}

/**
 * The Source block's async half — asset PROVENANCE, which is a fetch. It is
 * its own component so the Source section's body owns its loading state
 * without any other section re-rendering for it.
 */
export function ModelSourceSection({ adapter }: { adapter: AuthoringAdapter }) {
  const modelAdapter = adapter as SourceObject3DAuthoringAdapter;
  const [provenance, setProvenance] = useState<ProjectOutputProvenance | null>(null);
  const [provenanceLoaded, setProvenanceLoaded] = useState(false);
  const modelSource = modelAdapter.options.modelSource;
  const assetPath = modelSource?.kind === 'project-file' ? modelSource.path : null;

  useEffect(() => {
    let cancelled = false;
    setProvenanceLoaded(false);
    if (!assetPath) {
      setProvenance(null);
      setProvenanceLoaded(true);
      return;
    }
    void provenanceForProjectAsset(assetPath).then(
      (resolved) => {
        if (!cancelled) {
          setProvenance(resolved);
          setProvenanceLoaded(true);
        }
      },
      () => {
        if (!cancelled) {
          setProvenance(null);
          setProvenanceLoaded(true);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [assetPath]);

  return (
    <div data-testid="model-asset-inspector">
      <SourceBody
        adapter={modelAdapter}
        provenance={provenance}
        provenanceLoaded={provenanceLoaded}
      />
    </div>
  );
}

function NativeObjectBody({ inspection }: { readonly inspection: Object3DNodeInspection }) {
  return (
    <FieldGroup>
      <FieldRow label="Native type">
        <Readout>{inspection.type}</Readout>
      </FieldRow>
      <FieldRow label="Visible">
        <Readout>{inspection.visible ? 'Yes' : 'No'}</Readout>
      </FieldRow>
      <FieldRow label="Children">
        <Readout>{inspection.children}</Readout>
      </FieldRow>
      <FieldRow label="Descendants">
        <Readout>{inspection.descendants}</Readout>
      </FieldRow>
      <FieldRow label="Render order">
        <Readout>{inspection.renderOrder}</Readout>
      </FieldRow>
      <FieldRow label="Layer mask">
        <Readout code>0x{inspection.layers.toString(16)}</Readout>
      </FieldRow>
    </FieldGroup>
  );
}

function NativeGeometryBody({
  geometry,
}: {
  readonly geometry: NonNullable<Object3DNodeInspection['geometry']>;
}) {
  return (
    <>
      {geometry.nonFiniteAttributeValues ? (
        <EditorBanner tone="warning">
          {geometry.nonFiniteAttributeValues.toLocaleString()} non-finite buffer values can break
          bounds, picking, and selection outlines.
        </EditorBanner>
      ) : null}
      <FieldGroup>
        <FieldRow label="Vertices">
          <Readout>{geometry.vertices.toLocaleString()}</Readout>
        </FieldRow>
        <FieldRow label="Triangles">
          <Readout>{geometry.triangles.toLocaleString()}</Readout>
        </FieldRow>
        <FieldRow label="Index buffer">
          <Readout>{geometry.indexed ? 'Indexed' : 'Non-indexed'}</Readout>
        </FieldRow>
        <FieldRow label="Attributes">
          <Readout>{geometry.attributes.join(', ')}</Readout>
        </FieldRow>
        <FieldRow label="UV channels">
          <Readout>{geometry.uvChannels.join(', ') || 'None'}</Readout>
        </FieldRow>
        <FieldRow label="Morph targets">
          <Readout>{geometry.morphTargets}</Readout>
        </FieldRow>
        <FieldRow label="Invalid values">
          <Text tone={geometry.nonFiniteAttributeValues ? 'warning' : 'muted'}>
            {geometry.nonFiniteAttributeValues.toLocaleString()}
          </Text>
        </FieldRow>
      </FieldGroup>
    </>
  );
}

function NativeMaterialsBody({
  materials,
}: {
  readonly materials: Object3DNodeInspection['materials'];
}) {
  return (
    <div className="vgai-model-inspector-list">
      {materials.map((material) => (
        <EditorSurface
          key={material.id}
          variant="raised"
          border
          className="vgai-model-inspector-row"
        >
          <span
            className="vgai-model-material-swatch"
            style={{ background: material.color ?? undefined }}
            aria-hidden="true"
          />
          <div>
            <Text as="strong" variant="label" truncate>
              {material.name}
            </Text>
            <Text variant="caption" tone="muted" truncate>
              {material.type} · {material.textureSlots.join(', ') || 'no maps'}
            </Text>
          </div>
        </EditorSurface>
      ))}
    </div>
  );
}

function NativeSkinBody({ skin }: { readonly skin: NonNullable<Object3DNodeInspection['skin']> }) {
  return (
    <FieldGroup>
      <FieldRow label="Bones">
        <Readout>{skin.bones}</Readout>
      </FieldRow>
      <FieldRow label="Root bones">
        <Readout>{skin.rootBones.join(', ') || 'None'}</Readout>
      </FieldRow>
      <FieldRow label="Bind mode">
        <Readout>{skin.bindMode}</Readout>
      </FieldRow>
    </FieldGroup>
  );
}

function NativeBoneBody({ bone }: { readonly bone: NonNullable<Object3DNodeInspection['bone']> }) {
  return (
    <FieldGroup>
      <FieldRow label="Parent">
        <Readout>{bone.parent ?? 'Skeleton root'}</Readout>
      </FieldRow>
      <FieldRow label="Children">
        <Readout>{bone.children.join(', ') || 'None'}</Readout>
      </FieldRow>
    </FieldGroup>
  );
}

/** One block of an asset document's inspection, as an identified section.
 *  The orders are spaced on the model's own scale so the whole set sits after
 *  the built-ins and keeps a stable, meaningful reading order. */
const MODEL_SECTION_ORDER = {
  splat: CONTRIBUTED_SECTION_ORDER,
  geometry: CONTRIBUTED_SECTION_ORDER + 10,
  rig: CONTRIBUTED_SECTION_ORDER + 20,
  // +25 is the RAGDOLL's, and it is `@volter/editor-game`'s
  // (`contributions/ragdoll.inspector.tsx`, `export const order = 25`) — a
  // contributed section's order is this same base plus what it declares, so
  // the slot after Rig is held from there.
  materials: CONTRIBUTED_SECTION_ORDER + 40,
  source: CONTRIBUTED_SECTION_ORDER + 50,
} as const;

/** Node inspections are cheap but not free, and the composer runs on every
 *  inspector render. Cached by the root/object it describes, so a rebuilt
 *  graph is a fresh entry. */
const modelByRoot = new WeakMap<THREE.Object3D, ModelInspection>();
const rigByRoot = new WeakMap<THREE.Object3D, ModelRigInspection>();
const nodeByObject = new WeakMap<THREE.Object3D, Object3DNodeInspection>();

function cached<T>(store: WeakMap<THREE.Object3D, T>, key: THREE.Object3D, make: () => T): T {
  const hit = store.get(key);
  if (hit !== undefined) return hit;
  const made = make();
  store.set(key, made);
  return made;
}

/**
 * An asset document's own sections — Rig, Animation, Materials, Geometry,
 * Source — each identified, ordered and headed like every other section in
 * the box.
 *
 * They used to be one section called "Model" whose body printed all of them
 * under private sub-headers, which meant the card had a single "Model" tab
 * hiding six blocks while a scene node got a tab each. "Everything I click on
 * in the asset lab should basically have the same inspector as if I clicked
 * on it in the scene" (owner, 2026-08-07) — so they are sections, and the
 * word only survives where it is a TYPE: the document root's `typeLabel`
 * ("Rigged model") on the identity row.
 *
 * The mesh/triangle summary lives on GEOMETRY's description, which is the
 * honest home: meshes and triangles are geometry facts, and the row above
 * already says what kind of thing the document is.
 */
function modelDocumentSections(adapter: AuthoringAdapter): InspectionSection[] {
  const modelAdapter = adapter as SourceObject3DAuthoringAdapter;
  const root = modelAdapter.documentRootObject;
  const sections: InspectionSection[] = [];
  const splat = findSplat(root);
  if (root && splat) {
    const metadata = getUserData(splat, 'gaussianSplat')!;
    sections.push({
      id: 'splat',
      title: 'Gaussian Splat',
      icon: faCircleNodes,
      order: MODEL_SECTION_ORDER.splat,
      description: `${metadata.numSplats.toLocaleString()} Gaussians · native SPZ`,
      body: { kind: 'custom', render: () => <SplatBody splat={splat} /> },
    });
  } else if (root) {
    const inspection = cached(modelByRoot, root, () => inspectModel(root));
    const rig = cached(rigByRoot, root, () => inspectModelRig(root));
    const description = modelDocumentDescription(adapter);
    sections.push({
      // Claims the descriptor channel: geometry IS this document root's
      // properties, presented richly.
      id: PROPERTIES_SECTION_ID,
      title: 'Geometry',
      icon: faCube,
      order: MODEL_SECTION_ORDER.geometry,
      // Omitted rather than written as `undefined` (the model is
      // `exactOptionalPropertyTypes`).
      ...(description ? { description } : {}),
      body: { kind: 'custom', render: () => <GeometryBody inspection={inspection} rig={rig} /> },
    });
    if (rig.skinnedMeshes > 0 || rig.uniqueBones > 0) {
      sections.push({
        id: 'rig',
        title: 'Rig',
        icon: faPersonRunning,
        order: MODEL_SECTION_ORDER.rig,
        description:
          rig.kind === 'skinned'
            ? `${rig.uniqueBones} bones · ${rig.skinnedMeshes} skinned meshes`
            : `${rig.uniqueBones} bones · rigid hierarchy`,
        body: { kind: 'custom', render: () => <RigBody rig={rig} /> },
      });
    }
    sections.push({
      id: 'materials',
      title: 'Materials',
      icon: faPalette,
      order: MODEL_SECTION_ORDER.materials,
      description: `${inspection.materials} materials`,
      body: {
        kind: 'custom',
        render: () => <MaterialsBody adapter={modelAdapter} inspection={inspection} />,
      },
    });
  }
  sections.push({
    id: 'source',
    title: 'Source',
    icon: faFileLines,
    order: MODEL_SECTION_ORDER.source,
    description: modelAdapter.provenance.label,
    defaultOpen: false,
    body: { kind: 'custom', render: () => <ModelSourceSection adapter={adapter} /> },
  });
  // A document that declined the import audit (`audit: false` — the mesh
  // document, which carries its own Data and Modifiers panels) keeps its
  // materials and rig readouts and drops the Geometry block and
  // the Source row: Blender's Object Data tab is the mesh's own, not an
  // importer's report (owner-sighted 2026-09-04: "half filled with Geometry").
  if (modelAdapter.options.audit === false) {
    return sections.filter(
      (section) => section.id !== PROPERTIES_SECTION_ID && section.id !== 'source',
    );
  }
  return sections;
}

/** A PART inside an asset document — a mesh, a bone, a group. Its native
 *  readouts are sections for the same reason the document's are: what you
 *  clicked decides the data, and each block of that data is its own named,
 *  glyphed thing. */
function object3dNodeSections(node: EditorNode | null, adapter: AuthoringAdapter) {
  const object = node ? adapter.hierarchy.object3D?.(node.id) : null;
  if (!object) return [];
  // A native subject proxy already describes itself through the adapter's
  // ordinary field currency. Treating its visualization mesh as model
  // geometry would replace those native fields with irrelevant triangle and
  // material readouts.
  if (object3DAuthoringSubjectOf(object)) return [];
  const inspection = cached(nodeByObject, object, () => inspectObject3DNode(object));
  const sections: InspectionSection[] = [
    {
      // The rich presentation of this node's own properties.
      id: PROPERTIES_SECTION_ID,
      title: 'Object',
      icon: faDiagramProject,
      order: MODEL_SECTION_ORDER.geometry,
      description: inspection.type,
      body: { kind: 'custom', render: () => <NativeObjectBody inspection={inspection} /> },
    },
  ];
  const geometry = inspection.geometry;
  if (geometry) {
    sections.push({
      id: 'geometry',
      title: 'Geometry',
      icon: faCube,
      order: MODEL_SECTION_ORDER.geometry + 1,
      description: `${geometry.triangles.toLocaleString()} triangles`,
      body: { kind: 'custom', render: () => <NativeGeometryBody geometry={geometry} /> },
    });
  }
  if (inspection.materials.length > 0) {
    sections.push({
      id: 'materials',
      title: 'Materials',
      icon: faPalette,
      order: MODEL_SECTION_ORDER.materials,
      description: `${inspection.materials.length} slots`,
      body: {
        kind: 'custom',
        render: () => <NativeMaterialsBody materials={inspection.materials} />,
      },
    });
  }
  const skin = inspection.skin;
  if (skin) {
    sections.push({
      id: 'skin',
      title: 'Skin',
      icon: faPersonRunning,
      order: MODEL_SECTION_ORDER.rig,
      description: `${skin.bones} bones`,
      body: { kind: 'custom', render: () => <NativeSkinBody skin={skin} /> },
    });
  }
  const bone = inspection.bone;
  if (bone) {
    sections.push({
      id: 'bone',
      title: 'Bone',
      icon: faBone,
      order: MODEL_SECTION_ORDER.rig + 1,
      description: bone.parent ?? 'Skeleton root',
      body: { kind: 'custom', render: () => <NativeBoneBody bone={bone} /> },
    });
  }
  return sections;
}

const registrationGroup = createHmrRegistrationGroup(
  import.meta.hot,
  'model-asset-inspector-sections',
);

/**
 * Install this module's two section PRODUCERS. Called by
 * `contributions/model-asset-sections.service.ts`: the `selection.inspector`
 * point carries ONE component, and these register the multi-section producer
 * shape (`InspectorSectionsProducer`) instead — one for the Object3D model
 * document's whole rail, one for a node inside it. HMR-safe by the same group
 * that held the module-scope registration.
 */
export function ensureModelAssetSectionsRegistered(): void {
  registrationGroup.ensure((track) => {
    track(
      registerInspectorSections({
        match: isObject3DModelDocument,
        sections: (_node, adapter) => modelDocumentSections(adapter),
      }),
    );
    track(
      registerInspectorSections({
        match: isObject3DModelNode,
        sections: object3dNodeSections,
      }),
    );
  });
}
