export const GODOT_LIFECYCLE_AUTHORITY_VERSION = 3 as const;

export type DirectGodotLifecyclePhase = 'enter-tree' | 'ready' | 'exit-tree';

export interface GodotLifecycleRule {
  readonly sourceRevision: string;
  readonly phases: readonly DirectGodotLifecyclePhase[];
  readonly targetOperation: 'compat-native-hierarchy-mount';
}

export interface GodotProjectStartupRule {
  readonly sourceRevision: string;
  readonly sourceOrder: 'autoloads-then-main';
  readonly targetOperation: 'react-native-startup-batch';
}

/** `Main`'s loop around the project: the composition site's host duties (`compat/main.tsx`). */
export interface GodotMainLoopRule {
  readonly sourceRevision: string;
  readonly targetOperation: 'compat-godot-main';
}

export interface GodotLifecycleAuthority {
  readonly version: typeof GODOT_LIFECYCLE_AUTHORITY_VERSION;
  readonly sourceRevision: string;
  readonly apiDumpSha256: string;
  readonly rules: readonly GodotLifecycleRule[];
  readonly projectStartupRules: readonly GodotProjectStartupRule[];
  readonly mainLoopRules: readonly GodotMainLoopRule[];
}

function godotProjectStartupRuleKey(sourceRevision: string): string {
  return [sourceRevision, 'project-startup', 'autoloads-then-main'].join('\0');
}

function godotMainLoopRuleKey(sourceRevision: string): string {
  return [sourceRevision, 'main-loop'].join('\0');
}

function godotLifecycleRuleKey(
  sourceRevision: string,
  phases: readonly DirectGodotLifecyclePhase[],
): string {
  return [sourceRevision, 'scene-lifecycle', ...phases].join('\0');
}

/** Lookup for lifecycle policy accepted into generated native composition. */
export class GodotLifecycleAuthorityResolver {
  readonly sourceRevision: string;
  readonly #rules: ReadonlyMap<string, GodotLifecycleRule>;
  readonly #projectStartupRules: ReadonlyMap<string, GodotProjectStartupRule>;
  readonly #mainLoopRules: ReadonlyMap<string, GodotMainLoopRule>;

  constructor(authority: GodotLifecycleAuthority) {
    if (authority.version !== GODOT_LIFECYCLE_AUTHORITY_VERSION) {
      throw new Error(`unsupported Godot lifecycle authority: ${String(authority.version)}`);
    }
    this.sourceRevision = authority.sourceRevision;
    for (const rule of [...authority.rules, ...authority.projectStartupRules, ...authority.mainLoopRules]) {
      if (rule.sourceRevision !== authority.sourceRevision) {
        throw new Error(`Godot lifecycle rule has a different source: ${rule.targetOperation}`);
      }
    }
    this.#mainLoopRules = new Map(authority.mainLoopRules.map((rule) => [godotMainLoopRuleKey(rule.sourceRevision), rule]));
    this.#rules = new Map(
      authority.rules.map((rule) => [
        godotLifecycleRuleKey(rule.sourceRevision, rule.phases),
        rule,
      ]),
    );
    this.#projectStartupRules = new Map(
      authority.projectStartupRules.map((rule) => [
        godotProjectStartupRuleKey(rule.sourceRevision),
        rule,
      ]),
    );
    if (
      this.#rules.size !== authority.rules.length ||
      this.#projectStartupRules.size !== authority.projectStartupRules.length ||
      this.#mainLoopRules.size !== authority.mainLoopRules.length
    ) {
      throw new Error('Godot lifecycle authority contains duplicate identities.');
    }
  }

  projectStartupRule(): GodotProjectStartupRule | undefined {
    return this.#projectStartupRules.get(godotProjectStartupRuleKey(this.sourceRevision));
  }

  /** The rule for `Main`'s loop around every translated project, or undefined. */
  mainLoopRule(): GodotMainLoopRule | undefined {
    return this.#mainLoopRules.get(godotMainLoopRuleKey(this.sourceRevision));
  }

  rule(phases: readonly DirectGodotLifecyclePhase[]): GodotLifecycleRule | undefined {
    return this.#rules.get(godotLifecycleRuleKey(this.sourceRevision, phases));
  }
}
