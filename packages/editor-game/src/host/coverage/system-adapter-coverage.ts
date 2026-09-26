/**
 * THE `SystemAdapters` TWO-STATE RULE FOR A NATIVE MOUNT — the pure half of
 * `@volter/editor-game/coverage/native-system-coverage.ts`.
 *
 * ## The defect this closes
 *
 * `@volter/editor-game/coverage/root-coverage.ts` made coverage provenance-neutral for the
 * `editor.*` family — every mounted root, native or ingested, gets a row per
 * `AuthoringAdapter` provider. It deliberately keeps ONLY that family, on the
 * grounds that the remaining facts are "the ingested lane's own questions".
 * That is true of `contract.*` (a native game declares no `window.vgaiGame`
 * and never will) and false of `system.*`: a `SystemAdapters` slot is read off
 * the editor's OWN live registry (`authoring/active-systems.ts`), which a
 * native game fills exactly as an ingested one does. So the slots went
 * unreported for every first-party game, and the measured case is a
 * first-party Colyseus project whose Network panel is dark in precisely the
 * same way a single-player project's is — with nothing standing anywhere to
 * say which of the two it is.
 *
 * ## Why an absence here can be a positive answer at all
 *
 * A foreign game's silence is ambiguous by construction: an omitted key means
 * "unsupported", which is the same shape as "nobody looked" — which is exactly
 * why the contract needs an explicit `{ present: false, evidence }` record.
 * A native game has no such ambiguity for the ENGINE-OWNED slots, because the
 * engine BUILT the bag (`runtime/game.ts`'s `computeSystemAdapters` merges what
 * each mounted root's `mounted.systems` carries). An unbound engine-owned slot
 * on a live native mount is therefore the engine's own statement that no
 * mounted root built that subsystem — not an unasked question.
 *
 * `networking` is the exception, and it is the whole point. Nothing engine-side
 * builds it: a game registers a `NetworkingAdapter` itself. So its absence is
 * ruled out only by the PROJECT'S OWN FILE — no `server` block in
 * `vgai.project.json` means there is no room to describe. A game that DOES
 * declare a room and binds nothing is `unanswered`, i.e. a standing warning.
 *
 * ## Provenance neutrality
 *
 * Nothing here consults a route, a game id, or a provenance flag. Both
 * measurers answer the same question — "is this slot at a terminal state, and
 * what is the evidence?" — over the facts their own lane actually has, and each
 * carries its own `fix` text so the shared row builder in
 * `coverage/capability-coverage.ts` never has to ask who produced the measurement.
 *
 * Pure over its inputs, so the whole table is unit-testable with no browser and
 * no live session.
 */

import type { DeclaredSystemAbsence } from '@volter/game-runtime/runtime/game';
import type { SystemAdapters } from '@volter/editor-project/adapter/system-adapter';
import {
  SYSTEM_ADAPTER_SLOTS,
  type SystemAdapterMeasurement,
  type SystemAdapterSlot,
} from './capability-coverage';
import { inspectSystemAdapterSeam } from '@volter/editor-sdk/kit/system-seam-evidence';

/** What the native derivation needs to know that the live registry cannot tell
 *  it. Both facts are read off things that already exist; neither is a guess. */
export interface NativeProjectFacts {
  /**
   * `vgai.project.json` declares a `server` block (a Colyseus room) — read from
   * the active project view (`project-manager.ts`'s `ActiveProject.server`).
   * The decisive project-level declaration for whether this game is networked.
   */
  readonly declaresServer: boolean;
  /**
   * A game is actually MOUNTED right now. False means the registry is empty
   * because nothing is running, not because no root built a subsystem — and an
   * empty registry read as a fistful of positive absences would be the exact
   * wrong answer, so nothing is terminal in that case.
   */
  readonly mounted: boolean;
  /**
   * What the mounted roots' own `systems` tables said with `absent(reason)` —
   * `Game.declaredSystemAbsences`, harvested through
   * `binding.observation.entrySystems` at mount.
   *
   * This is the DETECT-OR-DECLARE half, and it outranks every generic excuse
   * below: the table's evidence is the GAME's own words about its own source,
   * where {@link ENGINE_OWNED_EVIDENCE} can only say what the engine would have
   * had to build. A game that declares nothing loses nothing — it falls through
   * to exactly the derivation it had before.
   */
  readonly declaredAbsences: readonly DeclaredSystemAbsence[];
  /**
   * The absences above were RETAINED from this session's last play mount
   * rather than read off a live Game. The declaration is a static fact about
   * the entry's `systems` table, so it remains the game's own answer while
   * stopped — but the row says which reading it is, because "as of the last
   * mount" and "live right now" are different claims.
   */
  readonly absencesFromLastMount?: boolean;
  /**
   * The project's own dependency names — the DETECT half of detect-or-declare.
   *
   * `null` means the question was not answered (an unlanded fetch, an
   * unreadable package.json) and MUST NOT be read as "no libraries":
   * an unasked question that reassures is exactly the failure this family
   * exists to prevent, so a `null` detector simply stands down and every row
   * reports what it would have without it.
   */
  readonly dependencies: readonly string[] | null;
}

