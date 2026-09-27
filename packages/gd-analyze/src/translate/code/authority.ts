import { GodotBindingResolver, type GodotBindingTable } from './bindings';
import { GodotCodeRuleResolver, type GodotCodeRuleTable } from './lowering-rules';

export const GODOT_CODE_TRANSLATION_AUTHORITY_VERSION = 1 as const;

/** The one immutable table of what direct code lowering may translate a construct to. */
export interface GodotCodeTranslationAuthority {
  readonly version: typeof GODOT_CODE_TRANSLATION_AUTHORITY_VERSION;
  readonly sourceRevision: string;
  readonly apiDumpSha256: string;
  readonly bindings: GodotBindingTable;
  readonly rules: GodotCodeRuleTable;
}

/** The authority's resolved lookup surfaces. */
export class GodotCodeTranslationAuthorityResolver {
  readonly bindings: GodotBindingResolver;
  readonly rules: GodotCodeRuleResolver;
  readonly sourceRevision: string;

  constructor(authority: GodotCodeTranslationAuthority) {
    if (authority.version !== GODOT_CODE_TRANSLATION_AUTHORITY_VERSION) {
      throw new Error(`unsupported Godot code authority version: ${String(authority.version)}`);
    }
    if (
      authority.bindings.sourceRevision !== authority.sourceRevision ||
      authority.rules.sourceRevision !== authority.sourceRevision
    ) {
      throw new Error('Godot code authority tables do not share one source revision');
    }
    this.bindings = new GodotBindingResolver(authority.bindings);
    this.rules = new GodotCodeRuleResolver(authority.rules);
    this.sourceRevision = authority.sourceRevision;
  }
}
