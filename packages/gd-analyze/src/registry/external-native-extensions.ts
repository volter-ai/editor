/** Source-audited ClassDB declarations supplied by project extensions rather than Godot itself. */

export type ExternalNativeMemberKind = 'method' | 'property' | 'signal';

export interface ExternalNativeMember {
  readonly name: string;
  readonly kind: ExternalNativeMemberKind;
  readonly returnType: string;
  readonly minArgs: number;
  readonly maxArgs: number;
  readonly argumentTypes?: readonly string[];
}

export interface ExternalNativeClass {
  readonly name: string;
  readonly baseClass: string;
  readonly supportedMajors: readonly (3 | 4)[];
  readonly members: readonly ExternalNativeMember[];
}

export const EXTERNAL_NATIVE_CLASSES: Readonly<Record<string, ExternalNativeClass>> = Object.freeze({
  LimboHSM: {
    name: 'LimboHSM',
    baseClass: 'LimboState',
    supportedMajors: [4],
    members: [
      {
        name: 'add_transition',
        kind: 'method',
        returnType: 'void',
        minArgs: 3,
        maxArgs: 4,
        argumentTypes: ['LimboState', 'LimboState', 'StringName', 'Callable'],
      },
      {
        name: 'initialize',
        kind: 'method',
        returnType: 'void',
        minArgs: 1,
        maxArgs: 2,
        argumentTypes: ['Node', 'Blackboard'],
      },
      {
        name: 'set_active',
        kind: 'method',
        returnType: 'void',
        minArgs: 1,
        maxArgs: 1,
        argumentTypes: ['bool'],
      },
    ],
  },
  LimboState: {
    name: 'LimboState',
    baseClass: 'Node',
    supportedMajors: [4],
    members: [],
  },
  RenIK: {
    name: 'RenIK',
    baseClass: 'Node3D',
    supportedMajors: [4],
    members: [],
  },
});

export function externalNativeClass(name: string, major?: 3 | 4): ExternalNativeClass | undefined {
  const extension = EXTERNAL_NATIVE_CLASSES[name];
  return extension !== undefined && (major === undefined || extension.supportedMajors.includes(major))
    ? extension
    : undefined;
}

export function externalNativeMember(
  className: string,
  memberName: string,
  major?: 3 | 4,
): ExternalNativeMember | undefined {
  return externalNativeClass(className, major)?.members.find((member) => member.name === memberName);
}

export function externalNativeClassChain(className: string): readonly string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  let current = className;
  while (!seen.has(current)) {
    seen.add(current);
    const extension = externalNativeClass(current);
    if (extension === undefined) {
      chain.push(current);
      break;
    }
    chain.push(extension.name);
    current = extension.baseClass;
  }
  return chain;
}
