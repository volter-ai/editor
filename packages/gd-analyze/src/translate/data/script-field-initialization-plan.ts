import type {
  BoundGodotProject,
  BoundGodotScriptField,
  BoundGodotScriptFieldAttachmentValue,
} from '../../analyze/bound-project';
import type { GodotValue } from '../../read/godot-value';
import { godotBoundDatatypeIdentity } from '../code/lowering-rules';
import {
  type GodotFieldValueAuthority,
  GodotFieldValueAuthorityResolver,
  type SerializedPrimitiveIdentity,
  type TargetPrimitiveKind,
} from './field-value-authority';

export const SCRIPT_FIELD_INITIALIZATION_PLAN_VERSION = 1 as const;

export type TargetPrimitiveValue =
  | { readonly kind: 'boolean'; readonly value: boolean }
  | { readonly kind: 'number'; readonly value: number }
  | { readonly kind: 'string'; readonly value: string };

export interface ScriptFieldValuePlan {
  readonly fieldName: string;
  readonly application: 'script-property-set';
  readonly value: TargetPrimitiveValue;
  readonly evidenceClaimId: string;
}

export interface ScriptAttachmentFieldInitializationPlan {
  readonly scriptResPath: string;
  readonly documentPath: string;
  readonly nodePath: string;
  readonly fields: readonly ScriptFieldValuePlan[];
}

export interface ScriptFieldInitializationPlan {
  readonly version: typeof SCRIPT_FIELD_INITIALIZATION_PLAN_VERSION;
  readonly snapshotDigest: string;
  readonly sourceRevision: string;
  readonly attachments: readonly ScriptAttachmentFieldInitializationPlan[];
  readonly evidenceClaimIds: readonly string[];
  readonly semanticClaimRegistryDigest: string;
}

export interface ScriptFieldInitializationDiagnostic {
  readonly scriptResPath: string;
  readonly documentPath: string;
  readonly nodePath: string;
  readonly fieldName: string;
  readonly message: string;
}

export type ScriptFieldInitializationResult =
  | {
      readonly kind: 'accepted-field-initializations';
      readonly plan: ScriptFieldInitializationPlan;
    }
  | {
      readonly kind: 'refused-field-initializations';
      readonly diagnostics: readonly ScriptFieldInitializationDiagnostic[];
    };

function serializedIdentity(value: GodotValue): SerializedPrimitiveIdentity | undefined {
  if (value.kind === 'bool' || value.kind === 'string') return value.kind;
  if (value.kind === 'number' && value.variantType !== undefined) {
    return `number:${value.variantType}`;
  }
  return undefined;
}

function targetValue(value: GodotValue, targetKind: TargetPrimitiveKind): TargetPrimitiveValue {
  if (value.kind === 'bool' && targetKind === 'boolean') {
    return { kind: 'boolean', value: value.value };
  }
  if (value.kind === 'number' && targetKind === 'number') {
    return { kind: 'number', value: value.value };
  }
  if (value.kind === 'string' && targetKind === 'string') {
    return { kind: 'string', value: value.value };
  }
  throw new Error(`field-value authority has an impossible ${value.kind} -> ${targetKind} recipe`);
}

interface FieldPlanState {
  readonly attachments: Map<string, ScriptAttachmentFieldInitializationPlan>;
  readonly diagnostics: ScriptFieldInitializationDiagnostic[];
  readonly evidence: Set<string>;
}

function planAuthoredValue(
  scriptResPath: string,
  field: BoundGodotScriptField,
  attachment: BoundGodotScriptFieldAttachmentValue,
  resolved: GodotFieldValueAuthorityResolver,
  state: FieldPlanState,
): void {
  const at = {
    scriptResPath,
    documentPath: attachment.documentPath,
    nodePath: attachment.nodePath,
    fieldName: field.name,
  } as const;
  if (attachment.valueKind === 'node-reference') {
    state.diagnostics.push({
      ...at,
      message: 'authored Node reference requires a composition-time node lookup recipe',
    });
    return;
  }
  const value = attachment.authoredValue;
  if (value === undefined) {
    throw new Error(
      `${attachment.documentPath}#${attachment.nodePath}.${field.name}: authored value is absent`,
    );
  }
  const serialized = serializedIdentity(value);
  if (serialized === undefined) {
    state.diagnostics.push({
      ...at,
      message: `serialized ${value.kind} value has no exact target-native conversion`,
    });
    return;
  }
  const datatype = godotBoundDatatypeIdentity(field.datatype);
  const rule = resolved.rule(datatype, serialized);
  if (rule === undefined) {
    state.diagnostics.push({
      ...at,
      message: `no live field-value evidence for ${datatype} receiving ${serialized}`,
    });
    return;
  }
  const key = `${scriptResPath}\0${attachment.documentPath}\0${attachment.nodePath}`;
  const current = state.attachments.get(key) ?? {
    scriptResPath,
    documentPath: attachment.documentPath,
    nodePath: attachment.nodePath,
    fields: [],
  };
  state.attachments.set(key, {
    ...current,
    fields: [
      ...current.fields,
      {
        fieldName: field.name,
        application: 'script-property-set',
        value: targetValue(value, rule.targetKind),
        evidenceClaimId: rule.evidenceClaimId,
      },
    ],
  });
  state.evidence.add(rule.evidenceClaimId);
}

/**
 * Plan attachment-authored script values without reading source, emitting code, or constructing a
 * runtime object. Missing semantic evidence is a refusal, never a guessed conversion.
 */
export function planScriptFieldInitializations(
  project: BoundGodotProject,
  authority: GodotFieldValueAuthority,
): ScriptFieldInitializationResult {
  const resolved = new GodotFieldValueAuthorityResolver(authority);
  if (resolved.sourceRevision !== project.authority.revision) {
    throw new Error('bound Godot project and field-value authority use different revisions');
  }
  const state: FieldPlanState = {
    diagnostics: [],
    attachments: new Map(),
    evidence: new Set(),
  };
  for (const script of project.scripts) {
    for (const field of script.fields) {
      for (const attachment of field.attachmentValues) {
        if (attachment.source !== 'authored-value') continue;
        planAuthoredValue(script.resPath, field, attachment, resolved, state);
      }
    }
  }
  if (state.diagnostics.length > 0) {
    return { kind: 'refused-field-initializations', diagnostics: state.diagnostics };
  }
  return {
    kind: 'accepted-field-initializations',
    plan: {
      version: SCRIPT_FIELD_INITIALIZATION_PLAN_VERSION,
      snapshotDigest: project.snapshotDigest,
      sourceRevision: project.authority.revision,
      attachments: [...state.attachments.values()],
      evidenceClaimIds: [...state.evidence].sort(),
      semanticClaimRegistryDigest: resolved.registryDigest,
    },
  };
}
