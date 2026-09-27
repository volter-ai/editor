/**
 * TIDEWATCH — exploration and battle, one cue.
 *
 * Brief: a coastal watch at night. D minor, 112 BPM, 4/4. Two states the game switches between
 * on a bar line: EXPLORE (bars 1–8), sparse and watchful — pizzicato strings, harp, a flute
 * line; BATTLE (bars 9–16), the same harmony driven — spiccato string ostinato, horns on the
 * theme, timpani and drums. Each section loops into itself and ends on the dominant (A), so
 * either can hand over to the other at its last bar line.
 *
 * Ensemble (VS Chamber Orchestra 2 CE, `sounds/vsco2/*.sf3`): flute, horn, violins, violas,
 * cellos, contrabass, harp, timpani, percussion.
 */
import { Channel, Clip, Device, formatAt, formatPitch, Marker, Note, Point, Points, Project, Send, Track, Transport } from '@volter/dawproject';
import { chordTones, voiceLead } from '../lib/music/voicing';

const VSCO = 'out/vsco2';
const BAR = 4;

/**
 * HARMONY — one chord a bar. Explore walks down from the tonic and turns on the dominant;
 * Battle holds the tonic, climbs to C, and suspends the dominant (Asus4 → A) before handing
 * back. Both end on A, so either section can follow either.
 */
export const EXPLORE = ['Dm', 'Bb', 'F', 'C', 'Dm', 'Gm', 'Bb', 'A'] as const;
export const BATTLE = ['Dm', 'Dm', 'Bb', 'C', 'Gm', 'Bb', 'Asus4', 'A'] as const;

/** The chord's root as the pitch nearest the bottom of [low, high]. */
function root(symbol: string, low: number): number {
  const pc = chordTones(symbol)[0]!;
  let pitch = low;
  while (pitch % 12 !== pc) pitch++;
  return pitch;
}

/** Beats from the piece's start to bar `bar` (from 1), plus `beat` (from 0). */
const at = (bar: number, beat = 0): string => formatAt((bar - 1) * BAR + beat, BAR);

// Harp: broken chords in Explore, voiced for the least motion, low–mid–high–mid in eighths.
const HARP = voiceLead([...EXPLORE], 3, 50, 69);
// Violins: a high held line over Explore's second half, and Battle's ostinato over three voices.
const WATCH = voiceLead(EXPLORE.slice(4), 2, 62, 77);
const OSTINATO = voiceLead([...BATTLE], 3, 62, 77);
// Violas: two sustained inner voices through Battle.
const INNER = voiceLead([...BATTLE], 2, 53, 67);
/** Drum keys in the percussion bank (General MIDI layout). */
const KICK = 'C2';
const SNARE = 'D2';
const CRASH = 'C#3';

