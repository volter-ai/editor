// Trigger: a push to `godot` (.githooks/pre-push). The periodic review docs/GODOT.md §The lane's
// law sets: refuse the push when more than LIMIT commits touching the lane's compat, planner,
// lowering or emit have landed since the ledger's latest reviewed commit (a `baseline`, `pass` or
// `holds` row). The ledger is read at the commit being pushed, so recording a review is part of
// the push it unblocks.
//
//   node scripts/check-godot-review.mjs <sha being pushed>
import { execFileSync } from 'node:child_process';

const LIMIT = 30;
const PATHS = [
  'packages/gd-analyze/capabilities/catalog/project-source/src/lib/godot-compat',
  'packages/gd-analyze/src/translate',
];
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

const head = process.argv[2] ?? 'HEAD';
const law = git('show', `${head}:docs/GODOT.md`);
const ledger = law.slice(law.indexOf('**Ledger.**'));
const reviewed = [...ledger.matchAll(/^\| [^|]+ \| `([0-9a-f]{7,40})` \|[^|]*\| (baseline|pass|holds)\b/gm)].map((match) => match[1]);
if (reviewed.length === 0) {
  console.error('godot review: the ledger in docs/GODOT.md has no baseline, pass or holds row.');
  process.exit(1);
}
const last = reviewed.at(-1);
try {
  execFileSync('git', ['merge-base', '--is-ancestor', last, head]);
} catch {
  console.error(`godot review: the ledger's latest reviewed commit ${last} is not an ancestor of ${head}.`);
  process.exit(1);
}
const since = Number(git('rev-list', '--count', `${last}..${head}`, '--', ...PATHS));
if (since > LIMIT) {
  console.error(
    `godot review: ${String(since)} lane commits since the last review (${last}); the limit is ${String(LIMIT)}.\n` +
      'Run the review in docs/GODOT-REVIEW.md and record it in the ledger (docs/GODOT.md) before pushing.',
  );
  process.exit(1);
}
console.log(`godot review: ${String(since)} of ${String(LIMIT)} lane commits since the last review (${last}).`);
