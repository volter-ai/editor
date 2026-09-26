/**
 * SFZ INSTRUMENTS AS A SOUNDFONT BANK, so a sampled library plays through the one engine the
 * editor and the export share (SpessaSynth): each SFZ file becomes one preset, its regions the
 * zones of one instrument, written with SpessaSynth's own bank writer.
 *
 * Translated, from what the library at hand uses (VSCO 2 Community Edition counts every opcode
 * below): `sample`, `lokey`/`hikey`, `lovel`/`hivel`, `pitch_keycenter`, `tune`, `volume`,
 * `ampeg_attack`, `ampeg_release`, and `default_path` from `<control>`, with `<global>` and
 * `<group>` values inherited by their regions. A SoundFont has no round robin, so a patch with
 * round-robin sets (`seq_position`, or `lorand` ranges) becomes one preset per member: the first
 * at the patch's own bank and program, member n at bank + (n − 1) with the same program, named
 * `<name> ~n` (`roundRobins` reads that back, and the players step through the members note by
 * note). A drum kit keeps its first member: the drum channel does not select kits by bank. A
 * stereo sample becomes a linked
 * left/right pair panned hard. Any other opcode on a region is refused by name, never dropped.
 *
 * LEVEL: SFZ `volume` is a gain in dB that may boost, and a SoundFont zone can only attenuate. So
 * each region's gain is baked into its sample's data, less one headroom for the whole bank: the
 * highest sample peak plus gain among the regions converted, so no sample clips. Every preset
 * keeps its level relative to the others, and the bank as a whole sits that headroom below the
 * SFZ's own level (12 dB for VSCO 2 CE's violins and flute; a table build takes the whole
 * library's, `sfzHeadroom`, so instruments in separate banks keep their balance). Attenuating from the loudest
 * `volume` instead put the flute 34 dB below its SFZ level. A sample two regions share at
 * different gains keeps the higher gain in its data and attenuates the other zone; SpessaSynth
 * reads `initialAttenuation` at 0.4 of its value (the E-mu convention), so N dB is written as 25·N.
 */

import { BasicInstrument, BasicPreset, BasicSoundBank, EmptySample, GeneratorTypes, type SampleEncodingFunction, SampleTypes } from 'spessasynth_core';

export interface SfzPatch {
  /** The preset's name in the bank. */
  readonly name: string;
  readonly program: number;
  readonly bankNumber?: number;
  /** The SFZ file's text. */
  readonly sfz: string;
  /** Resolve a region's sample (its `default_path` + `sample`, forward slashes) to its audio. */
  readonly sample: (path: string) => { readonly channels: readonly Float32Array[]; readonly sampleRate: number };
}

const TRANSLATED = new Set(['sample', 'lokey', 'hikey', 'lovel', 'hivel', 'pitch_keycenter', 'tune', 'volume', 'ampeg_attack', 'ampeg_release']);
/** Opcodes that say nothing a SoundFont zone can hold, and change nothing when left out. */
const IGNORED = new Set(['ampeg_dynamic', 'group_label', 'sw_label', 'seq_length', 'hirand']);

type Opcodes = Record<string, string>;

/** Regions with their inherited opcodes, and the control section's `default_path`. */
function parseSfz(text: string): { regions: Opcodes[]; defaultPath: string } {
  const lines = text.replace(/\r/g, '').split('\n').map((line) => line.replace(/\/\/.*$/, '').trim());
  let header = '';
  let control: Opcodes = {};
  let global: Opcodes = {};
  let group: Opcodes = {};
  let region: Opcodes | null = null;
  const regions: Opcodes[] = [];
  const close = (): void => {
    if (region) regions.push({ ...global, ...group, ...region });
    region = null;
  };
  for (const line of lines) {
    if (!line) continue;
    for (const token of line.split(/(?=<[a-z]+>)/)) {
      const headerMatch = /^<([a-z]+)>\s*(.*)$/.exec(token);
      let rest = token;
      if (headerMatch) {
        close();
        header = headerMatch[1]!;
        if (header === 'control') control = {};
        if (header === 'global') global = {};
        if (header === 'group') group = {};
        if (header === 'region') region = {};
        rest = headerMatch[2] ?? '';
      }
      // A value runs to the next opcode: `sample=` paths may hold spaces.
      for (const match of rest.matchAll(/([a-z_0-9]+)=(.*?)(?=\s+[a-z_0-9]+=|$)/g)) {
        const target = header === 'control' ? control : header === 'global' ? global : header === 'group' ? group : region;
        if (target) target[match[1]!] = match[2]!.trim();
      }
    }
  }
  close();
  return { regions, defaultPath: (control['default_path'] ?? '').replace(/\\/g, '/') };
}

