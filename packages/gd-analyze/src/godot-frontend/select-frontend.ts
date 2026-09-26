import type { GodotProjectSnapshot } from '../snapshot/project-snapshot';
import { type GodotSourceAuthority, godotSourceAuthority } from './source-authority';

const GODOT_4_7_SOURCE_FEATURE = '4.7';

/**
 * The complete feature vocabulary accepted by the pinned 4.7 frontend build.
 *
 * Godot owns this vocabulary in `ProjectSettings::_get_supported_features`. The importer accepts
 * only tags whose effect on source binding is represented by the selected pin. Renderer tags do
 * not select a different GDScript frontend. Build modes that change the available language or
 * numeric ABI deliberately refuse until this lane has a matching official exporter and target
 * contract.
 */
const GODOT_4_7_FEATURES = {
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
} as const;

type Godot47Feature = keyof typeof GODOT_4_7_FEATURES;

function isGodot47Feature(feature: string): feature is Godot47Feature {
  return Object.hasOwn(GODOT_4_7_FEATURES, feature);
}

function refuse(engine: GodotProjectSnapshot['engine'], reason: string): never {
  throw new Error(
    `project.godot: no exact official bound frontend is pinned for Godot ` +
      `${String(engine.major)} with features [${engine.features.join(', ')}]: ${reason}`,
  );
}

function validateGodot47Features(engine: GodotProjectSnapshot['engine']): void {
  const seen = new Set<string>();
  for (const feature of engine.features) {
    if (seen.has(feature)) refuse(engine, `duplicate feature ${JSON.stringify(feature)}`);
    seen.add(feature);
    if (!isGodot47Feature(feature)) {
      refuse(engine, `unrecognized feature ${JSON.stringify(feature)}`);
    }
    const meaning = GODOT_4_7_FEATURES[feature];
    if (meaning.startsWith('unsupported-')) {
      refuse(engine, `${JSON.stringify(feature)} requires ${meaning.slice('unsupported-'.length)}`);
    }
  }
  if (!seen.has(GODOT_4_7_SOURCE_FEATURE)) {
    refuse(engine, `missing required source-version feature ${GODOT_4_7_SOURCE_FEATURE}`);
  }
}

/** Total declared feature-set mapping. Unsupported pins refuse instead of taking a nearby engine. */
export function selectGodotFrontendAuthority(
  engine: GodotProjectSnapshot['engine'],
): GodotSourceAuthority {
  if (engine.major !== 4) refuse(engine, 'the selected pin requires config_version=5');
  validateGodot47Features(engine);
  return godotSourceAuthority(4);
}
