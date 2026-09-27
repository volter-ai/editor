// A minimal preset that follows the rules. Domain: a simple spec issue whose
// acceptance criteria are GFM task-list items, each carrying commit-backed
// evidence as a nested list. The whole thing is ONE strict Zod schema; mdast
// fills it; rules validate it with injected context.
//
// Hard schema = the core fields (id/title/summary/status, id/status/evidence,
// id) PLUS preset-specific strict fields (a status enum, AC `text`, evidence
// `commit`). No passthrough, no unknown.

// A STANDALONE preset: imports ONLY the public mechanism from `ztrack/preset-kit`.
import {
  z, toMdast, nodeText, type MdNode,
  check as runCheck, rule, gitWorld,
  type Context, type IssueColumns, type IssueRecord, type Preset, type VisualizerSpec,
} from 'ztrack/preset-kit';

// ── the hard schema (core + preset-specific, all strict) ────────────────────
export const SpecEvidenceSchema = z.object({
  id: z.string().min(1),                              // core
  commit: z.string().regex(/^[0-9a-f]{7,40}$/),       // preset: evidence is commit-backed
}).strict();

export const SpecAcStatusSchema = z.enum(['pending', 'passed', 'failed']); // preset's status vocabulary
export const SpecAcSchema = z.object({
  id: z.string().min(1),                              // core
  status: SpecAcStatusSchema,                          // core (preset narrows the type)
  evidence: z.array(SpecEvidenceSchema),              // core
  text: z.string().min(1),                            // preset
}).strict();

export const SpecIssueStatusSchema = z.enum(['draft', 'in-review', 'done']);
export const SpecIssueSchema = z.object({
  id: z.string().min(1),                              // core
  title: z.string().min(1),                           // core
  summary: z.string(),                                // core
  status: SpecIssueStatusSchema,                       // core (narrowed)
  acceptanceCriteria: z.array(SpecAcSchema),          // core
}).strict();

export const SpecRootSchema = z.object({ issues: z.array(SpecIssueSchema) }).strict();
export type SpecRoot = z.infer<typeof SpecRootSchema>;

// ── mdast parse: markdown -> the schema shape (structured, no prose mining) ──
// MdNode / toMdast / nodeText are rented from the kit (shared mdast mechanism).
function firstParagraphText(item: MdNode): string {
  const p = (item.children ?? []).find((c) => c.type === 'paragraph');
  return p ? nodeText(p).split('\n')[0]!.trim() : '';
}

// designated-position parses (the AC line, the evidence line) — not free-prose mining.
function splitAcIdText(line: string): { id: string; text: string } {
  const m = /^(\S+)\s+(.+)$/.exec(line);
  return m ? { id: m[1]!, text: m[2]!.trim() } : { id: line, text: line };
}

function parseSpecIssue(record: IssueRecord): Record<string, unknown> {
  // id/title/status come STRUCTURED from the record's columns; only summary + ACs are
  // parsed from the body.
  const issue: Record<string, unknown> = { id: record.id, title: record.title, status: record.status || 'draft', summary: '', acceptanceCriteria: [] };
  const tree = toMdast(record.body);
  let inAc = false;

  for (const node of tree.children ?? []) {
    if (node.type === 'heading') {
      inAc = /acceptance criteria/i.test(nodeText(node));
      continue;
    }
    if (node.type === 'paragraph') {
      const summary = /^Summary:\s*(.+)$/im.exec(nodeText(node))?.[1]?.trim();
      if (summary) issue.summary = summary;
      continue;
    }
    if (node.type === 'list' && inAc) {
      const acs: unknown[] = [];
      for (const item of node.children ?? []) {
        if (item.type !== 'listItem') continue;
        const { id, text } = splitAcIdText(firstParagraphText(item));
        const status = item.checked === true ? 'passed' : 'pending';
        const evidence: unknown[] = [];
        const nested = (item.children ?? []).find((c) => c.type === 'list');
        for (const evItem of nested?.children ?? []) {
          const commit = /commit:\s*([0-9a-fA-F]+)/.exec(firstParagraphText(evItem))?.[1]?.toLowerCase();
          if (commit) evidence.push({ id: `${id}/ev${evidence.length + 1}`, commit });
        }
        acs.push({ id, status, text, evidence });
      }
      issue.acceptanceCriteria = acs;
    }
  }
  return issue;
}

// The root: each issue's metadata is structured (its record's columns); content from body.
export function parseSpec(records: IssueRecord[]): unknown {
  return { issues: records.map(parseSpecIssue) };
}

