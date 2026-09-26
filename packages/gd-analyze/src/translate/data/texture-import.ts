/**
 * translate/data/texture-import.ts — one texture's `.import` sidecar as the SAMPLER the port configures.
 *
 * ## The defect this closes
 *
 * Every texture consumption site in the three lane loads a bare `.png` and stops there, so every
 * one of them samples with THREE's defaults: `ClampToEdgeWrapping`, anisotropy 1. Godot samples
 * with the state its importer baked into the `.stex` it actually renders, which the `<file>.import`
 * beside the source records verbatim. The two disagree on this project's own stage atlas
 * (`stage/texture.png` authors `flags/repeat=1` and `flags/anisotropic=true`, and the project
 * authors `anisotropic_filter_level=16`), and the disagreement is visible: a repeating texture
 * drawn clamped smears its edge texel across every UV outside [0,1], and anisotropy 1 turns a
 * tile floor to mush at grazing angles.
 *
 * ## What is carried, and what is a note
 *
 * `flags/repeat`, `flags/filter`, `flags/mipmaps` and `flags/anisotropic` (× the project's own
 * level) all have EXACT three counterparts, listed in {@link EmittedTextureConfig}.
 *
 * `flags/srgb` is the consuming SLOT's decision rather than the image's — an albedo map is sRGB, a
 * metal/rough data map is linear, and three's `colorSpace` lives on the shared `Texture` where one
 * image bound as both would need two values. Enable and Detect are what the emitted slots already
 * do; Disable is the one value they cannot reproduce, and it is noted.
 *
 * `process/premult_alpha` is NOT carried, and that is arithmetic rather than an omission. Godot's
 * importer pre-multiplies the IMAGE: the `.stex` holds `rgb*a`, and the material still blends Mix,
 * so the frame gets `rgb*a² + dst*(1-a)`. The port loads the ORIGINAL `.png`, whose texels are not
 * premultiplied, and three's `Material.premultipliedAlpha` changes the BLEND EQUATION rather than
 * the texel — `src=ONE`, giving `rgb + dst*(1-a)`. Neither of those is the other, so setting the
 * three flag would be the plausible-and-wrong outcome this lane refuses; it is recorded instead.
 *
 * ## This module owns the whole CALL, not just its argument
 *
 * {@link renderConfigureGodotTexture} writes the `configureGodotTexture(...)` every texture
 * consumption site in the three lane goes through, and it is written even for a texture whose
 * sidecar authored nothing. That is because compat's other job — Godot's V origin, `flipY = false`
 * — is a fact about GODOT rather than about any one sidecar, so a site that skipped the call
 * because there was no sampler to apply would sample the image vertically mirrored. There is no
 * emitted spelling of a bare loaded texture.
 *
 * ## Anisotropy is NOT clamped here, because three already clamps it
 *
 * A project may author 16 on hardware that offers less. three's own `WebGLTextures` uploads
 * `Math.min(texture.anisotropy, capabilities.getMaxAnisotropy())`
 * (`src/renderers/webgl/WebGLTextures.js`, the `TEXTURE_MAX_ANISOTROPY_EXT` call), so the authored
 * level rides straight through and the renderer's own capability is what binds. Threading a
 * renderer into the compat helper to re-do that clamp would be machinery with no effect.
 */
import type { GodotTextureImportFlags, ImportSidecar } from '../../read/import-sidecar';
import { TEXTURE_REPEAT } from '../../read/import-sidecar';
import { num, quote, type TranslationNote } from './model';

/**
 * The sampler state the emitted port applies to one loaded texture — the argument to
 * `godot-compat`'s `configureGodotTexture`.
 *
 * Declared HERE rather than imported from three, for the reason `translate/rendering.ts` declares
 * its own renderer config: this package emits SOURCE TEXT, and the emitted text is typechecked
 * against the real three types by the port fixture's own tsconfig.
 *
 * Every field is optional and an ABSENT one means the sidecar authored nothing, so three's own
 * default stands — never a default this stage invented.
 */
export interface EmittedTextureConfig {
  /** `flags/repeat` → `wrapS`/`wrapT`. */
  readonly repeat?: 'clamp' | 'repeat' | 'mirror';
  /** `flags/filter` → `magFilter`, and the non-mip half of `minFilter`. */
  readonly filter?: 'linear' | 'nearest';
  /** `flags/mipmaps` → `generateMipmaps`, and the mip half of `minFilter`. */
  readonly mipmaps?: boolean;
  /** `flags/anisotropic` × the project's `anisotropic_filter_level` → `Texture.anisotropy`. */
  readonly anisotropy?: number;
}

