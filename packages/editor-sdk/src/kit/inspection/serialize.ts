/**
 * The SERIALIZED projection of the inspection model — Layer 3's fourth
 * projection, and the agent surface (design: `docs/ARCHITECTURE-CORE.md`
 * §Editor chrome, "The Inspection Model" … "and later a serialized export
 * (`editor.inspect`) — the Figma-Inspect analog and the agent surface";
 * build ledger: `docs/WORK.md` §Inspection Model program, W4).
 *
 * It is the same kind of thing the column and the compact card are: a DUMB
 * projection that reads identity/order/title/body off an
 * {@link InspectionSubject} and knows nothing about content. The only thing
 * it does that the visual projections do not is READ THE VALUES — a field
 * descriptor is an address, and an agent asking "what is this thing" wants
 * the value at that address, so a `fields` body is serialized through the
 * section's OWN `io.get`, the same io the field rows edit through.
 *
 * Three rules this projection is built on:
 *
 *  - **Opaque rendering stays opaque.** `render()` is never called and React
 *    is never touched. A custom body may still own the model's ordinary
 *    descriptor channel; those fields serialize through their existing io so
 *    custom chrome cannot hide scriptable paths or their refusal reasons.
 *  - **MIXED is a distinguished marker, not a missing value.** A field whose
 *    subjects disagree serializes as `{mixed: true}` with no `value` — an
 *    agent must be able to tell "they disagree" from "it is unset", which is
 *    exactly why the sentinel is in the value model at all.
 *  - **Icons are not data.** An `IconDefinition` is Font Awesome's render
 *    payload; an agent has no use for path geometry, and its `iconName` says
 *    nothing the section's `title` doesn't. Omitted outright.
 *
 * Pure and React-free: subject in, JSON-safe object out. The live half —
 * "which subject is showing right now" — is `inspection/active-subject.ts`.
 */

import type {
  FieldDescriptor,
  InspectionFieldIo,
  InspectionPresentation,
  InspectionSection,
  InspectionSectionData,
  InspectionSubject,
  InspectionSurfaceKind,
} from '@volter/editor-sdk/kit/inspection-model';
import { fieldReadonlyReason, isMixed } from '@volter/editor-sdk/kit/inspection-model';

/** How deep {@link toJsonSafe} walks a structured value before giving up. A
 *  `json`-typed descriptor can address an arbitrary blob; three levels covers
 *  every shape the field vocabulary actually produces (vec3, colour tuples,
 *  option lists, small records) without risking an unbounded walk. */
const MAX_VALUE_DEPTH = 3;

/** One field, with the value currently at its `path`. */
export interface SerializedInspectionField {
  /** The stable scriptable address — the SAME one agents script against. */
  readonly path: string;
  readonly label: string;
  readonly type: FieldDescriptor['type'];
  /** The current value, JSON-safe. Absent when the value is `undefined`
   *  (nothing at that address) or when `mixed` is set. */
  readonly value?: unknown;
  /** The subjects disagree about this field (the model's MIXED sentinel). */
  readonly mixed?: true;
  /** The value shown is the DECLARED DEFAULT — the document does not carry it. */
  readonly defaulted?: boolean;
  readonly readonly?: boolean;
  /** The same adapter-authored sentence the disabled field and write refusal use. */
  readonly readonlyReason?: string;
  readonly resettable?: boolean;
  readonly revertsTo?: string;
  readonly group?: string;
  readonly options?: readonly unknown[];
}

export type SerializedInspectionBody =
  /** `data`, when present, is the producer's published display values riding
   *  BESIDE the field list (the Element section's class chips and active
   *  breakpoint are the shipped case): facts the section shows that are not
   *  themselves writable fields. */
  | {
      readonly kind: 'fields';
      readonly fields: readonly SerializedInspectionField[];
      readonly data?: Record<string, unknown>;
    }
  /** A block the model does not model. Named, never rendered or introspected —
   *  plus, when the producer published one, the body's own displayed VALUES
   *  (`InspectionSectionData`; the Transform section is the shipped case). */
  | {
      readonly kind: 'custom';
      readonly id: string;
      readonly title: string;
      readonly data?: Record<string, unknown>;
    }
  /** The subject's live preview. Named opaque for the same reason a custom
   *  body is — there is nothing in a rendered viewport for an agent to read —
   *  but distinguished, because "this thing has a live preview" is a real
   *  fact about the subject that the section list would otherwise not carry. */
  | { readonly kind: 'preview'; readonly id: string; readonly title: string };

export interface SerializedInspectionSection {
  readonly id: string;
  readonly title: string;
  readonly order: number;
  readonly description?: string;
  readonly body: SerializedInspectionBody;
}

/** A subject verb, as data: what it is called and (for a toggle) its state. */
export interface SerializedInspectionAction {
  readonly id: string;
  readonly title: string;
  readonly label?: string;
  /** Toggle state, for verbs that have one. The visibility eye is the worked
   *  case: `visible` is lifted OUT of the descriptor grid onto the identity
   *  row, so this flag is the ONLY place an agent can read it — without it
   *  the answer would only be recoverable by prose-matching `title`. */
  readonly pressed?: boolean;
  readonly disabled?: boolean;
}

