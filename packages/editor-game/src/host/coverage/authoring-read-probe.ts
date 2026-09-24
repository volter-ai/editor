/**
 * Side-effect-free conformance probes for AuthoringAdapter reads.
 *
 * Writes, subscriptions, and gesture brackets are deliberately not exercised
 * here: status/coverage reads must not edit the project or perturb selection.
 * Those seams therefore remain unverified until a real consumer or Doctor's
 * transactional write walk records the stronger receipt.
 */

import type {
  AuthoringAdapter,
  EditorNode,
  SeamEvidenceReceipt,
  SeamProofStage,
} from '@volter/editor-project/adapter';

type ReadRecorder = (
  seam: string,
  stage: SeamProofStage,
  run: () => unknown,
  valid?: (value: unknown) => boolean,
) => unknown;

function reciprocalChildren(
  adapter: AuthoringAdapter,
  node: EditorNode,
): { readonly valid: boolean; readonly children: readonly EditorNode[] } {
  const children: EditorNode[] = [];
  let valid = true;
  for (const childId of node.childIds) {
    const child = adapter.hierarchy.node(childId);
    if (!child || child.parentId !== node.id) valid = false;
    else children.push(child);
  }
  return { valid, children };
}

/** Duck-typed rather than `instanceof THREE.Object3D`: this module is imported
 *  by headless Node suites and by the coverage service, and neither should pull
 *  three in to ask whether a value has the shape the seam promises. */
function isObject3DLike(value: unknown): value is object {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { isObject3D?: unknown }).isObject3D === true
  );
}

/** Sampled, not exhaustive — see {@link objectLookupReceipts}. */
const OBJECT_LOOKUP_SAMPLE = 64;

type SeamPush = (seam: string, outcome: 'pass' | 'fail', detail: string) => void;

/** `object3D` over the sample: every answer must be an Object3D or `null`, and
 *  the objects that came back are what the inverse lookup is then asked about. */
function probeObject3D(
  object3D: (id: string) => unknown,
  sample: readonly string[],
  push: SeamPush,
): { readonly objects: ReadonlyArray<{ readonly id: string; readonly object: object }> } {
  const objects: Array<{ readonly id: string; readonly object: object }> = [];
  let failure: string | null = null;
  for (const id of sample) {
    let answer: unknown;
    try {
      answer = object3D(id);
    } catch (error) {
      failure = `hierarchy.object3D threw on the walked node ${id}: ${
        error instanceof Error ? error.message : String(error)
      }`;
      break;
    }
    if (answer === null || answer === undefined) continue;
    if (!isObject3DLike(answer)) {
      failure = `hierarchy.object3D answered the walked node ${id} with a ${typeof answer} that is not an Object3D`;
      break;
    }
    objects.push({ id, object: answer });
  }
  push(
    'editor.hierarchy.object3D',
    failure ? 'fail' : 'pass',
    failure ??
      `hierarchy.object3D answered ${objects.length} of ${sample.length} walked node(s) with an Object3D and the rest with null`,
  );
  return { objects: failure ? [] : objects };
}

/**
 * One question to `idForObject3D`: `true` when it named a node this walk
 * listed, `null` when it answered `null` (legitimate — the object is not a
 * row), and the refusing SENTENCE when the answer disagrees with the walk.
 */