/** Godot 3's `flags/srgb` value that turns the sRGB decode OFF — the one the emitted albedo slot
 *  cannot reproduce. `1` (Enable) and `2` (Detect) are both what it already does. */
const TEXTURE_SRGB_DISABLE = 0;

/** Godot 3's `flags/repeat` enum → three's wrapping mode. */
const REPEAT_TO_WRAP: Readonly<Record<number, 'clamp' | 'repeat' | 'mirror'>> = {
  [TEXTURE_REPEAT.disabled]: 'clamp',
  [TEXTURE_REPEAT.enabled]: 'repeat',
  [TEXTURE_REPEAT.mirrored]: 'mirror',
};

export interface TextureImportTranslation {
  /** Absent when the sidecar authored nothing three's defaults do not already do. */
  readonly config?: EmittedTextureConfig;
  readonly notes: readonly TranslationNote[];
}

export interface TranslateTextureImportOptions {
  /** The dialect-resolved project anisotropic SAMPLE COUNT. Absent means the project declared
   *  none, and a texture that opts in gets a NOTE rather than an invented level. */
  readonly anisotropicFilterLevel?: number;
}

/**
 * One `texture` sidecar's flags → the sampler the port configures, plus every flag that could not
 * come with it.
 *
 * `at` is the source location a note cites — the sidecar's own `res://` path.
 */
export function translateTextureImport(
  flags: GodotTextureImportFlags,
  at: string,
  options: TranslateTextureImportOptions = {},
): TextureImportTranslation {
  const notes: TranslationNote[] = [];
  const config: {
    repeat?: 'clamp' | 'repeat' | 'mirror';
    filter?: 'linear' | 'nearest';
    mipmaps?: boolean;
    anisotropy?: number;
  } = {};

  if (flags.repeat !== undefined) {
    const wrap = REPEAT_TO_WRAP[flags.repeat];
    if (wrap === undefined) {
      notes.push({
        at,
        message:
          `\`flags/repeat = ${String(flags.repeat)}\` is not one of Godot 3's three modes ` +
          '(0 Disabled, 1 Enabled, 2 Mirrored), so no wrapping is carried and the texture samples ' +
          "with three's own default (clamp to edge).",
      });
    } else {
      config.repeat = wrap;
    }
  }

  if (flags.filter !== undefined) config.filter = flags.filter ? 'linear' : 'nearest';
  if (flags.mipmaps !== undefined) config.mipmaps = flags.mipmaps;

  if (flags.anisotropic === true) {
    const level = options.anisotropicFilterLevel;
    if (level === undefined) {
      notes.push({
        at,
        message:
          '`flags/anisotropic = true` opts this texture into the project’s anisotropic filter ' +
          'level, but `project.godot` declares no ' +
          '`[rendering] quality/filters/anisotropic_filter_level`. The level is a PROJECT setting ' +
          "and the sidecar does not carry one, so none is invented and the texture samples at three's " +
          'default anisotropy of 1 — blurrier than Godot at grazing angles.',
      });
    } else {
      config.anisotropy = level;
    }
  }

  // `flags/srgb` is 0 Disable / 1 Enable / 2 Detect. The emitted albedo slot states
  // `map-colorSpace={SRGBColorSpace}` unconditionally — correct for Enable, and for Detect on the
  // LDR colour images every measured project imports — and the metal/rough slots state nothing,
  // which is three's linear default and what a data map wants. DISABLE is the one value neither
  // slot reproduces: Godot samples those texels raw, and the port would sRGB-decode an albedo that
  // was never encoded. It is not carried per-texture because three's `colorSpace` lives on the
  // shared `Texture` while the decision belongs to the SLOT, so a single image bound as both an
  // albedo and a data map would need two — and nothing measured authors it.
  if (flags.srgb === TEXTURE_SRGB_DISABLE) {
    notes.push({
      at,
      message:
        '`flags/srgb = 0` (Disable) is not carried: Godot samples this texture’s texels raw, while ' +
        'the emitted albedo slot states `map-colorSpace={SRGBColorSpace}` for every carried ' +
        'texture. three’s colour space lives on the shared `Texture` and this decision belongs to ' +
        'the consuming SLOT, so it is recorded rather than applied per-image. An albedo bound to ' +
        'this texture renders DARKER than Godot draws it.',
    });
  }

  if (flags.premultAlpha === true) {
    notes.push({
      at,
      message:
        '`process/premult_alpha = true` is not carried: Godot pre-multiplies the IMAGE at import ' +
        '(the `.stex` holds `rgb*a`, and a Mix-blended material then composites `rgb*a² + ' +
        'dst*(1-a)`), while the port loads the original `.png` and three’s `premultipliedAlpha` ' +
        'changes the BLEND EQUATION instead (`rgb + dst*(1-a)`). The two are different operations, ' +
        'so neither three spelling reproduces Godot’s composite and none is emitted.',
    });
  }

  return {
    ...(Object.keys(config).length === 0 ? {} : { config }),
    notes,
  };
}