// ── serialize: the validated issue -> its STORED form (content body + metadata columns) ──
// The evidence id is positional (`<acId>/ev<n>`), so it isn't emitted — re-parsing
// regenerates it. A passed AC is the checked box; pending/failed are unchecked.
export function serializeSpecIssue(issue: SpecRoot['issues'][number]): { body: string; columns: IssueColumns } {
  const out: string[] = [];
  if (issue.summary) out.push(`Summary: ${issue.summary}`, '');
  out.push('## Acceptance Criteria', '');
  for (const ac of issue.acceptanceCriteria) {
    out.push(`- [${ac.status === 'passed' ? 'x' : ' '}] ${ac.id} ${ac.text}`);
    for (const ev of ac.evidence) out.push(`  - commit: ${ev.commit}`);
  }
  return { body: out.join('\n') + '\n', columns: { title: issue.title, status: issue.status } };
}

// ── rules: declarative records over the engine's derived model ──────────────
// Duplicate-id detection is universal, so it arrives on the core model (m.duplicateAcIds
// / m.duplicateIssueIds) — this preset writes no derive and uses no blocking graph.
type SpecAC = SpecRoot['issues'][number]['acceptanceCriteria'][number];
type SpecEvidence = SpecAC['evidence'][number];

const shaMatches = (a: string, b: string) => a.startsWith(b) || b.startsWith(a);

const SPEC_RULES = [
  rule<SpecRoot, { issueId: string; acId: string; ac: SpecAC }>({
    code: 'passed_ac_missing_evidence', select: (m) => m.acs,
    when: ({ ac }) => ac.status === 'passed' && ac.evidence.length === 0,
    message: ({ ac }) => `AC ${ac.id} is passed but cites no commit-backed evidence.`,
  }),
  rule<SpecRoot, { issueId: string; acId: string; evidenceId: string; ev: SpecEvidence }>({
    code: 'evidence_commit_not_found', select: (m) => m.evidence,
    when: ({ ev }, m) => { const c = m.context.git?.existingCommits; return !!c && !c.some((x) => shaMatches(x, ev.commit)); },
    message: ({ ev }) => `Evidence ${ev.id} cites commit ${ev.commit}, which does not exist.`,
    subject: ({ ev }) => ev.commit,  // the missing sha — a `ref:` waiver pins to exactly this occurrence
  }),
  rule<SpecRoot, { issueId: string; acId: string }>({
    code: 'duplicate_ac_id', select: (m) => m.duplicateAcIds,
    message: ({ acId }) => `Duplicate AC id ${acId}.`,
  }),
  rule<SpecRoot, { issueId: string }>({
    code: 'duplicate_issue_id', select: (m) => m.duplicateIssueIds,
    message: ({ issueId }) => `Duplicate issue id ${issueId}.`,
  }),
];

// ── the dashboard's vocabulary (VIZ-2), as plain data ────────────────────────────────────────
// spec's OWN vocabulary — NOT simple-sdlc's default.tsx vocabulary, which this preset's schema
// doesn't share: a 3-state lifecycle (no ready/in-progress split), no assignee, no PR, and an AC
// with just id/text (no version, no proof, no image/acVersion-bearing evidence — see
// SpecAcSchema/SpecEvidenceSchema above). Only map fields this schema actually has; a mapping
// this preset can't back with a real field (pr, acProof, acEvidence) is simply omitted. Field
// references and literal labels ONLY (see `VisualizerSpec`, `ztrack/preset-kit`) — no functions,
// no markup. Installed into your repo verbatim: edit freely, keeping statusOrder in sync with
// SpecIssueStatusSchema above (`boilerplates/presets/visualizerVocabulary.test.ts` checks that).
const SPEC_VISUALIZER: VisualizerSpec = {
  statusOrder: ['draft', 'in-review', 'done'], // must equal SpecIssueStatusSchema above
  acUnitLabel: 'Acceptance Criteria',
  acText: { id: 'id', text: 'text' },          // SpecAcSchema.{id,text} — no `version` field to map
  // no assignee/pr: SpecIssueSchema has neither. No acProof: SpecAcSchema has no proof field.
  // No acEvidence: SpecEvidenceSchema is only {id, commit} — no image/acVersion fields to map.
};

export const SpecPreset: Preset<SpecRoot> = {
  name: 'spec',
  schema: SpecRootSchema,
  visualizer: SPEC_VISUALIZER,
  // observed facts: commit existence (no PR model in this preset).
  loadContext: (input) => gitWorld(input.projectRoot, [], { verifyCommits: input.verifyCommits }),
  parse: parseSpec,
  serialize: serializeSpecIssue, // issue -> { body, columns }; the inverse of parse
  rules: SPEC_RULES,
  // `ztrack issue scaffold` starter: a pending AC (green to begin). Mark it [x] + cite a
  // `- commit: <sha>` once the behavior is implemented.
  scaffold: (_title) => `Summary: A short spec of the behavior.\n\n## Acceptance Criteria\n\n- [ ] AC-1 Describe one observable acceptance criterion.\n`,
};

export function checkSpec(records: IssueRecord[], ctx?: Context) {
  return runCheck(SpecPreset, records, ctx);
}

// The installed entrypoint: the resolver reads the preset off `default`.
export default SpecPreset;
