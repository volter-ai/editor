/** Exact authored SceneReplicationConfig subresource decode; runtime semantics live in compat. */
import type { GodotValue } from '../../read/godot-value';
import { TranslateError } from './model';

export interface SceneReplicationPropertyPlan {
  readonly path: string;
  readonly spawn?: boolean;
  readonly sync?: boolean;
  readonly watch?: boolean;
  readonly replicationMode?: 0 | 1 | 2;
}

function nodePath(value: GodotValue | undefined, at: string): string {
  if (
    value?.kind !== 'ctor' || value.name !== 'NodePath' || value.args.length !== 1 ||
    value.args[0]?.kind !== 'string'
  ) {
    throw new TranslateError(at, 'SceneReplicationConfig property path must be an authored NodePath(String).');
  }
  return value.args[0].value;
}

function authoredBool(value: GodotValue | undefined, at: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (value.kind !== 'bool') throw new TranslateError(at, 'SceneReplicationConfig flag must be bool.');
  return value.value;
}

function authoredMode(value: GodotValue | undefined, at: string): 0 | 1 | 2 | undefined {
  if (value === undefined) return undefined;
  if (value.kind !== 'number' || (value.value !== 0 && value.value !== 1 && value.value !== 2)) {
    throw new TranslateError(at, 'SceneReplicationConfig replication_mode must be NEVER, ALWAYS, or ON_CHANGE.');
  }
  return value.value;
}

export function sceneReplicationPropertiesOf(
  resource: { readonly type: string; readonly properties: Readonly<Record<string, GodotValue>> },
  at: string,
): readonly SceneReplicationPropertyPlan[] {
  if (resource.type !== 'SceneReplicationConfig') {
    throw new TranslateError(at, 'replication_config must reference a SceneReplicationConfig SubResource.');
  }
  const indices = new Set<number>();
  for (const name of Object.keys(resource.properties)) {
    const match = /^properties\/(\d+)\/(path|spawn|sync|watch|replication_mode)$/.exec(name);
    if (match !== null) {
      indices.add(Number(match[1]));
      continue;
    }
    throw new TranslateError(`${at}.${name}`, `SceneReplicationConfig property ${name} has no retained carrier.`);
  }
  return [...indices].sort((a, b) => a - b).map((index) => {
    const prefix = `properties/${index}`;
    return {
      path: nodePath(resource.properties[`${prefix}/path`], `${at}.${prefix}/path`),
      ...(authoredBool(resource.properties[`${prefix}/spawn`], `${at}.${prefix}/spawn`) === undefined
        ? {} : { spawn: authoredBool(resource.properties[`${prefix}/spawn`], `${at}.${prefix}/spawn`) }),
      ...(authoredBool(resource.properties[`${prefix}/sync`], `${at}.${prefix}/sync`) === undefined
        ? {} : { sync: authoredBool(resource.properties[`${prefix}/sync`], `${at}.${prefix}/sync`) }),
      ...(authoredBool(resource.properties[`${prefix}/watch`], `${at}.${prefix}/watch`) === undefined
        ? {} : { watch: authoredBool(resource.properties[`${prefix}/watch`], `${at}.${prefix}/watch`) }),
      ...(authoredMode(resource.properties[`${prefix}/replication_mode`], `${at}.${prefix}/replication_mode`) === undefined
        ? {} : { replicationMode: authoredMode(resource.properties[`${prefix}/replication_mode`], `${at}.${prefix}/replication_mode`) }),
    };
  });
}