function timecents(seconds: number): number {
  return Math.round(1200 * Math.log2(Math.max(0.001, seconds)));
}

/** The samples an SFZ file's converted regions read (after round robins keep their first), relative to its library. */
export function sfzSamples(sfz: string): string[] {
  return [...new Set(convertedRegions([{ name: 'sfz', program: 0, sfz, sample: () => ({ channels: [], sampleRate: 0 }) }])[0]!.regions.map((region) => region.path))];
}

/** Every region to convert, with its sample path and its gain. */
function convertedRegions(patches: readonly SfzPatch[]) {
  return patches.map((patch) => {
    const { regions, defaultPath } = parseSfz(patch.sfz);
    const kept = regions.filter((region) => {
      for (const opcode of Object.keys(region)) {
        if (TRANSLATED.has(opcode) || IGNORED.has(opcode) || /^(seq_position|lorand|sw_)/.test(opcode)) continue;
        throw new Error(`${patch.name}: the opcode ${opcode} has no translation to a SoundFont zone.`);
      }
      return true;
    });
    // A region's round-robin member (from 0), or -1 when it sounds in every member.
    const randomStarts = [...new Set(kept.filter((region) => region['lorand'] !== undefined).map((region) => Number(region['lorand'])))].sort((a, b) => a - b);
    const memberOf = (region: Opcodes): number =>
      region['seq_position'] !== undefined ? Number(region['seq_position']) - 1 : region['lorand'] !== undefined ? randomStarts.indexOf(Number(region['lorand'])) : -1;
    const drums = (patch.bankNumber ?? 0) >= 128;
    return {
      patch,
      regions: kept
        .map((region) => ({ region, member: memberOf(region), path: `${defaultPath}${region['sample']!.replace(/\\/g, '/')}`, gainDb: Number(region['volume'] ?? 0) }))
        .filter((region) => !drums || region.member <= 0),
    };
  });
}

function peakDbOf(audio: { readonly channels: readonly Float32Array[] }): number {
  let peak = 0;
  for (const channel of audio.channels) for (const value of channel) peak = Math.max(peak, Math.abs(value));
  return 20 * Math.log10(Math.max(peak, 1e-9));
}

/**
 * The headroom these patches need: their highest sample peak plus gain (0 when none boosts past
 * full scale). Banks built separately from one library take the library's headroom, so their
 * instruments keep their levels relative to one another across banks.
 */
export function sfzHeadroom(patches: readonly SfzPatch[]): number {
  let headroom = 0;
  for (const { patch, regions } of convertedRegions(patches)) {
    for (const { path, gainDb } of regions) headroom = Math.max(headroom, peakDbOf(patch.sample(path)) + gainDb);
  }
  return headroom;
}

/**
 * The bank's bytes: one preset per patch, `headroomDb` below the SFZ's own level (default: what
 * these patches need). With `compress`, an SF3: every sample Ogg Vorbis. The engine keeps an SF3's
 * samples compressed and decodes one when a note first plays it, so a piece holds the samples it
 * uses rather than the whole bank: nine uncompressed banks took an editor tab from 259 MB to
 * 1,460 MB.
 */