export interface SerializedSubjectLink {
  readonly id: string;
  readonly title: string;
}

export interface SerializedInspectionSubject {
  readonly id: string;
  readonly title: string;
  /** What to CALL this thing's type (+ seam provenance). Absent when there is
   *  no identity row (the no-selection subject). */
  readonly kindLabel?: string;
  /** The identity row's own line, verbatim — for an ingest mount that is where
   *  the object came FROM (`Source · game.js:271`), which is the fact every
   *  question about writing it back starts at. */
  readonly note?: string;
  /** The quiet line a subject with nothing to edit explains itself with. */
  readonly hint?: string;
  /** How many OTHER nodes are selected alongside this one. "The agent reads
   *  what the human sees" is only true if the agent also learns that a gizmo
   *  gesture here would move more than the subject it is reading. */
  readonly alsoSelected?: number;
  /** Which surface this subject belongs to, and how it is presented: the
   *  subject's own affinity, plus the presentation ACTUALLY showing when the
   *  caller resolved one (`inspector-presentation.ts` — the subject cannot
   *  know it, since a user override lives outside the model). */
  readonly presentation: {
    readonly preferred: InspectionPresentation;
    readonly resolved?: InspectionPresentation;
    readonly surface?: InspectionSurfaceKind;
  };
  readonly quickActions: readonly SerializedInspectionAction[];
  readonly related: readonly SerializedSubjectLink[];
  readonly sections: readonly SerializedInspectionSection[];
}

/**
 * NOTHING is being inspected — the wire's answer when the inspector itself is
 * unmounted (owner, 2026-08-07: with nothing selected the human sees no
 * inspector, and the agent surface must say the same thing).
 *
 * It is an explicit marker rather than `null` because absence is already
 * spoken for at every hop of this wire: the browser answering nothing, the
 * relay timing out, and a session with no attached tab all arrive as a
 * missing value, which the operation reports as `INSPECTION_UNAVAILABLE`
 * ("nobody answered"). "Somebody answered, and the answer is that there is
 * nothing to inspect" is a DIFFERENT fact, and it deserves a token that
 * survives the same hops — an object, which every layer already carries
 * unchanged, and which prints as `{none: true}` in a `vgai eval` rather than
 * as a bare `null` an agent would read as a failure.
 */
export interface SerializedNoInspection {
  readonly none: true;
}

/** What `editor.inspect` answers: the subject showing, or {@link NO_INSPECTION}. */
export type SerializedInspection = SerializedInspectionSubject | SerializedNoInspection;

export const NO_INSPECTION: SerializedNoInspection = Object.freeze({ none: true as const });

/** What the live shell knows that a pure subject cannot: which surface it is,
 *  and which projection the user is actually looking at. */
export interface SerializedInspectionContext {
  readonly surface: InspectionSurfaceKind;
  readonly presentation: InspectionPresentation;
}

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value) as object | null;
  return proto === Object.prototype || proto === null;
}

/**
 * Narrow an arbitrary property value to something that survives
 * `JSON.stringify` intact.
 *
 * Primitives pass through; arrays and plain objects are walked to
 * {@link MAX_VALUE_DEPTH}. Anything else — a live `THREE.Color`, a texture, a
 * function, a DOM node — becomes `{kind:'opaque', type}` rather than being
 * dropped or half-flattened: "there is a value here and it is a Texture" is
 * true and useful, while an empty object would read as "an empty value" and a
 * silent omission would read as "unset". Both of those are the anti-shim
 * rule's fabrication, one field at a time.
 */
export function toJsonSafe(value: unknown, depth = 0): unknown {
  if (value === null) return null;
  const type = typeof value;
  if (type === 'string' || type === 'boolean') return value;
  // `-0` is a finite number that does NOT survive the wire: `JSON.stringify`
  // writes it as `0`, so a serialized value and its parse would differ — and
  // the round trip is the property this whole projection is judged on. It
  // reaches here for real (an identity quaternion converted to Euler degrees
  // yields `-0` on two axes), and no reader has ever wanted the sign of zero.
  if (type === 'number') {
    if (!Number.isFinite(value)) return { kind: 'opaque', type: 'number' };
    return value === 0 ? 0 : value;
  }
  if (type !== 'object') return { kind: 'opaque', type };
  if (depth >= MAX_VALUE_DEPTH) return { kind: 'opaque', type: constructorName(value as object) };
  if (Array.isArray(value)) return value.map((item) => toJsonSafe(item, depth + 1));
  const object = value as object;
  if (!isPlainObject(object)) return { kind: 'opaque', type: constructorName(object) };
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(object)) {
    if (item !== undefined) out[key] = toJsonSafe(item, depth + 1);
  }
  return out;
}

function constructorName(value: object): string {
  return (value.constructor as { name?: string } | undefined)?.name ?? 'object';
}