/**
 * One sampler as the object literal `godot-compat`'s `configureGodotTexture` is called with.
 *
 * Written once here rather than at each emission site, because both consumers (a scene's hoisted
 * `useTexture`, the world's panorama) must spell the same call — and an ABSENT field stays absent:
 * compat leaves three's own default alone rather than the emitter reasserting it.
 */
export function renderTextureConfig(config: EmittedTextureConfig): string {
  return `{ ${samplerFields(config).join(', ')} }`;
}

/** One sampler's fields, as the `key: value` sources they are spelled with. */
function samplerFields(config: EmittedTextureConfig): string[] {
  return [
    ...(config.repeat === undefined ? [] : [`repeat: ${quote(config.repeat)}`]),
    ...(config.filter === undefined ? [] : [`filter: ${quote(config.filter)}`]),
    ...(config.mipmaps === undefined ? [] : [`mipmaps: ${String(config.mipmaps)}`]),
    ...(config.anisotropy === undefined ? [] : [`anisotropy: ${num(config.anisotropy)}`]),
  ];
}

/**
 * The WHOLE `configureGodotTexture(...)` call one loaded-texture expression is wrapped in.
 *
 * Every texture the three lane loads goes through this, INCLUDING one whose `.import` authored no
 * sampler at all: the helper's other job is Godot's V origin (`flipY = false`), which is a fact
 * about Godot rather than about the sidecar, so a bare `useTexture(url)` would sample the image
 * vertically mirrored. That is why the emitter never writes the loaded expression on its own, and
 * why the config argument is omitted rather than spelled `{}` when there is nothing to say.
 *
 * `slot` carries the one thing that is NOT the image's: how the consuming slot addresses it. Only
 * an equirectangular panorama differs, and `godot-compat`'s `GodotTextureConfig.sampling` states
 * why.
 */
export function renderConfigureGodotTexture(
  loaded: string,
  config: EmittedTextureConfig | undefined,
  slot: { readonly sampling?: 'equirect' } = {},
): string {
  const fields = [
    ...(slot.sampling === undefined ? [] : [`sampling: ${quote(slot.sampling)}`]),
    ...(config === undefined ? [] : samplerFields(config)),
  ];
  if (fields.length === 0) return `configureGodotTexture(${loaded})`;
  return `configureGodotTexture(${loaded}, { ${fields.join(', ')} })`;
}

/**
 * Every `texture` sidecar in a project, translated once, keyed by the SOURCE image's `res://` path
 * — which is what a material's `ExtResource` names.
 *
 * One pass over the project rather than one per consuming slot: `stage/texture.png` is bound by two
 * documents and drawn by 2,598 GridMap cells, and translating it per slot would multiply every
 * `premult_alpha` note by its consumers.
 */
export function resolveTextureImports(input: {
  readonly imports: readonly ImportSidecar[];
  readonly anisotropicFilterLevel?: number;
}): { byResPath: ReadonlyMap<string, EmittedTextureConfig>; notes: readonly TranslationNote[] } {
  const byResPath = new Map<string, EmittedTextureConfig>();
  const notes: TranslationNote[] = [];
  for (const sidecar of input.imports) {
    if (sidecar.importer !== 'texture') continue;
    const source = sidecar.sourceFile;
    const flags = sidecar.textureFlags;
    if (source === undefined || flags === undefined) continue;
    const translation = translateTextureImport(flags, sidecar.resPath, {
      ...(input.anisotropicFilterLevel === undefined
        ? {}
        : { anisotropicFilterLevel: input.anisotropicFilterLevel }),
    });
    notes.push(...translation.notes);
    if (translation.config !== undefined) byResPath.set(source, translation.config);
  }
  return { byResPath, notes };
}