/**
 * Libraries whose presence CONTRADICTS an empty slot — a project shipping one
 * of these is carrying the subsystem, whoever failed to bind it.
 *
 * Deliberately narrow, because a false positive here turns a correct terminal
 * row into a permanent false work order. `@colyseus/schema` is the worked
 * exclusion: it is shared state TYPES, which a single-player game legitimately
 * depends on to compile against a room definition it never joins — only the
 * CLIENT (`colyseus.js`) is evidence that this game talks to a server.
 * `renderDebug`, `camera` and `debug` have no library tell at all (the host
 * derives them from its own wiring), so they are absent from this table and
 * nothing about them is ever inferred from a dependency list.
 */
const SLOT_LIBRARIES: Partial<Record<SystemAdapterSlot, readonly string[]>> = {
  physics: ['@react-three/rapier', '@dimforge/rapier3d-compat', '@dimforge/rapier2d-compat'],
  networking: ['colyseus.js'],
  navigation: ['recast-navigation', '@recast-navigation/core'],
  audio: ['tone', 'howler'],
};

/** The libraries this project ships for `slot`, or `[]`. */
function shippedLibraries(slot: SystemAdapterSlot, facts: NativeProjectFacts): readonly string[] {
  if (facts.dependencies === null) return [];
  const tells = SLOT_LIBRARIES[slot];
  if (!tells) return [];
  return tells.filter((tell) => facts.dependencies?.includes(tell));
}

/**
 * The fix for a slot whose library ships but whose adapter is unbound — and it
 * names BOTH spellings of a terminal answer, because either is legitimate and
 * the author is the only one who knows which is true.
 */
function contradictionFix(slot: SystemAdapterSlot, libraries: readonly string[]): string {
  return (
    `this project depends on ${libraries.join(' + ')}, so "nothing built a ${slot} world" is not ` +
    `a settled answer. Reach a terminal state either way: BIND it — declare the game's own ${slot} ` +
    `adapter in the root entry's \`systems\` table — or DECLARE the absence with ` +
    `\`absent(reason)\` in that same table. The reason must NAME the dependency and say why it ` +
    `is there while the subsystem is not (a transitive pull, a leftover, a build-only use); a ` +
    `declared absence blind to the shipped dependency grades malformed, not terminal.`
  );
}

/**
 * Whether a declared-absence reason ENGAGES with a contradicting shipped
 * library — mechanically: it names the package, or a DISTINCTIVE word of the
 * package's own name (`@react-three/rapier` is acknowledged by a reason that
 * says "rapier"). A reason that names the evidence is the game answering the
 * contradiction; one that does not never saw it.
 *
 * The candidates are word-boundary matches on the package TAIL's tokens with
 * ecosystem/generic words dropped — measured adversarially before this
 * shape: bare-substring segment matching let "pure three.js visual scene"
 * acknowledge `@react-three/rapier` (via `three`), "backwards compat"
 * acknowledge `rapier3d-compat` (via `compat`), and "milestone" contain
 * `tone`. When the tail is ENTIRELY generic (`@recast-navigation/core`),
 * the scope's own words become the candidates instead — the package still
 * has a name, and the reason must say it.
 */