function serializeField(field: FieldDescriptor, io: InspectionFieldIo): SerializedInspectionField {
  // Read through the SECTION's own io — the same one the field rows write
  // through — so an agent's read and a human's read cannot diverge.
  let raw: unknown;
  try {
    raw = io.get(field.path);
  } catch {
    // A descriptor whose backing object went away mid-read is a value we do
    // not have, not a failed inspection: the rest of the subject is still
    // true and reporting it is more useful than throwing the whole read away.
    raw = undefined;
  }
  return {
    path: field.path,
    label: field.label,
    type: field.type,
    ...(isMixed(raw) ? { mixed: true as const } : {}),
    ...(!isMixed(raw) && raw !== undefined ? { value: toJsonSafe(raw) } : {}),
    ...(field.defaulted !== undefined ? { defaulted: field.defaulted } : {}),
    ...(field.readonly !== undefined ? { readonly: field.readonly } : {}),
    ...(field.readonly ? { readonlyReason: fieldReadonlyReason(field) } : {}),
    ...(field.resettable !== undefined ? { resettable: field.resettable } : {}),
    ...(field.revertsTo !== undefined ? { revertsTo: field.revertsTo } : {}),
    ...(field.group !== undefined ? { group: field.group } : {}),
    ...(field.options !== undefined
      ? { options: field.options.map((option) => toJsonSafe(option)) }
      : {}),
  };
}

/** A custom body's published values, narrowed to the wire. Keys are the
 *  producer's own vocabulary; this projection reads none of them. */
function serializeSectionData(data: InspectionSectionData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) out[key] = toJsonSafe(value);
  }
  return out;
}

function serializeBody(section: InspectionSection): SerializedInspectionBody {
  const body = section.body;
  if (body.kind === 'fields') {
    return { kind: 'fields', fields: body.fields.map((field) => serializeField(field, body.io)) };
  }
  // An opaque body replaces RENDERING, never identity — so the identity the
  // model kept IS the whole serialization. `render()` is not called.
  //
  // A custom body may ALSO have published its displayed values (P18: the
  // Transform section's position/rotation/scale, which an agent could
  // otherwise not read at all). They ride through untouched: the producer
  // decided what the section says about itself, and a projection that
  // reinterpreted it would be the content knowledge this layer removes.
  if (body.kind === 'custom' && body.data !== undefined && body.editable === undefined) {
    return {
      kind: 'custom',
      id: section.id,
      title: section.title,
      data: serializeSectionData(body.data),
    };
  }
  // A custom body whose values ARE an ordinary descriptor channel is a FIELD
  // LIST on this wire. Nothing here is rendered, so `custom` would be naming
  // chrome the reader cannot see while hiding the one thing it can use: the
  // whole react/DOM lane draws its own widgets over `STYLE_PROPERTIES`, so
  // every section reported `kind: 'custom'` and `editor.inspect()` enumerated
  // ZERO fields for a DOM element — 55 authorable style properties, reachable
  // only by a caller that already knew their names. Identity is untouched:
  // `SerializedInspectionSection` carries the id/title/order above.
  if (body.kind === 'custom' && body.editable !== undefined) {
    const editable = body.editable;
    return {
      kind: 'fields',
      fields: editable.fields.map((field) => serializeField(field, editable.io)),
      // Published display values ride beside the fields (see the wire type):
      // dropping them when a body had BOTH halves would make adding a write
      // door silently delete the read-only facts the section also shows.
      ...(body.data !== undefined ? { data: serializeSectionData(body.data) } : {}),
    };
  }
  return { kind: body.kind, id: section.id, title: section.title };
}

function serializeSection(section: InspectionSection): SerializedInspectionSection {
  return {
    id: section.id,
    title: section.title,
    order: section.order,
    ...(section.description !== undefined ? { description: section.description } : {}),
    body: serializeBody(section),
  };
}

/**
 * One inspection subject, as JSON.
 *
 * `context` is optional so the function stays testable as pure data-in/
 * data-out; the live shell always passes it, because "which surface, and
 * which projection is actually showing" is the one thing about a subject that
 * the subject itself cannot answer.
 */
export function serializeInspectionSubject(
  subject: InspectionSubject,
  context?: SerializedInspectionContext,
): SerializedInspectionSubject {
  return {
    id: subject.id,
    title: subject.title,
    ...(subject.identity?.kindLabel ? { kindLabel: subject.identity.kindLabel } : {}),
    ...(subject.identity?.note ? { note: subject.identity.note.text } : {}),
    ...(subject.hint ? { hint: subject.hint } : {}),
    ...(subject.alsoSelected ? { alsoSelected: subject.alsoSelected } : {}),
    presentation: {
      preferred: subject.presentation.preferred,
      ...(context ? { resolved: context.presentation, surface: context.surface } : {}),
    },
    quickActions: subject.quickActions.map((action) => ({
      id: action.id,
      title: action.title,
      ...(action.label !== undefined ? { label: action.label } : {}),
      ...(action.pressed !== undefined ? { pressed: action.pressed } : {}),
      ...(action.disabled !== undefined ? { disabled: action.disabled } : {}),
    })),
    related: subject.related.map(({ id, title }) => ({ id, title })),
    sections: subject.sections.map(serializeSection),
  };
}
