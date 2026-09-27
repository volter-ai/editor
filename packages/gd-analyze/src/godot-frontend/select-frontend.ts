import type { GodotProjectSnapshot } from '../snapshot/project-snapshot';
import { GODOT_4_SOURCE_AUTHORITIES, type GodotSourceAuthority } from './source-authority';

/** The one pinned Godot 4 release every 4.x project runs under. */
const PINNED_MINOR = 7;

/**
 * A project's feature vocabulary for its authored release `4.<minor>`.
 *
 * Godot owns this vocabulary in `ProjectSettings::_get_supported_features` (4.6:
 * `core/config/project_settings.cpp:86-111`; 4.7: `:91-116`, the same code): the required
 * `GODOT_VERSION_BRANCH` plus `Double Precision` under `REAL_T_IS_DOUBLE`, `LibGodot`, `C#`,
 * `<branch>.<patch>`, `GODOT_VERSION_FULL_CONFIG`, `GODOT_VERSION_FULL_BUILD` and the renderer tags.
 * Measured on 4.6 and 4.7; for an older minor the same shape is assumed, and a tag outside it
 * refuses by name. Renderer tags do not select a different GDScript frontend. Build modes that
 * change the available language or numeric ABI deliberately refuse until this lane has a matching
 * official exporter and target contract.
 */
function featureVocabulary(minor: number): Readonly<Record<string, string>> {
  const branch = `4.${String(minor)}`;
  return {
    [branch]: 'source-version',
    [`${branch}.0`]: 'source-patch',
    [`${branch}.stable`]: 'source-build',
    [`${branch}.stable.official`]: 'source-build',
    [`${branch}.stable.custom_build`]: 'source-build',
    'Forward Plus': 'renderer',
    Mobile: 'renderer',
    'GL Compatibility': 'renderer',
    'C#': 'unsupported-language-module',
    'Double Precision': 'unsupported-numeric-abi',
    LibGodot: 'unsupported-host-mode',
  };
}

function refuse(engine: GodotProjectSnapshot['engine'], reason: string): never {
  throw new Error(
    `project.godot: no exact official bound frontend is pinned for Godot ` +
      `${String(engine.major)} with features [${engine.features.join(', ')}]: ${reason}`,
  );
}

/** The minor of the one `4.<minor>` source-version feature the project declares; none or several refuse. */
function declaredMinor(engine: GodotProjectSnapshot['engine']): number {
  const versions = engine.features.filter((feature) => /^4\.\d+$/u.test(feature));
  if (versions.length === 0) refuse(engine, 'missing a 4.<minor> source-version feature');
  if (new Set(versions).size > 1) {
    refuse(engine, `declares more than one source-version feature (${versions.join(', ')})`);
  }
  return Number((versions[0] as string).slice(2));
}

function validateGodot4Features(engine: GodotProjectSnapshot['engine'], minor: number): void {
  const vocabulary = featureVocabulary(minor);
  const seen = new Set<string>();
  for (const feature of engine.features) {
    if (seen.has(feature)) refuse(engine, `duplicate feature ${JSON.stringify(feature)}`);
    seen.add(feature);
    const meaning = vocabulary[feature];
    if (meaning === undefined) {
      refuse(engine, `unrecognized feature ${JSON.stringify(feature)} for Godot 4.${String(minor)}`);
    }
    if (meaning.startsWith('unsupported-')) {
      refuse(engine, `${JSON.stringify(feature)} requires ${meaning.slice('unsupported-'.length)}`);
    }
  }
}

/** The pinned authority a project runs under, and the release it was authored in. */
export interface GodotSelectedFrontend {
  readonly authority: GodotSourceAuthority;
  /** The project's own `4.<minor>` source-version feature. */
  readonly projectVersion: string;
}

/**
 * Godot 4 minor releases are forward-compatible: a 4.x project opens in the pinned 4.7 editor, which
 * upgrades it in place. So a project authored in 4.x with x at most 7 runs under the 4.7 authority
 * (its exporter, its editor's `--headless --import`, every table); one authored in a newer release
 * refuses by name. The measured 4.6-to-4.7 deltas are `authority/godot-4.6/`'s disagreeing cases.
 */
export function selectGodotFrontendAuthority(engine: GodotProjectSnapshot['engine']): GodotSelectedFrontend {
  if (engine.major !== 4) refuse(engine, 'the selected pin requires config_version=5');
  const minor = declaredMinor(engine);
  if (minor > PINNED_MINOR) {
    refuse(engine, `the project is authored in Godot 4.${String(minor)}, newer than the pinned 4.${String(PINNED_MINOR)}`);
  }
  validateGodot4Features(engine, minor);
  return { authority: GODOT_4_SOURCE_AUTHORITIES['4.7'], projectVersion: `4.${String(minor)}` };
}