function reasonAcknowledges(reason: string, library: string): boolean {
  // The full name counts — but a PLAIN name needs word boundaries, or
  // "milestone" would contain `tone`. A scoped/punctuated name is already
  // too distinctive to appear by accident.
  const escaped = library.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (/^[a-z0-9]+$/i.test(library)) {
    if (new RegExp(`\\b${escaped}\\b`, 'i').test(reason)) return true;
  } else if (reason.toLowerCase().includes(library.toLowerCase())) {
    return true;
  }
  const GENERIC = new Set([
    'compat',
    'core',
    'client',
    'server',
    'node',
    'react',
    'three',
    'libs',
    'api',
    'sdk',
    'util',
    'utils',
    'plugin',
    'plugins',
    'tools',
    'types',
    'browser',
  ]);
  const tokensOf = (part: string): string[] =>
    part
      .toLowerCase()
      .split(/[.\-_/]+/)
      .filter((token) => token.length >= 4 && !GENERIC.has(token));
  const [scopePart, tailPart] = library.toLowerCase().startsWith('@')
    ? [library.slice(1, library.indexOf('/')), library.slice(library.indexOf('/') + 1)]
    : ['', library];
  let candidates = tokensOf(tailPart);
  if (candidates.length === 0) candidates = tokensOf(scopePart);
  // A digit-suffixed token also answers to its stem: `rapier3d` ⇒ `rapier`.
  const stems = candidates
    .map((token) => token.replace(/\d+d?$/, ''))
    .filter((stem) => stem.length >= 4);
  return [...new Set([...candidates, ...stems])].some((token) =>
    new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(reason),
  );
}

/** The file fact that rules `networking` out, in the file's own terms. */
const NO_SERVER_EVIDENCE =
  "this project's vgai.project.json declares no `server` block, so there is no room for a " +
  'NetworkingAdapter to describe';

/**
 * Why an unbound ENGINE-OWNED slot is terminal on a live native mount: what the
 * engine would have had to build for the slot to be filled, so a reader can
 * check the claim against the root's own source rather than take it on faith.
 *
 * Keyed by slot rather than listed, so a slot with no entry falls through to
 * `unanswered` (a work order) instead of silently acquiring an excuse. `debug`
 * is deliberately absent: the game-scoped registry binds it unconditionally
 * (`runtime/game.ts`'s `computeSystemAdapters` seeds it before walking the
 * roots), so an unbound `debug` on a live mount means something is genuinely
 * wrong and must stay loud.
 */
const ENGINE_OWNED_EVIDENCE: Partial<Record<SystemAdapterSlot, string>> = {
  physics:
    'no mounted root built a physics world — the engine seeds this slot from the root that ' +
    'creates one (a `setup` root, or an R3F tree using the Rapier bridge), so nothing in this ' +
    'game simulates bodies',
  navigation:
    "no mounted root registered a navigation adapter — the engine seeds this slot from a world's " +
    'own NavMeshManager registration, so this game has no navmesh',
  audio:
    'no mounted root built an audio context — the engine seeds this slot from the root that ' +
    'creates one, so there is no audio graph for the host to mute, meter or graph',
  camera:
    'no mounted root registered a camera-ownership system — the engine ships ' +
    '`createCameraOwnershipSystem` for a game that takes camera control (a cutscene rig), so ' +
    "this game's camera is gameplay-owned throughout",
  renderDebug:
    'no mounted root captured a real WebGL2 render context to derive one from — the engine seeds ' +
    'this slot only where the root owns the capture wiring ' +
    '(`adapter/setup-three-root-adapter.ts`), so the Frame debugger and the render-memory view ' +
    'have nothing to show for this game',
};

/** The fix a native game's author can actually act on, per slot. Never the
 *  ingested lane's `window.vgaiGame` text, which would be false here. */
function nativeSlotFix(slot: SystemAdapterSlot, facts: NativeProjectFacts): string {
  if (!facts.mounted) {
    return 'nothing is mounted, so the live system registry has not been asked yet — enter Play, or open a project whose roots mount, and the slot reports its real state';
  }
  if (slot === 'networking') {
    return (
      "register a NetworkingAdapter from the game's own code " +
      "(`ctx.registerSystemAdapter('networking', …)`) — this project declares a `server` block, " +
      "so the editor's Network panel is dark for a game that IS networked"
    );
  }
  return `register a ${slot} adapter from the game's own code (\`ctx.registerSystemAdapter('${slot}', …)\`), or build the subsystem the engine seeds it from`;
}

/**
 * The terminal state of every `SystemAdapters` slot for a live NATIVE mount.
 *
 * `bound` is read off the editor's own live registry — the very object its
 * panels call, so a slot that "registered" but never reached the registry
 * reports honestly. Everything else is decided by the facts above, and a bound
 * adapter always wins because the registry is the stronger measurement.
 */