export default function Tidewatch() {
  return (
    <Project>
      <Transport tempo={112} meter="4/4" />
      <Marker at="1" name="Explore" />
      <Marker at="9" name="Battle" />
      <Track name="Flute">
        <Channel volume={-6} pan={0.2}>
          <Device plugin="soundfont" name="Flute" params={{ bank: `${VSCO}/flute.sf3`, program: 73, articulations: { staccato: 99, staccatissimo: 99 } }} />
          <Device plugin="humanize" params={{ timingMs: 10, velocity: 0.04, seed: 7 }} />
          <Send to="Hall" level={-12} />
        </Channel>
        <Clip at="1" bars={8} name="Watch theme">
          <Note at="1:3" pitch="A5" dur="q" vel={0.62} />
          <Note at="1:4" pitch="F5" dur="8" vel={0.55} />
          <Note at="1:4.5" pitch="E5" dur="8" vel={0.52} />
          <Note at="2:1" pitch="D5" dur="h." vel={0.6} />
          <Note at="2:4" pitch="F5" dur="q" vel={0.55} />
          <Note at="3:1" pitch="C6" dur="q." vel={0.68} />
          <Note at="3:2.5" pitch="Bb5" dur="8" vel={0.58} />
          <Note at="3:3" pitch="A5" dur="h" vel={0.6} />
          <Note at="4:1" pitch="G5" dur="h." vel={0.62} />
          <Note at="4:4" pitch="E5" dur="q" vel={0.55} />
          <Note at="5:1" pitch="F5" dur="q" vel={0.62} />
          <Note at="5:2" pitch="E5" dur="8" vel={0.55} />
          <Note at="5:2.5" pitch="D5" dur="8" vel={0.55} />
          <Note at="5:3" pitch="A5" dur="h" vel={0.66} />
          <Note at="6:1" pitch="Bb5" dur="h." vel={0.7} />
          <Note at="6:4" pitch="A5" dur="8" vel={0.6} />
          <Note at="6:4.5" pitch="G5" dur="8" vel={0.58} />
          <Note at="7:1" pitch="F5" dur="q." vel={0.62} />
          <Note at="7:2.5" pitch="D5" dur="8" vel={0.55} />
          <Note at="7:3" pitch="F5" dur="q" vel={0.6} />
          <Note at="7:4" pitch="G5" dur="q" vel={0.62} />
          <Note at="8:1" pitch="E5" dur="h" vel={0.6} />
          <Note at="8:3" pitch="C#5" dur="h" vel={0.55} />
        </Clip>
      </Track>
      <Track name="Horns">
        <Channel volume={-8} pan={-0.2}>
          <Device plugin="soundfont" name="Horns" params={{ bank: `${VSCO}/horn.sf3`, program: 60, articulations: { staccato: 108, staccatissimo: 108 } }} />
          <Device plugin="humanize" params={{ timingMs: 10, velocity: 0.04, seed: 11 }} />
          <Send to="Hall" level={-14} />
        </Channel>
        <Clip at="9" bars={8} name="Battle theme">
          <Note at="9:1" pitch="D4" dur="q." vel={0.82} artic="accent" />
          <Note at="9:2.5" pitch="A3" dur="8" vel={0.7} />
          <Note at="9:3" pitch="D4" dur="q" vel={0.78} />
          <Note at="9:4" pitch="F4" dur="q" vel={0.8} />
          <Note at="10:1" pitch="E4" dur="h" vel={0.84} />
          <Note at="10:3" pitch="D4" dur="q" vel={0.76} />
          <Note at="10:4" pitch="C4" dur="q" vel={0.72} />
          <Note at="11:1" pitch="D4" dur="h." vel={0.8} />
          <Note at="11:4" pitch="A4" dur="q" vel={0.78} />
          <Note at="12:1" pitch="G4" dur="h" vel={0.88} artic="accent" />
          <Note at="12:3" pitch="E4" dur="h" vel={0.8} />
          <Note at="13:1" pitch="G4" dur="q." vel={0.86} />
          <Note at="13:2.5" pitch="F4" dur="8" vel={0.76} />
          <Note at="13:3" pitch="D4" dur="h" vel={0.8} />
          <Note at="14:1" pitch="D4" dur="q." vel={0.84} />
          <Note at="14:2.5" pitch="C4" dur="8" vel={0.74} />
          <Note at="14:3" pitch="Bb3" dur="h" vel={0.78} />
          <Note at="15:1" pitch="D4" dur="w" vel={0.86} />
          <Note at="16:1" pitch="E4" dur="h." vel={0.84} />
          <Note at="16:4" pitch="C#4" dur="q" vel={0.8} />
        </Clip>
      </Track>
      <Track name="Violins">
        <Channel volume={-6} pan={-0.35}>
          <Device plugin="soundfont" name="Violins" params={{ bank: `${VSCO}/violins.sf3`, program: 48, articulations: { staccato: 80, staccatissimo: 80, pizzicato: 45, tremolo: 44 } }} />
          <Send to="Hall" level={-12} />
        </Channel>
        <Clip at="5" bars={4} name="Watch">
          <Points target="cc11">
            <Point at="5:1" value={0.45} />
            <Point at="8:1" value={0.8} />
            <Point at="8:4" value={0.55} />
          </Points>
          {WATCH.map((voicing, bar) => (
            <Note key={bar} at={at(bar + 5)} pitch={formatPitch(Math.max(...voicing), true)} dur="w" vel={0.38} artic="tremolo" />
          ))}
        </Clip>
        <Clip at="9" bars={8} name="Ostinato">
          {OSTINATO.flatMap((voicing, bar) => {
            const [low, middle, high] = [...voicing].sort((a, b) => a - b);
            return [middle, high, low, high, middle, high, low, high].map((pitch, step) => (
              <Note key={`${bar}-${step}`} at={at(bar + 9, step * 0.5)} pitch={formatPitch(pitch!, true)} dur="8" vel={step % 4 === 0 ? 0.78 : 0.6} artic="staccato" />
            ));
          })}
        </Clip>
      </Track>
      <Track name="Violas">
        <Channel volume={-8} pan={0.15}>
          <Device plugin="soundfont" name="Violas" params={{ bank: `${VSCO}/violas.sf3`, program: 41, articulations: { staccato: 82, staccatissimo: 82, pizzicato: 83, tremolo: 84 } }} />
          <Send to="Hall" level={-14} />
        </Channel>
        <Clip at="9" bars={8} name="Inner voices">
          {INNER.flatMap((voicing, bar) => voicing.map((pitch, voice) => (
            <Note key={`${bar}-${voice}`} at={at(bar + 9)} pitch={formatPitch(pitch, true)} dur="w" vel={0.58} />
          )))}
        </Clip>
      </Track>
      <Track name="Cellos">
        <Channel volume={-7} pan={0.3}>
          <Device plugin="soundfont" name="Cellos" params={{ bank: `${VSCO}/cellos.sf3`, program: 42, articulations: { staccato: 86, staccatissimo: 86, pizzicato: 87, tremolo: 88 } }} />
          <Send to="Hall" level={-16} />
        </Channel>
        <Clip at="1" bars={8} name="Pizzicato roots">
          {EXPLORE.flatMap((chord, bar) => [
            <Note key={`${bar}-a`} at={at(bar + 1)} pitch={formatPitch(root(chord, 45), true)} dur="q" vel={0.7} artic="pizzicato" />,
            <Note key={`${bar}-b`} at={at(bar + 1, 2.5)} pitch={formatPitch(root(chord, 45) + 7, true)} dur="8" vel={0.55} artic="pizzicato" />,
          ])}
        </Clip>
        <Clip at="9" bars={8} name="Spiccato drive">
          {BATTLE.flatMap((chord, bar) =>
            [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((beat, step) => (
              <Note key={`${bar}-${step}`} at={at(bar + 9, beat)} pitch={formatPitch(root(chord, 45), true)} dur="8" vel={step % 2 === 0 ? 0.82 : 0.62} artic="staccato" />
            )),
          )}
        </Clip>
      </Track>
      <Track name="Contrabass">
        <Channel volume={-9} pan={0.35}>
          <Device plugin="soundfont" name="Contrabass" params={{ bank: `${VSCO}/contrabass.sf3`, program: 43, articulations: { staccato: 90, staccatissimo: 90, pizzicato: 91, tremolo: 92 } }} />
          <Send to="Hall" level={-20} />
        </Channel>
        <Clip at="1" bars={8} name="Pizzicato roots">
          {EXPLORE.map((chord, bar) => (
            <Note key={bar} at={at(bar + 1)} pitch={formatPitch(root(chord, 28), true)} dur="q" vel={0.72} artic="pizzicato" />
          ))}
        </Clip>
        <Clip at="9" bars={8} name="Pedal">
          {BATTLE.flatMap((chord, bar) => [0, 2].map((beat) => (
            <Note key={`${bar}-${beat}`} at={at(bar + 9, beat)} pitch={formatPitch(root(chord, 28), true)} dur="q" vel={0.85} artic="staccato" />
          )))}
        </Clip>
      </Track>
      <Track name="Harp">
        <Channel volume={-10} pan={-0.1}>
          <Device plugin="soundfont" name="Harp" params={{ bank: `${VSCO}/harp.sf3`, program: 46 }} />
          <Send to="Hall" level={-10} />
        </Channel>
        <Clip at="1" bars={8} name="Broken chords">
          {HARP.flatMap((voicing, bar) =>
            [0, 1, 2, 1, 0, 1, 2, 1].map((voice, step) => (
              <Note key={`${bar}-${step}`} at={at(bar + 1, step * 0.5)} pitch={formatPitch(voicing[voice]!, true)} dur="8" vel={step === 0 ? 0.62 : 0.48} />
            )),
          )}
        </Clip>
      </Track>
      <Track name="Timpani">
        <Channel volume={-10}>
          <Device plugin="soundfont" name="Timpani" params={{ bank: `${VSCO}/timpani.sf3`, program: 47 }} />
          <Send to="Hall" level={-16} />
        </Channel>
        <Clip at="9" bars={8} name="Roots">
          {BATTLE.flatMap((chord, bar) =>
            (bar === 7 ? [0, 2, 2.5, 3, 3.5] : [0, 2]).map((beat) => (
              <Note key={`${bar}-${beat}`} at={at(bar + 9, beat)} pitch={formatPitch(root(chord, 43), true)} dur={beat % 1 === 0 && bar !== 7 ? 'h' : '8'} vel={beat === 0 ? 0.85 : 0.7} />
            )),
          )}
        </Clip>
      </Track>
      <Track name="Drums">
        <Channel volume={-12}>
          <Device plugin="soundfont" name="Percussion" params={{ bank: `${VSCO}/percussion.sf3`, program: 49, drums: true }} />
          <Send to="Hall" level={-20} />
        </Channel>
        <Clip at="9" bars={8} name="Battle kit">
          {Array.from({ length: 8 }, (_, bar) => [
            ...[0, 1.5, 2].map((beat) => <Note key={`k${bar}-${beat}`} at={at(bar + 9, beat)} pitch={KICK} dur="8" vel={beat === 0 ? 0.9 : 0.75} />),
            ...(bar === 7
              ? [2, 2.5, 3, 3.25, 3.5, 3.75].map((beat) => <Note key={`f${beat}`} at={at(16, beat)} pitch={SNARE} dur="16" vel={0.6 + beat * 0.08} />)
              : [1, 3].map((beat) => <Note key={`s${bar}-${beat}`} at={at(bar + 9, beat)} pitch={SNARE} dur="8" vel={0.8} />)),
            ...(bar === 0 || bar === 4 ? [<Note key={`c${bar}`} at={at(bar + 9)} pitch={CRASH} dur="h" vel={0.75} />] : []),
          ]).flat()}
        </Clip>
      </Track>
      <Track name="Hall">
        <Channel role="effect" volume={-4}>
          <Device plugin="convolution" params={{ ir: 'ir/Musikvereinsaal.wav', predelay: 18 }} />
          <Device plugin="equalizer" params={{ bands: [{ type: 'highPass', freq: 180, q: 0.7 }, { type: 'highShelf', freq: 6000, gain: -3 }] }} />
        </Channel>
      </Track>
      <Track name="Master">
        <Channel role="master">
          <Device plugin="compressor" params={{ threshold: -30, ratio: 1.8, attack: 30, release: 250, knee: 6 }} />
          <Device plugin="limiter" params={{ ceiling: -1 }} />
        </Channel>
      </Track>
    </Project>
  );
}