function askIdForObject3D(
  idForObject3D: (object: never) => unknown,
  id: string,
  object: object,
  walked: ReadonlySet<string>,
): true | null | string {
  let answer: unknown;
  try {
    answer = idForObject3D(object as never);
  } catch (error) {
    return `hierarchy.idForObject3D threw on the object hierarchy.object3D returned for ${id}: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }
  if (answer === null || answer === undefined) return null;
  if (typeof answer !== 'string' || !walked.has(answer)) {
    return `hierarchy.idForObject3D answered ${JSON.stringify(answer)} for the object hierarchy.object3D returned for ${id}, which is not a node this walk listed`;
  }
  return true;
}

/** The inverse, checked against the walk: `null`, or an id this walk listed. */
function probeIdForObject3D(
  idForObject3D: (object: never) => unknown,
  objects: ReadonlyArray<{ readonly id: string; readonly object: object }>,
  walked: ReadonlySet<string>,
  push: SeamPush,
): void {
  if (objects.length === 0) {
    push(
      'editor.hierarchy.idForObject3D',
      'fail',
      'hierarchy.idForObject3D could not be asked about anything: hierarchy.object3D handed back no Object3D for any walked node',
    );
    return;
  }
  let roundTripped = 0;
  let failure: string | null = null;
  for (const { id, object } of objects) {
    const answered = askIdForObject3D(idForObject3D, id, object, walked);
    if (answered === true) {
      roundTripped += 1;
      continue;
    }
    if (answered === null) continue;
    failure = answered;
    break;
  }
  if (!failure && roundTripped === 0) {
    failure = `hierarchy.idForObject3D answered null for all ${objects.length} object(s) hierarchy.object3D handed back, so nothing it returned could be checked against the walk`;
  }
  push(
    'editor.hierarchy.idForObject3D',
    failure ? 'fail' : 'pass',
    failure ??
      `hierarchy.idForObject3D named ${roundTripped} of ${objects.length} object(s) hierarchy.object3D returned with an id this walk listed`,
  );
}

/**
 * THE HIERARCHY'S TWO PURE LOOKUPS — `object3D` and its inverse
 * `idForObject3D` — verified the only way a pure lookup can be: CALL it and
 * check the answer against the walk that just ran.
 *
 * `idForObject3D` was declared `required: 'effect'` and could therefore never
 * be verified (`@volter/editor-project/adapter/authoring-seam-contract`'s note, and the
 * orchestrator's ruling of 2026-09-19): it has no side effect for a consumer
 * to record a receipt for, so the hierarchy CARRIER graded `unverified` on
 * every three adapter forever while printing a sentence that said the seam was
 * unproven. Both are `operation` now, and this is what proves them.
 *
 * What "checked against the walk" means, precisely:
 *  - `object3D(id)` must answer with an Object3D or `null` — `null` is the
 *    honest answer for a row with no object behind it (the composite's world
 *    and organization rows), so it is a pass, and the detail says how many
 *    rows answered with one.
 *  - `idForObject3D(o)`, asked about an object `object3D` itself handed back,
 *    must answer with `null` or with an id THE WALK SAW. A row the adapter
 *    projects through a spatial target it does not index answers `null`
 *    legitimately (`r3f-source-authoring-adapter`'s component boundaries);
 *    an id no node in this tree carries is the lookup disagreeing with the
 *    hierarchy, which is a real failure. At least one object must round-trip,
 *    or nothing it returned could be checked at all.
 *
 * Sampled, not exhaustive: a Money-Masters-class tree is tens of thousands of
 * rows and these two answers do not vary per row in a way a bigger sample
 * would reveal. The count is in the detail either way.
 */
function objectLookupReceipts(options: {
  readonly adapter: AuthoringAdapter;
  readonly subject: string;
  readonly epoch: string;
  readonly receipts: SeamEvidenceReceipt[];
  readonly walked: readonly string[];
}): void {
  const { adapter, subject, epoch, receipts, walked } = options;
  const { object3D, idForObject3D } = adapter.hierarchy;
  if (!object3D) return;
  const push: SeamPush = (seam, outcome, detail) => {
    receipts.push({
      seam,
      subject,
      epoch,
      stage: 'operation',
      outcome,
      source: 'conformance-probe',
      detail,
    });
  };
  const { objects } = probeObject3D(object3D, walked.slice(0, OBJECT_LOOKUP_SAMPLE), push);
  if (idForObject3D) probeIdForObject3D(idForObject3D, objects, new Set(walked), push);
}

function hierarchyReceipts(options: {
  readonly adapter: AuthoringAdapter;
  readonly subject: string;
  readonly epoch: string;
  readonly record: ReadRecorder;
  readonly receipts: SeamEvidenceReceipt[];
}): readonly EditorNode[] {
  const { adapter, subject, epoch, record, receipts } = options;
  const rootsValue = record(
    'editor.hierarchy.roots',
    'operation',
    () => adapter.hierarchy.roots(),
    (value) => Array.isArray(value) && value.length > 0,
  );
  const roots = Array.isArray(rootsValue) ? (rootsValue as EditorNode[]) : [];
  let hierarchyValid = roots.length > 0;
  const seen = new Set<string>();
  const pending = [...roots];
  // A walk BUDGET, not a size limit: a scene larger than this (Money Masters' translated
  // Workspace is ~24,000 authored nodes) is still a finite, reciprocal tree — the probe has simply
  // checked the first 10,000 of it. Running out of budget with work pending is reported as that,
  // never as a failed seam.
  const WALK_BUDGET = 10_000;
  while (pending.length > 0 && seen.size < WALK_BUDGET) {
    const declared = pending.shift();
    if (!declared || seen.has(declared.id)) {
      hierarchyValid = false;
      continue;
    }
    seen.add(declared.id);
    const node = record(
      'editor.hierarchy.node',
      'operation',
      () => adapter.hierarchy.node(declared.id),
      (value) =>
        value !== null &&
        typeof value === 'object' &&
        (value as EditorNode).id === declared.id &&
        Array.isArray((value as EditorNode).childIds),
    ) as EditorNode | null | undefined;
    if (!node) {
      hierarchyValid = false;
      continue;
    }
    const children = reciprocalChildren(adapter, node);
    hierarchyValid &&= children.valid;
    pending.push(...children.children);
  }
  const budgetReached = pending.length > 0 && seen.size >= WALK_BUDGET;
  receipts.push({
    seam: 'editor.hierarchy',
    subject,
    epoch,
    stage: 'operation',
    outcome: hierarchyValid ? 'pass' : 'fail',
    source: 'conformance-probe',
    detail: hierarchyValid
      ? `hierarchy roots/node walked ${seen.size} unique node(s) with reciprocal parent/child ids${
          budgetReached
            ? ` (walk budget reached with ${pending.length} node(s) still pending — a larger tree, not a broken one)`
            : ''
        }`
      : 'hierarchy roots/node did not form a finite, non-empty, reciprocal tree',
  });
  // The carrier's other members, all of them pure reads over the tree just
  // walked. They are probed HERE and not left to a consumer because none of
  // them has a consumer that records a receipt — which is exactly how the
  // carrier came to grade `unverified` on a perfectly healthy adapter.
  if (adapter.hierarchy.crossSurfaceStructureSignature) {
    record(
      'editor.hierarchy.crossSurfaceStructureSignature',
      'operation',
      () => adapter.hierarchy.crossSurfaceStructureSignature?.(),
      (value) => value === null || typeof value === 'string',
    );
  }
  objectLookupReceipts({ adapter, subject, epoch, receipts, walked: [...seen] });
  return roots;
}

function probeCoreProviders(adapter: AuthoringAdapter, id: string, record: ReadRecorder): void {
  if (adapter.selection) {
    record('editor.selection.get', 'operation', () => adapter.selection?.get(), Array.isArray);
    if (adapter.selection.resolve) {
      record(
        'editor.selection.resolve',
        'operation',
        () => adapter.selection?.resolve?.(id),
        (value) =>
          value === null ||
          (typeof value === 'object' && typeof (value as { id?: unknown }).id === 'string'),
      );
    }
  }
  if (adapter.transforms) {
    let transformApplies = true;
    if (adapter.transforms.dimensions) {
      const dimensions = record(
        'editor.transforms.dimensions',
        'operation',
        () => adapter.transforms?.dimensions?.(id),
        (value) => value === null || value === '2d' || value === '3d',
      );
      // `null` is the provider's explicit "this hierarchy row has no
      // transform" answer (composite world/group rows are the canonical
      // case). `get` is non-nullable only for APPLICABLE rows; calling it after
      // `dimensions` declined the subject manufactures a conformance failure
      // against an operation no real consumer performs.
      transformApplies = dimensions === '2d' || dimensions === '3d';
    }
    if (transformApplies) {
      record(
        'editor.transforms.get',
        'operation',
        () => adapter.transforms?.get(id),
        (value) => {
          if (!value || typeof value !== 'object') return false;
          const transform = value as Record<string, unknown>;
          return ['position', 'rotation', 'scale'].every((key) => {
            const part = transform[key];
            return Array.isArray(part) && part.every(Number.isFinite);
          });
        },
      );
      if (adapter.transforms.editability) {
        record(
          'editor.transforms.editability',
          'operation',
          () => adapter.transforms?.editability?.(id, 'position'),
          (value) =>
            value !== null &&
            typeof value === 'object' &&
            typeof (value as { writable?: unknown }).writable === 'boolean',
        );
      }
    }
  }
  if (adapter.inspector) {
    const properties = record(
      'editor.inspector.properties',
      'operation',
      () => adapter.inspector?.properties(id),
      Array.isArray,
    );
    if (Array.isArray(properties)) {
      for (const property of properties) {
        if (property && typeof property === 'object' && typeof property.path === 'string') {
          record('editor.inspector.get', 'operation', () =>
            adapter.inspector?.get(id, property.path),
          );
          if (adapter.inspector.editability) {
            record(
              'editor.inspector.editability',
              'operation',
              () => adapter.inspector?.editability?.(id, property.path),
              (value) =>
                value !== null &&
                typeof value === 'object' &&
                typeof (value as { writable?: unknown }).writable === 'boolean',
            );
          }
        }
      }
    }
  }
}

function probeIdentityProviders(
  adapter: AuthoringAdapter,
  id: string,
  record: ReadRecorder,
  passParent: (seam: string) => void,
): void {
  if (adapter.assetSubject) {
    record('editor.assetSubject.get', 'operation', () => adapter.assetSubject?.get(id));
    if (adapter.assetSubject.entries) {
      record(
        'editor.assetSubject.entries',
        'operation',
        () => adapter.assetSubject?.entries?.(),
        Array.isArray,
      );
    }
    passParent('editor.assetSubject');
  }
  if (adapter.related) {
    record('editor.related.links', 'operation', () => adapter.related?.links(id), Array.isArray);
    passParent('editor.related');
  }
  if (adapter.instances) {
    record('editor.instances.describe', 'operation', () => adapter.instances?.describe(id));
  }
  if (adapter.truth) {
    record(
      'editor.truth.resolve',
      'operation',
      () => adapter.truth?.resolve(id, ''),
      (value) => value !== null && typeof value === 'object',
    );
    passParent('editor.truth');
  }
}

function probeViewportProviders(
  adapter: AuthoringAdapter,
  id: string,
  record: ReadRecorder,
  passParent: (seam: string) => void,
): void {
  if (adapter.pickable) {
    record(
      'editor.pickable.pick',
      'operation',
      () => adapter.pickable?.pick(0, 0),
      (value) => value === null || typeof value === 'string',
    );
    if (adapter.pickable.candidates) {
      record(
        'editor.pickable.candidates',
        'operation',
        () => adapter.pickable?.candidates?.(0, 0),
        Array.isArray,
      );
    }
    passParent('editor.pickable');
  }
  if (adapter.rects) {
    record(
      'editor.rects.rect',
      'operation',
      () => adapter.rects?.rect(id),
      (value) => {
        if (value === null) return true;
        if (!value || typeof value !== 'object') return false;
        const rect = value as Record<string, unknown>;
        return ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(rect[key]));
      },
    );
    if (adapter.rects.contextRects) {
      record('editor.rects.contextRects', 'operation', () => adapter.rects?.contextRects?.(id));
    }
    if (adapter.rects.emptyContainers) {
      record(
        'editor.rects.emptyContainers',
        'operation',
        () => adapter.rects?.emptyContainers?.(),
        Array.isArray,
      );
    }
    passParent('editor.rects');
  }
  if (adapter.colorSample) {
    record(
      'editor.colorSample.backgroundChainAt',
      'operation',
      () => adapter.colorSample?.backgroundChainAt(0, 0),
      (value) => value === null || Array.isArray(value),
    );
    passParent('editor.colorSample');
  }
  if (adapter.spatialHandles) {
    record(
      'editor.spatialHandles.layers',
      'operation',
      () => adapter.spatialHandles?.layers(id),
      Array.isArray,
    );
  }
}

function probeDocumentProviders(adapter: AuthoringAdapter, id: string, record: ReadRecorder): void {
  if (adapter.persistence) {
    record(
      'editor.persistence.isDirty',
      'operation',
      () => adapter.persistence?.isDirty(),
      (value) => typeof value === 'boolean',
    );
    if (adapter.persistence.lastError) {
      record(
        'editor.persistence.lastError',
        'operation',
        () => adapter.persistence?.lastError?.(),
        (value) => value === null || typeof value === 'string',
      );
    }
  }
  if (adapter.text) record('editor.text.get', 'operation', () => adapter.text?.get(id));
  if (adapter.stories) {
    record(
      'editor.stories.storiesFor',
      'operation',
      () => adapter.stories?.storiesFor(id),
      Array.isArray,
    );
    record(
      'editor.stories.active',
      'operation',
      () => adapter.stories?.active(id),
      (value) => value === null || typeof value === 'string',
    );
  }
  if (adapter.assetDrop) {
    record(
      'editor.assetDrop.accepts',
      'operation',
      () => adapter.assetDrop?.accepts(id, '__vgai_read_probe__'),
      (value) => typeof value === 'boolean',
    );
  }
}

export function probeAuthoringReads(options: {
  readonly adapter: AuthoringAdapter;
  readonly subject: string;
  readonly epoch: string;
}): readonly SeamEvidenceReceipt[] {
  const { adapter, subject, epoch } = options;
  const receipts: SeamEvidenceReceipt[] = [];
  const record = (
    seam: string,
    stage: SeamProofStage,
    run: () => unknown,
    valid: (value: unknown) => boolean = () => true,
  ): unknown => {
    try {
      const value = run();
      const pass = valid(value);
      receipts.push({
        seam,
        subject,
        epoch,
        stage,
        outcome: pass ? 'pass' : 'fail',
        source: 'conformance-probe',
        detail: pass
          ? `${seam} returned a value accepted by its consumer-facing shape`
          : `${seam} returned a value outside its consumer-facing shape`,
      });
      return value;
    } catch (error) {
      receipts.push({
        seam,
        subject,
        epoch,
        stage,
        outcome: 'fail',
        source: 'conformance-probe',
        detail: `${seam} threw while read: ${error instanceof Error ? error.message : String(error)}`,
      });
      return undefined;
    }
  };
  const passParent = (seam: string): void => {
    receipts.push({
      seam,
      subject,
      epoch,
      stage: 'operation',
      outcome: 'pass',
      source: 'conformance-probe',
      detail: `${seam} served a real read against the mounted projection`,
    });
  };

  const roots = hierarchyReceipts({ adapter, subject, epoch, record, receipts });

  const id = roots[0]?.id;
  if (!id) return receipts;

  probeCoreProviders(adapter, id, record);
  probeIdentityProviders(adapter, id, record, passParent);
  probeViewportProviders(adapter, id, record, passParent);
  probeDocumentProviders(adapter, id, record);

  return receipts;
}
