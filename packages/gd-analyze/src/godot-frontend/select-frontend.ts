import type { GodotProjectSnapshot } from '../snapshot/project-snapshot';
import { GODOT_4_SOURCE_AUTHORITIES, type GodotSourceAuthority } from './source-authority';

/**
 * The complete feature vocabulary accepted by each pinned Godot 4 frontend build.
 *
 * Godot owns this vocabulary in `ProjectSettings::_get_supported_features` (4.6:
 * `core/config/project_settings.cpp:86-111`; 4.7: `:91-116`, the same code): the required
 * `GODOT_VERSION_BRANCH` plus `Double Precision` under `REAL_T_IS_DOUBLE`, `LibGodot`, `C#`,
 * `<branch>.<patch>`, `GODOT_VERSION_FULL_CONFIG`, `GODOT_VERSION_FULL_BUILD` and the renderer tags.
 * The importer accepts only tags whose effect on source binding is represented by the selected
 * pin. Renderer tags do not select a different GDScript frontend. Build modes that change the
 * available language or numeric ABI deliberately refuse until this lane has a matching official
 * exporter and target contract.
 */
const GODOT_4_FEATURES = {
  '4.6': {
    '4.6': 'source-version',
    '4.6.0': 'source-patch',
    '4.6.stable': 'source-build',
    '4.6.stable.official': 'source-build',
    '4.6.stable.custom_build': 'source-build',
    'Forward Plus': 'renderer',
    Mobile: 'renderer',
    'GL Compatibility': 'renderer',
    'C#': 'unsupported-language-module',
    'Double Precision': 'unsupported-numeric-abi',
    LibGodot: 'unsupported-host-mode',
  },
  '4.7': {
    '4.7': 'source-version',
    '4.7.0': 'source-patch',
    '4.7.stable': 'source-build',
    '4.7.stable.official': 'source-build',
    '4.7.stable.custom_build': 'source-build',
    'Forward Plus': 'renderer',
    Mobile: 'renderer',
    'GL Compatibility': 'renderer',
    'C#': 'unsupported-language-module',
    'Double Precision': 'unsupported-numeric-abi',
    LibGodot: 'unsupported-host-mode',
  },
} as const;

type Godot4SourceVersion = keyof typeof GODOT_4_FEATURES;

function isGodot4SourceVersion(feature: string): feature is Godot4SourceVersion {
  return Object.hasOwn(GODOT_4_FEATURES, feature);
}

function refuse(engine: GodotProjectSnapshot['engine'], reason: string): never {
  throw new Error(
    `project.godot: no exact official bound frontend is pinned for Godot ` +
      `${String(engine.major)} with features [${engine.features.join(', ')}]: ${reason}`,
  );
}

/** The one source-version feature the project declares; none or several refuse. */
function declaredSourceVersion(engine: GodotProjectSnapshot['engine']): Godot4SourceVersion {
  const versions = engine.features.filter(isGodot4SourceVersion);
  if (versions.length === 0) {
    refuse(
      engine,
      `missing a pinned source-version feature (${Object.keys(GODOT_4_FEATURES).join(' or ')})`,
    );
  }
  if (new Set(versions).size > 1) {
    refuse(engine, `declares more than one source-version feature (${versions.join(', ')})`);
  }
  return versions[0]!;
}

function validateGodot4Features(
  engine: GodotProjectSnapshot['engine'],
  version: Godot4SourceVersion,
): void {
  const vocabulary: Readonly<Record<string, string>> = GODOT_4_FEATURES[version];
  const seen = new Set<string>();
  for (const feature of engine.features) {
    if (seen.has(feature)) refuse(engine, `duplicate feature ${JSON.stringify(feature)}`);
    seen.add(feature);
    const meaning = vocabulary[feature];
    if (meaning === undefined) {
      refuse(engine, `unrecognized feature ${JSON.stringify(feature)} for Godot ${version}`);
    }
    if (meaning.startsWith('unsupported-')) {
      refuse(engine, `${JSON.stringify(feature)} requires ${meaning.slice('unsupported-'.length)}`);
    }
  }
}

/** Total declared feature-set mapping. Unsupported pins refuse instead of taking a nearby engine. */
export function selectGodotFrontendAuthority(
  engine: GodotProjectSnapshot['engine'],
): GodotSourceAuthority {
  if (engine.major !== 4) refuse(engine, 'the selected pin requires config_version=5');
  const version = declaredSourceVersion(engine);
  validateGodot4Features(engine, version);
  return GODOT_4_SOURCE_AUTHORITIES[version];
}