export function measureNativeSystemAdapters(
  active: SystemAdapters,
  facts: NativeProjectFacts,
): readonly SystemAdapterMeasurement[] {
  const declared = new Map(facts.declaredAbsences.map((a) => [a.slot, a]));
  return SYSTEM_ADAPTER_SLOTS.map((slot): SystemAdapterMeasurement => {
    const absence = declared.get(slot);
    if (active[slot] != null) {
      // A DECLARED absence contradicted by a live adapter. Both statements are
      // about the same slot and they cannot both be true, so neither terminal
      // state may be printed as if it were settled: `malformed` is the existing
      // loud state for a declaration that could not be honoured, and it is the
      // honest verdict here. Which one is wrong is the author's to find — the
      // row names both halves so they can.
      if (absence) {
        return {
          slot,
          state: 'malformed',
          evidence:
            `root "${absence.rootId}" declares this slot absent — "${absence.reason}" — but a ` +
            `${slot} adapter is bound on the live mount. One of the two is wrong: either the ` +
            'declaration is stale (delete the `absent()` marker) or something registers an ' +
            'adapter the game does not mean to have.',
        };
      }
      return {
        slot,
        state: 'bound',
        proof: inspectSystemAdapterSeam({
          slot,
          adapter: active[slot] as NonNullable<SystemAdapters[typeof slot]>,
          subject: 'game',
        }),
      };
    }
    if (!facts.mounted) return { slot, state: 'unanswered', fix: nativeSlotFix(slot, facts) };
    // The game's own answer outranks every derived excuse below — it is a
    // statement about this game's source, where the fallbacks can only describe
    // what the engine would have had to build.
    const libraries = shippedLibraries(slot, facts);
    if (absence) {
      // DECLARED absent while the project ships the library. The declaration
      // may still be right (a transitive pull, a leftover, a build-only use) —
      // but only if it ENGAGES with the evidence: a reason that names the
      // dependency is the game saying why it is there without the subsystem,
      // and is honored as the game's answer. A reason blind to a shipped
      // library is loud, naming both halves, exactly like the bound-adapter
      // contradiction above — a terminal row there would stop anyone ever
      // checking.
      const unacknowledged = libraries.filter((lib) => !reasonAcknowledges(absence.reason, lib));
      if (unacknowledged.length > 0) {
        return {
          slot,
          state: 'malformed',
          evidence:
            `root "${absence.rootId}" declares this slot absent — "${absence.reason}" — but this ` +
            `project depends on ${unacknowledged.join(' + ')} and the reason does not mention ` +
            'it. Either the absence is stale, or it holds and the reason should say why that ' +
            'dependency is present without the subsystem (naming it).',
        };
      }
      const lastMountNote = facts.absencesFromLastMount
        ? ' — the declaration read at this session’s last play mount; play to re-read it live'
        : '';
      return {
        slot,
        state: 'empty',
        attestedBy: 'game',
        evidence:
          libraries.length > 0
            ? `declared absent by root "${absence.rootId}": ${absence.reason} ` +
              `(the project does depend on ${libraries.join(' + ')}; the reason engages with that)${lastMountNote}`
            : `declared absent by root "${absence.rootId}": ${absence.reason}${lastMountNote}`,
      };
    }
    // Nothing declared, and the library IS here: the host's inference below
    // would print a confident absence over real evidence to the contrary. That
    // is an UNANSWERED question — the only state that is a work order — not a
    // terminal one.
    if (libraries.length > 0) {
      return { slot, state: 'unanswered', fix: contradictionFix(slot, libraries) };
    }
    // Everything below is the HOST reasoning from an unfilled slot, not the
    // game speaking. Tagging it says so in the row, and names the mechanism
    // that would let the game answer for itself.
    if (slot === 'networking') {
      return facts.declaresServer
        ? { slot, state: 'unanswered', fix: nativeSlotFix(slot, facts) }
        : { slot, state: 'empty', attestedBy: 'host', evidence: NO_SERVER_EVIDENCE };
    }
    const evidence = ENGINE_OWNED_EVIDENCE[slot];
    return evidence
      ? { slot, state: 'empty', attestedBy: 'host', evidence }
      : { slot, state: 'unanswered', fix: nativeSlotFix(slot, facts) };
  });
}