export async function sfzBank(patches: readonly SfzPatch[], headroomDb?: number, compress?: SampleEncodingFunction): Promise<ArrayBuffer> {
  const converted = convertedRegions(patches);
  const audio = new Map<string, { readonly channels: readonly Float32Array[]; readonly sampleRate: number }>();
  const gainOf = new Map<string, number>();
  for (const { patch, regions } of converted) {
    for (const { path, gainDb } of regions) {
      if (!audio.has(path)) audio.set(path, patch.sample(path));
      gainOf.set(path, Math.max(gainOf.get(path) ?? -Infinity, gainDb));
    }
  }
  const needed = Math.max(0, ...[...gainOf].map(([path, gain]) => peakDbOf(audio.get(path)!) + gain));
  if (headroomDb !== undefined && headroomDb < needed - 1e-9) throw new Error(`These patches need ${needed.toFixed(1)} dB of headroom; ${headroomDb} dB would clip.`);
  const headroom = headroomDb ?? needed;

  const bank = new BasicSoundBank();
  bank.soundBankInfo.name = 'VSCO 2 CE';
  // A fixed date (VSCO 2 CE 1.1.0's release), so the same library builds the same bytes.
  bank.soundBankInfo.creationDate = new Date('2021-04-06T00:00:00Z');
  const samples = new Map<string, EmptySample[]>();
  const sampleFor = (path: string, key: number): EmptySample[] => {
    const cached = samples.get(path);
    if (cached) return cached;
    const source = audio.get(path)!;
    const scale = 10 ** ((gainOf.get(path)! - headroom) / 20);
    const made = source.channels.slice(0, 2).map((data, index) => {
      const sample = new EmptySample();
      sample.name = `${path.split('/').pop()!.replace(/\.wav$/i, '')}${source.channels.length > 1 ? (index === 0 ? 'L' : 'R') : ''}`.slice(0, 20);
      sample.setAudioData(data.map((value) => value * scale), source.sampleRate);
      sample.originalKey = key;
      return sample;
    });
    if (made.length === 2) made[0]!.setLinkedSample(made[1]!, SampleTypes.leftSample);
    bank.addSamples(...made);
    samples.set(path, made);
    return made;
  };
  for (const { patch, regions } of converted) {
    const members = Math.max(1, ...regions.map((region) => region.member + 1));
    for (let member = 0; member < members; member++) {
      const instrument = new BasicInstrument();
      const name = members > 1 && member > 0 ? `${patch.name.slice(0, 16)} ~${member + 1}` : patch.name.slice(0, 20);
      instrument.name = name;
      for (const { region, path, gainDb } of regions.filter((candidate) => candidate.member === -1 || candidate.member === member)) {
        const key = Number(region['pitch_keycenter'] ?? 60);
        const parts = sampleFor(path, key);
        parts.forEach((sample, index) => {
          const zone = instrument.createZone(sample);
          zone.keyRange = { min: Number(region['lokey'] ?? 0), max: Number(region['hikey'] ?? 127) };
          zone.velRange = { min: Number(region['lovel'] ?? 0), max: Number(region['hivel'] ?? 127) };
          zone.setGenerator(GeneratorTypes.overridingRootKey, key);
          const below = gainOf.get(path)! - gainDb;
          if (below > 0) zone.setGenerator(GeneratorTypes.initialAttenuation, Math.round(below * 25));
          if (region['tune'] !== undefined) zone.setGenerator(GeneratorTypes.fineTune, Number(region['tune']));
          if (region['ampeg_attack'] !== undefined) zone.setGenerator(GeneratorTypes.attackVolEnv, timecents(Number(region['ampeg_attack'])));
          if (region['ampeg_release'] !== undefined) zone.setGenerator(GeneratorTypes.releaseVolEnv, timecents(Number(region['ampeg_release'])));
          if (parts.length === 2) zone.setGenerator(GeneratorTypes.pan, index === 0 ? -500 : 500);
        });
      }
      bank.addInstruments(instrument);
      const preset = new BasicPreset(bank);
      preset.name = name;
      preset.program = patch.program;
      preset.bankMSB = (patch.bankNumber ?? 0) + member;
      preset.createZone(instrument);
      bank.addPresets(preset);
    }
  }
  if (compress) await bank.setSampleFormat({ format: 'compressed', compressionFunction: compress });
  return bank.writeSF2();
}

/**
 * How many round-robin members a patch has in a loaded bank: its preset at `bankMSB` and
 * `program`, then one preset per further member at bankMSB + 1, + 2, … named `~2`, `~3`, …
 * (as `sfzBank` writes them). 1 for any other preset.
 */
export function roundRobins(presets: readonly { readonly name: string; readonly bankMSB: number; readonly program: number }[], bankMSB: number, program: number): number {
  let count = 1;
  while (presets.some((preset) => preset.bankMSB === bankMSB + count && preset.program === program && preset.name.endsWith(` ~${count + 1}`))) count++;
  return count;
}
