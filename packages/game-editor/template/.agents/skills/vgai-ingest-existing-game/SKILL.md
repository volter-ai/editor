---
name: vgai-ingest-existing-game
description: >
  Take an existing, unmodified web game (three.js, PixiJS, or React) to FULL
  vgai editor integration: mount it through the adapter seam, declare its
  real capabilities through the game contract, drive every adapter slot to a
  terminal state (implemented, or verified implemented-empty), and prove it
  live through the product's own doors. Use when asked to ingest, adapt,
  integrate, or "make the editor work with" a game that already exists —
  vendored reference games in this repo, or a user's own game folder. Do not
  use for building a NEW game (scaffold instead) or for non-web runtimes
  (Godot/Roblox translate through the import lanes, not ingestion).
---

# Ingest an existing game — to closure, not to mount

**The manual is `docs/BRINGING-AN-EXISTING-GAME.md` — read the section
titled "The ingestion checklist — what done means" FIRST** (search for that
heading; the file is long) and keep it open — this skill is the operational
spine over that checklist, not a replacement. The doctrine that binds you is
in `docs/ARCHITECTURE-CORE.md` §the adapter seam: every capability slot ends
**implemented** or **implemented-empty** (a positively-answered, evidence-
backed absence). "Honest gap" is not an outcome; coverage warnings are work
orders. Mounting the game is STEP ONE of seven, not the deliverable.

## The worked references — read before writing anything

- `public/ingest/simcity/` and `public/ingest/server-survival/` — closure
  with ZERO patches: everything bound off the game's published `window`
  objects; the navigation slots show the host-computation form (host BFS
  over the game's own public graph, labeled as the host's in so many
  words).
- The contract shapes: `packages/project/src/adapter/ingest/game-contract.ts`
  (root · lifecycle · systems.commands/state/hierarchy · systemAdapters) and
  `contract-system-adapters.ts` (the projection that rejects malformed
  claims — a `present` missing required members, or an `empty` without
  evidence, is loudly refused).

## Two record-honesty rules, both bought with a measured failure

- **Re-derive every host-gap claim in the target's existing record against
  current host source before believing it.** A vendored game's UPSTREAM.md
  is a snapshot: server-survival's said capture was impossible on its three
  version, while the host's structural recognition had long since fixed
  exactly that — and named the game in its docblock. Ask the positive
  question ("how does the host do this today?") against the code; a stale
  note read as truth ends the task early and wrongly.
- **A reference's literal values are not conventions.** `captureTimeoutMs`
  means "when to REPORT the degrade" (the subscription stays live) and is
  clamped by the adapter — copying a reference's number copies a dead
  number. When a field's meaning matters, read its owner's module header.

## The workflow

1. **Mount (checklist A–B).** Manifest with an `{ ingest }` root beside the
   game; open through the session (`vgai edit <folder>` — a local editor
   rejects URL params); pin CDN importmaps if any (pattern 4, a recorded
   patch for vendored copies, an ordinary edit in a user's own folder).
2. **Read the game's real surface before declaring anything.** Its exports,
   its `window` publications, its module structure. Candidate bindings come
   from what the game actually owns — the anti-shim rule: never fabricate a
   datum the game has no referent for. Host-computed queries over the
   game's own data are legitimate and labeled as the host's (simcity's
   navigation); invented facts are not (a fake `disconnected` status).
3. **Contract (checklist C).** Shim (`ingest.contractShim`) for a copy that
   must stay pristine; recorded patches or direct edits for an owned one.
   Declare only what you traced; guards replicate the game's own
   preconditions. Verbs that crash the game when invoked externally are
   worse than no verbs. State providers are SYNCHRONOUS (the bridge puts
   `debug.state(key)` straight into its reply; a Promise serializes as
   `{}`).
4. **The refusal worklist (checklist D).** Everything unreachable is
   recorded per-symbol with evidence — then CLOSED: a minimal accessor
   patch (pattern 2) where the game has the value, or implemented-empty
   where it genuinely doesn't. A wrong empty claim is a defect; so is a
   refusal left sitting.
5. **The FOUR declarable SystemAdapters slots (checklist F).** physics ·
   networking · navigation · audio — each bound through
   `systems.systemAdapters` or declared `{ present: false, evidence }`,
   where the evidence is a grep/read another agent can re-run. The other
   two slots are NOT yours to declare: `debug` is projected from your
   `commands`/`state` (a second door would allow two conflicting debug
   planes), and `renderDebug` is engine-owned, auto-registered from the
   captured renderer — declaring either is a malformed claim the
   projection rejects. Beware the two traps measured on the references: a
   game with a REAL subsystem you almost claimed empty (a
   pathfinder buried in an AI module), and a subsystem-shaped thing that isn't one (simcity's
   random-walk cars are not pathfinding — but its public road graph still
   made the slot bindable).
6. **Verify live (checklist G).** Through the product's doors only:
   `vgai eval 'game.commands()'`, drive a verb, read state, ⏸/▶ (pause
   must freeze what the game's own pause freezes; input must gate), the
   coverage rows on `vgai status`. Never synthetic key events, never raw
   window reads — the eval seam exists so that is never necessary. (In a
   sandboxed worktree where the CLI's eval form is blocked, the same door
   is `@vgai/live`'s `connect()` from a script INSIDE the worktree, run
   with `npx tsx` — see docs/LOCAL-DEV.md.)
7. **The ledger.** For vendored copies: lock updated (host-added hashes,
   patches with reverse-apply), `node vendor/games/verify-unaltered.mjs`
   green, UPSTREAM.md carrying every binding and every empty claim with
   its evidence. For a user's folder: the diffs are theirs, visible in
   their own git.

## What done means

Every checklist row terminal; the coverage report on a live mount shows no
open work orders except rows the HOST
currently owes (a row whose honest answer is blocked by a missing or
defective host seam is a host work order — name it precisely in your
report, with the read that proves it, and do NOT shim around it per-game;
a decoy that makes a host instrument read green is fabrication). The total
cost is written down (manifest + shim + N patched lines).
