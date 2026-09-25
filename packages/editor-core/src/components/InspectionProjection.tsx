/**
 * The PROJECTIONS of the inspection model — Layer 3, and the only place a
 * composed {@link InspectionSubject} becomes pixels.
 *
 * ONE box, two layouts (`inspection/model.ts`):
 *  - `column` — the DEFAULT: the subject's full inspector as a slim vertical
 *    column. Identity row (name, visibility eye, a LABELED open-for-edit
 *    button), then a persistent SECTION-ICON STRIP (one glyph per
 *    `subject.sections`, 1:1) that signposts what the subject HAS and jumps
 *    to a section, then every section stacked and collapsible;
 *  - `card` — the space-tight fallback: a MINI card (preview, name, the same
 *    icon strip, the open-for-edit) that the viewport host
 *    (`components/CompactInspectorCard.tsx`) can collapse at the floor to a
 *    single-line PILL. Clicking any collapsed form restores the column.
 *
 * "The box should actually be an identical thing regardless of what viewport
 * it's on. The only thing that differs is the sections. The sections only
 * differ because the inspector's structured data is different." (owner.) So
 * everything above the sections — the identity row, the name, the kind, the
 * verbs on it, the icon strip — reads the SAME model fields in both layouts;
 * the only differences below are the layout's own arrangement.
 *
 * Two actions stay unambiguous because only ONE is an unlabeled gesture:
 * clicking the box (any collapsed form, the mini card's preview, a strip
 * glyph) EXPANDS/RESTORES the column — an in-place zoom on the SAME subject —
 * while OPEN-FOR-EDIT is ALWAYS a labeled control that navigates to the
 * subject's DEFINITION (a DIFFERENT subject). The definition link is the
 * subject's own `related` link (`inspection/model.ts` {@link SubjectLink},
 * produced by each adapter's `related` provider), surfaced here as the labeled
 * Edit button only when the subject carries one.
 *
 * The projections are DUMB: they read identity, verbs, related links, and each
 * section's id/title/icon/order/body off the model, and they never learn what
 * a section contains, which contribution replaced which built-in, or which
 * surface produced the subject. `surface` appears here for exactly one reason
 * — it is the key the presentation preference is stored under — and a host
 * that names none simply offers no switch.
 */

import {
  faArrowUpRightFromSquare,
  faCube,
  faScrewdriverWrench,
  faWindowMinimize,
  faXmark,
} from '@fortawesome/free-solid-svg-icons';
import type { IconDefinition } from '@fortawesome/free-solid-svg-icons';
import {
  activeIconGlyph,
  activeIconSetSnapshot,
  Button,
  DraftTextInput,
  EditorIcon,
  IconButton,
  Panel,
  SectionHeader,
  spaceVar,
  subscribeIconSets,
  themeVars,
} from '@volter/editor-sdk/widgets';
import {
  Fragment,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type UIEvent as ReactUIEvent,
  useCallback,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { hierarchyKindIcon } from '../hierarchy-kind-icon';
import { setActiveScope } from '@volter/editor-sdk/kit/hotkeys';
import {
  actionsPlacedAt,
  type InspectionAction,
  type InspectionPresentation,
  type InspectionPreviewMode,
  type InspectionSection,
  type InspectionSubject,
  type InspectionSurfaceKind,
  type SubjectLink,
} from '@volter/editor-sdk/kit/inspection-model';
import { compactInspectorTabs, setInspectorPresentationOverride } from '../inspector-presentation';
import { useCompactInspectorHost } from './CompactInspectorShell';
import { InspectorFieldsSection } from './InspectorFieldsSection';
import { useAfterPaint } from '@volter/editor-sdk/kit/components/use-after-paint';

/** The body of one composed section, rendered by whichever layout asked for
 *  it: a `fields` body is the generic descriptor grid, a `custom` body is an
 *  opaque block that renders itself, a `preview` body is the subject's live
 *  square view. No projection looks past this. */
function sectionBody(section: InspectionSection): ReactNode {
  return section.body.kind === 'fields' ? (
    <InspectorFieldsSection fields={section.body.fields} io={section.body.io} />
  ) : (
    section.body.render()
  );
}

/** A subject verb as an icon button (the `identity` placement — today the
 *  visibility eye, beside the name field). */
function QuickActionIconButton({ action }: { readonly action: InspectionAction }) {
  return (
    <IconButton
      data-testid={action.id}
      aria-label={action.title}
      title={action.title}
      aria-pressed={action.pressed}
      disabled={action.disabled}
      onClick={action.run}
    >
      {action.icon && <EditorIcon icon={action.icon} />}
    </IconButton>
  );
}

/**
 * The subject's DEFINITION link — the one whose `id` carries the `definition:`
 * marker its producing adapter stamped (mirroring the `creation-site:`
 * convention), never a POSITIONAL guess. `SubjectLink` has no definition field,
 * so identifying "the definition" by list order would silently promote whatever
 * link an adapter happened to list first (a state machine, say). The marker is
 * the contract; the first link that carries it is the open-for-edit target,
 * and its absence is an honest "no definition to open" — no `[0]` fallback.
 */
function definitionLink(subject: InspectionSubject): SubjectLink | null {
  return subject.related.find((link) => link.id.startsWith('definition:')) ?? null;
}

/** The related links that are NEITHER construction-site provenance (which rides
 *  in `identity.note`) NOR the promoted `definition:` link — the rest of the
 *  derivation chain (an asset document's state machine and the like). Filtered
 *  by kind, so a demoted definition can never reappear here and a non-definition
 *  link is never hidden by position. */
function otherRelatedLinks(subject: InspectionSubject): readonly SubjectLink[] {
  return subject.related.filter(
    (link) => !link.id.startsWith('creation-site:') && !link.id.startsWith('definition:'),
  );
}

/**
 * The LABELED open-for-edit control (icon + text) — the ONE unlabeled-gesture
 * exception's counterweight: it navigates to the subject's DEFINITION (a
 * DIFFERENT subject whose edits change every instance), so it must never be
 * the primary click. Its text is the link's own title ("Open Crate"), which is
 * the honest name of the real `SubjectLink.open` verb it runs.
 */
function EditDefinitionButton({ link }: { readonly link: SubjectLink }) {
  return (
    <Button
      variant="secondary"
      size="compact"
      data-testid="inspector-open-definition"
      title={link.title}
      onClick={link.open}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, flexShrink: 0 }}
    >
      <EditorIcon icon={faArrowUpRightFromSquare} />
      <span
        style={{
          maxWidth: 120,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {link.title}
      </span>
    </Button>
  );
}

/** The DERIVATION chain beyond the definition — an asset document's state
 *  machine and the like. The definition itself is promoted to the identity
 *  row's Edit button, so this row renders only what is left. */
function RelatedSubjects({ subject }: { readonly subject: InspectionSubject }) {
  const rest = otherRelatedLinks(subject);
  if (rest.length === 0) return null;
  return (
    <div
      data-testid="inspector-related-subjects"
      style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '6px 8px' }}
    >
      {rest.map((link) => (
        <Button key={link.id} variant="ghost" onClick={link.open} title={link.title}>
          {link.title}
        </Button>
      ))}
    </div>
  );
}

/** What a section icon DRAWS under the active icon set: the set's own glyph
 *  for its name, or the definition's path when the set carries none. */
function drawnGlyph(icon: IconDefinition): string {
  const glyph = activeIconGlyph(icon.iconName);
  if (glyph) return `${glyph.path}|${glyph.tonedPath ?? ''}`;
  const path = icon.icon[4];
  return Array.isArray(path) ? path.join('|') : path;
}

/**
 * The SECTION-ICON STRIP — one glyph per `subject.sections`, 1:1
 * (`compactInspectorTabs`). It signposts what the subject HAS and jumps to a
 * section; it is NOT a tab that opens one section into a floating panel. In the
 * column `onJump` scrolls the section into view; on the mini card there are no
 * stacked sections, so `onJump` restores the column.
 */
function SectionIconStrip({
  subject,
  onJump,
}: {
  readonly subject: InspectionSubject;
  readonly onJump: (sectionId: string) => void;
}) {
  const tabs = compactInspectorTabs(subject);
  useSyncExternalStore(subscribeIconSets, activeIconSetSnapshot, activeIconSetSnapshot);
  // The strip is a JUMP AID — a table of contents. It earns its row only
  // when there is real navigation to do (a dense entity subject: preview,
  // transform, property groups, stories…) AND its glyphs can be told
  // apart. Three sections need no navigator, and identical icons signpost
  // nothing — the 1:1 derivation stands (owner, 2026-08-07); an
  // uninformative row earns no pixels (owner-sighted, 2026-08-23). The glyphs
  // are told apart by what is DRAWN, not by name: a name the active icon set
  // does not carry draws its definition's own path, and Blender's section
  // names all fall back to the one wrench outside the Blender set — thirteen
  // names, one drawing (owner-sighted on the compact card, 2026-09-25).
  if (tabs.length < 5 || new Set(tabs.map((tab) => drawnGlyph(tab.icon))).size < 3) return null;
  return (
    <div
      className="vgai-inspector-icon-strip"
      role="toolbar"
      aria-label="Sections"
      data-testid="inspector-section-strip"
    >
      {tabs.map((tab) => (
        <IconButton
          key={tab.id}
          size="compact"
          data-testid={`section-icon-${tab.id}`}
          aria-label={tab.title}
          title={tab.title}
          onClick={() => onJump(tab.id)}
        >
          <EditorIcon icon={tab.icon} />
        </IconButton>
      ))}
    </div>
  );
}

/** The subject's live preview at `thumbnail` fill, or a quiet kind glyph when
 *  the subject has none (react/DOM/no-Object3D subjects). The picture follows a
 *  frame after selection (`components/use-after-paint.ts`), so the glyph holds
 *  the geometry until it lands and nothing reflows. Inert: the host owns the
 *  single click. */
function SubjectThumbnail({
  render,
  glyph,
  subjectKey,
}: {
  readonly render: ((mode?: InspectionPreviewMode) => ReactNode) | null;
  readonly glyph: InspectionSection['icon'];
  readonly subjectKey: string;
}) {
  const picture = useAfterPaint(subjectKey) ? render : null;
  return picture ? (
    <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {picture('thumbnail')}
    </div>
  ) : (
    <EditorIcon icon={glyph} />
  );
}

/** The editable-or-readonly name field, styled the same either way (a readonly
 *  `<input>` invites typing that vanishes, so it stands in as plain text).
 *
 *  ITS INK IS THE FIELD'S, NOT A READ-ONLY TONE. The stand-in took
 *  `content.dim` (150) where every string Blender draws in its Properties
 *  editor inks #e5e5e5 — measured on `properties-object.png`'s datablock row
 *  (y 142..178, full width: ceiling 229 with 245 px, nothing above it), the
 *  row this one is the counterpart to. A WRONG MEMBER, not a wrong value:
 *  read-only is said by the absent caret and the absent hover, not by a
 *  quieter ink, and the field already restates every other part of the real
 *  control's paint (`compact-inspector.css`'s
 *  `[data-testid="ingest-name"][data-readonly="true"]`). */
function SubjectNameField({ subject }: { readonly subject: InspectionSubject }) {
  const identity = subject.identity;
  if (!identity) return null;
  const summary = [identity.kindLabel, identity.note?.text].filter(Boolean).join(' — ');
  if (identity.rename.readOnly) {
    return (
      <div
        data-testid="ingest-name"
        data-readonly="true"
        {...(summary ? { title: summary } : {})}
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 'var(--vgai-font-md)',
          fontWeight: 600,
          color: themeVars.content.primary,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {subject.title}
      </div>
    );
  }
  return (
    <DraftTextInput
      data-testid="ingest-name"
      aria-label="Name"
      value={subject.title}
      onCommit={(next) => {
        if (next.trim() !== '') identity.rename.set(next);
      }}
      data-emphasis="strong"
      {...(summary ? { title: summary } : {})}
      style={{ flex: 1, minWidth: 0 }}
    />
  );
}

/**
 * The subject's identity ROW — name, the identity verbs (the eye), and the
 * labeled open-for-edit button when the subject carries a definition — over a
 * dim kind/provenance line. One component, read by both layouts; a subject
 * with no identity row shows its headline and quiet hint instead.
 */
function SubjectIdentity({ subject }: { readonly subject: InspectionSubject }) {
  const identity = subject.identity;
  if (!identity) {
    return (
      <div style={{ padding: 12 }}>
        <div style={{ fontSize: 'var(--vgai-font-md)', fontWeight: 600 }}>{subject.title}</div>
        {subject.hint && (
          <div
            data-testid="inspector-subject-hint"
            style={{
              marginTop: 4,
              fontSize: 'var(--vgai-font-base)',
              color: themeVars.content.dim,
            }}
          >
            {subject.hint}
          </div>
        )}
      </div>
    );
  }
  const definition = definitionLink(subject);
  return (
    <div
      className="vgai-inspector-identity"
      // Blender's datablock row — the counterpart to this one — is 21px: its
      // 18px name field plus a hair. An 8px inset all round made ours 37, the
      // tallest thing in the column and the loudest place it stopped reading
      // as Properties. The inset is now the 2px step vertically (the optional
      // second lines below still need a floor) and stays 8px across.
      style={{
        padding: `${spaceVar[1]} ${spaceVar[4]}`,
        borderBottom: '1px solid var(--vgai-structural-divider)',
      }}
    >
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <SubjectNameField subject={subject} />
        {/* The kind rides the name row — two lines said one thing
            (owner-sighted, 2026-08-23). */}
        {identity.kindLabel && (
          <span
            data-testid="inspector-kind-label"
            style={{
              fontSize: 'var(--vgai-font-base)',
              color: themeVars.content.dim,
              whiteSpace: 'nowrap',
            }}
          >
            {identity.kindLabel}
          </span>
        )}
        {actionsPlacedAt(subject, 'identity').map((action) => (
          <QuickActionIconButton key={action.id} action={action} />
        ))}
        {definition && <EditDefinitionButton link={definition} />}
      </div>
      {/* WHERE this is written. The Hierarchy panel used to head itself with
          this path; Blender's Outliner header is one row and names no file,
          and the datablock row — this one — is where the file belongs. The
          seam word rides `kindLabel` one line above, so this is the path
          alone. */}
      {identity.document && (
        <div
          data-testid="inspector-document-path"
          data-document-path={identity.document.path}
          {...(identity.document.title ? { title: identity.document.title } : {})}
          style={{
            marginTop: spaceVar[1],
            fontSize: 'var(--vgai-font-base)',
            color: themeVars.content.muted,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            direction: 'rtl',
            textAlign: 'left',
          }}
        >
          {/* `direction: rtl` ellipsizes at the HEAD, so a long path keeps its
              filename — the half a person reads. The bidi isolate keeps the
              slashes in their authored order inside it. */}
          <bdi>{identity.document.path}</bdi>
        </div>
      )}
      {/* WHAT ELSE THE GIZMO IS HOLDING. The fields below belong to the one
          node named above; a drag moves the whole selection. Saying so is the
          difference between a panel that is scoped and a panel that is wrong
          (`InspectionSubject.alsoSelected`). */}
      {subject.alsoSelected ? (
        <div
          data-testid="inspector-also-selected"
          style={{ marginTop: 6, fontSize: 'var(--vgai-font-base)', color: themeVars.content.dim }}
        >
          {`${subject.alsoSelected + 1} selected — fields edit this one, the gizmo moves all`}
        </div>
      ) : null}
      {identity.note?.text && (
        <div
          data-testid="inspector-subject-note"
          style={{ marginTop: 6, fontSize: 'var(--vgai-font-base)', color: themeVars.content.dim }}
        >
          {identity.note.text}
        </div>
      )}
    </div>
  );
}

/**
 * The PROPERTIES presentation's identity — Blender's Properties editor opens
 * with TWO rows, transcribed from the reference frames at 2x rather than
 * described from memory, and neither is a title bar:
 *
 *  - the BREADCRUMB row: a 14 px datablock glyph, the chain it belongs to, and
 *    ONE trailing control. `properties-data-edit.png`: the glyph's bounding box
 *    is x 80..107 / y 74..101 (28 device px = 14 CSS) and the trailing pin's is
 *    x 559..586 at the same size, on the panel's own fill with no well.
 *    WHAT THE CHAIN OWNS IS THE CONTEXT CHAIN, NOT A FILE (measured
 *    2026-09-18 on all three tab frames): each link is `glyph + NAME`, the
 *    datablock's own name in PLAIN ink, innermost last, `>` between —
 *    `[▣] Cube` on the Object and Modifier tabs, `[▣] Cube > [▽] Cube` on
 *    Data. Blender has no file anywhere on this row. Ours carried
 *    `identity.document.path` here, which is the one fact the reference
 *    never shows; the path is now the row's TOOLTIP (and still the
 *    `data-document-path` attribute an agent reads), because the Model
 *    document's source path has NO other home in our chrome — the editor tab
 *    renders the bare title with no `title` attribute, and the window title
 *    is the PROJECT's. A reachable fact is not deleted to match a
 *    picture; it is moved off the row the picture owns.
 *    INK, measured on every frame: the glyph, the name and the `>` are all
 *    229/229/229 — PLAIN UI ink, never the tab's category colour. Only the
 *    RAIL is coloured (`#73a1ff` modifiers, `#00d3a2` data). The pin alone
 *    is dimmer, 155. Ours inked the breadcrumb glyph `dim` (150) and let the
 *    datablock well's glyph fall through to its category (`#73a1ff`), which
 *    is the loudest thing on the row and is nowhere in the reference.
 *  - the DATABLOCK row: one 20 CSS px composite spanning the panel's inset
 *    width — an icon WELL in `widget.menu` (x 76..135 = 30 CSS wide, #272727),
 *    a 1 px divider, the name TEXT WELL in `widget.field` (x 138..550,
 *    #1c1c1c), and a trailing pushbutton in `widget.regular` (x 553..590,
 *    #535353), the whole thing outlined in #3c3c3c at x 74..75 / 591..592 and
 *    y 140..141 / 178..179.
 *
 * What we DO NOT draw, by the standing rule that a control writing nowhere is
 * not drawn: Blender's well carries a `⌄` because it PICKS a datablock and its
 * trailing button is the fake-user shield — this editor has neither verb, so
 * the well is the kind glyph alone and the trailing slot carries the subject's
 * own identity verbs (the visibility eye) instead. That eye's home in the
 * reference is the Outliner, which our Hierarchy row already has; this is the
 * shortcut, on the row whose trailing slot the reference spends the same way.
 *
 * Every fact the narrow column's row shows is still here — name, kind, the
 * document path, the identity verbs, the definition link, the multi-selection
 * warning and the note — rearranged into the reference's two rows.
 * {@link SubjectIdentity} is untouched, so the narrow column (every other
 * skin's default) is pixel-identical.
 */
function PropertiesIdentity({ subject }: { readonly subject: InspectionSubject }) {
  const identity = subject.identity;
  if (!identity) return <SubjectIdentity subject={subject} />;
  const definition = definitionLink(subject);
  /**
   * THE SUBJECT'S KIND GLYPH — not the open tab's, and not the rail's first.
   *
   * MEASURED, and it settles a reading this row has had wrong twice. Blender's
   * breadcrumb leads with the DATABLOCK the editor is about, on every tab:
   * crop the first breadcrumb glyph (28x28 device at x 80..107, y 74..101)
   * out of `properties-object.png`, `properties-modifier.png` and
   * `properties-data-edit.png` and the three are byte-identical — 0 of 784
   * pixels differ — while the open tab is Object, Modifier and Data in turn.
   * On the Modifier tab Blender draws the object square, NOT the wrench.
   *
   * The row first derived this from `sections[0].icon`, which is RAIL ORDER;
   * that looked right only while Data happened to be first, and the rail unit
   * that put Modifiers above Data (Blender's order) broke it. The fix then
   * was the ACTIVE TAB's icon, which is right for the rail's own active plate
   * and wrong here — it agrees with the frames on Object and Data only
   * because those two tabs' glyphs coincide with their datablock's, and
   * disagrees on the one tab that discriminates.
   *
   * `hierarchy-kind-icon.ts` is the host's single kind-name-to-glyph table
   * and the Outliner's rows already read it, so the breadcrumb and the well
   * now read the same table for the same subject. Fallback stays the first
   * section's glyph, for a subject whose adapter names no kind.
   */
  const glyph = identity.kind
    ? hierarchyKindIcon(identity.kind, firstSectionGlyph(subject))
    : firstSectionGlyph(subject);
  const chain = subject.title || identity.kindLabel || '';
  const chainTitle = [identity.kindLabel, identity.document?.path, identity.document?.title]
    .filter(Boolean)
    .join(' — ');
  return (
    <div className="vgai-inspector-identity" data-vgai-identity-layout="properties">
      <div className="vgai-inspector-breadcrumb">
        <EditorIcon icon={glyph} tone="primary" />
        {/* A NAME, not a path: it ellipsizes at the TAIL like every other
            name in the chrome. The head-ellipsis (`direction: rtl`) this row
            used to carry existed for the path, which is now the tooltip. */}
        <span
          className="vgai-inspector-breadcrumb-chain"
          data-testid="inspector-document-path"
          {...(identity.document ? { 'data-document-path': identity.document.path } : {})}
          {...(chainTitle ? { title: chainTitle } : {})}
        >
          <bdi>{chain}</bdi>
        </span>
        {actionsPlacedAt(subject, 'identity').map((action) => (
          <QuickActionIconButton key={action.id} action={action} />
        ))}
      </div>
      {
        <div className="vgai-inspector-datablock">
          <span
            className="vgai-inspector-datablock-kind"
            data-testid="inspector-kind-label"
            {...(identity.kindLabel ? { title: identity.kindLabel } : {})}
          >
            {/* PLAIN ink, not the category's: Blender's well glyph measures 229
                on every frame, the same white as the breadcrumb's. The category
                colour lives in the RAIL and nowhere else in this body. */}
            <EditorIcon icon={glyph} tone="primary" />
          </span>
          <SubjectNameField subject={subject} />
          {definition && <EditDefinitionButton link={definition} />}
        </div>
      }
      {subject.alsoSelected ? (
        <div
          data-testid="inspector-also-selected"
          style={{
            marginTop: spaceVar[3],
            fontSize: 'var(--vgai-font-base)',
            color: themeVars.content.dim,
          }}
        >
          {`${subject.alsoSelected + 1} selected — fields edit this one, the gizmo moves all`}
        </div>
      ) : null}
      {identity.note?.text && (
        <div
          data-testid="inspector-subject-note"
          style={{
            marginTop: spaceVar[3],
            fontSize: 'var(--vgai-font-base)',
            color: themeVars.content.dim,
          }}
        >
          {identity.note.text}
        </div>
      )}
    </div>
  );
}

/** One section under its own header — title AND icon, unconditionally. The
 *  disclosure triangle is the STACK's affordance (`collapsible`). The wrapper
 *  carries `data-inspector-section` so the icon strip can scroll to it. */
function ProjectedSection({ section }: { readonly section: InspectionSection }) {
  return (
    <div data-testid={section.testId} data-inspector-section={section.id}>
      <SectionHeader
        label={section.title}
        icon={section.icon}
        description={section.description}
        collapsible
        defaultOpen={section.defaultOpen ?? true}
      >
        {sectionBody(section)}
      </SectionHeader>
    </div>
  );
}

/**
 * The NARROW COLUMN (default): identity row, the section-icon strip, the
 * derivation chain, then every section stacked and collapsible. A strip glyph
 * scrolls its section into view within this column.
 */
export function NarrowColumn({ subject }: { readonly subject: InspectionSubject }) {
  const sectionsRef = useRef<HTMLDivElement>(null);
  const jumpToSection = (sectionId: string) => {
    const target = sectionsRef.current?.querySelector(`[data-inspector-section="${sectionId}"]`);
    target?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };
  return (
    <div style={{ pointerEvents: 'auto' }}>
      <SubjectIdentity subject={subject} />
      <SectionIconStrip subject={subject} onJump={jumpToSection} />
      <RelatedSubjects subject={subject} />
      <div ref={sectionsRef}>
        {subject.sections.map((section) => (
          <Fragment key={section.id}>
            <ProjectedSection section={section} />
          </Fragment>
        ))}
      </div>
    </div>
  );
}

/**
 * Which tab each subject last showed under the PROPERTIES presentation, and
 * the last tab shown anywhere — Blender keeps the Properties editor on the
 * same tab across selections when the new object has it, and that is the
 * behaviour a modeler's hands expect: pick Material, click through objects,
 * still on Material. Keyed by subject id, bounded like the scroll memory.
 */
const propertiesTabMemory = new Map<string, string>();
let lastPropertiesTab: string | null = null;

/**
 * The PROPERTIES column: identity row and derivation chain as the narrow
 * column has them, then the sections TABBED — a vertical icon rail down the
 * left edge, one section body at a time under a non-collapsible header (a
 * triangle would offer to hide the only thing in the box). Every section
 * earns a rail glyph, 1:1 with `subject.sections` — this rail is the
 * NAVIGATION, not a table of contents, so the strip's "five sections or no
 * strip" economy does not apply.
 */
export function PropertiesColumn({ subject }: { readonly subject: InspectionSubject }) {
  const tabs = compactInspectorTabs(subject);
  const remembered = propertiesTabMemory.get(subject.id) ?? lastPropertiesTab;
  const [chosen, setChosen] = useState<string | null>(null);
  // WHAT THE RAIL OPENS ON, in order: the tab this person clicked, the one
  // they last used, THE TAB A SECTION DECLARED AS THE DEFAULT, and only then
  // the first tab. The declaration exists because Blender's Properties editor
  // does not open on its first tab: `SpaceProperties.context` is stored per
  // screen in the startup file, and at factory settings
  // `bpy.data.screens['Layout']` reads OBJECT while the rail's first tab is
  // Render (measured against Blender 5.2 LTS, walk 5 parity row 3 — ours
  // opened the cube on the Render tab). A rail whose sections declare nothing
  // opens on its first tab exactly as before.
  const activeId =
    (chosen && tabs.some((tab) => tab.id === chosen) ? chosen : null) ??
    (remembered && tabs.some((tab) => tab.id === remembered) ? remembered : null) ??
    tabs.find((tab) => tab.railDefault)?.id ??
    tabs[0]?.id ??
    null;
  const active = subject.sections.find((section) => section.id === activeId) ?? null;
  const choose = (id: string) => {
    setChosen(id);
    if (propertiesTabMemory.size > 200) propertiesTabMemory.clear();
    propertiesTabMemory.set(subject.id, id);
    lastPropertiesTab = id;
  };
  return (
    // The class carries no paint: it is the one named handle the rail needs
    // to reach the bottom of the panel (`compact-inspector.css`, beside the
    // rail's own `min-height: 100%`). Without a name this wrapper sizes to
    // its content and the rail stops under the last tab.
    <div className="vgai-inspector-properties-fill" style={{ pointerEvents: 'auto' }}>
      {/* THE RAIL IS THE AREA'S FULL LEFT EDGE, and the identity rows sit
          BESIDE it, not above. Measured on `properties-object.png` at 2x: the
          rail column runs x 2..57 from the body's top (y=47) to the frame's
          bottom, and the breadcrumb's own glyph starts at x=80 — everything
          the editor draws is to the right of the rail. Ours used to stack the
          identity across the full width and start the rail under it. */}
      <div className="vgai-inspector-properties" data-testid="inspector-properties">
        <div
          className="vgai-inspector-properties-rail"
          role="tablist"
          aria-orientation="vertical"
          aria-label="Sections"
        >
          {tabs.map((tab, index) => (
            <Fragment key={tab.id}>
              {/* THE RAIL HAS GROUPS, and Blender's draws ground between them:
                  `ED_buttons_tabs_list` (`space_buttons.cc:201-255`) calls
                  `add_spacer()` between the tool tab, the scene group, the
                  collection tab, the object group and Texture, appending a
                  `BCONTEXT_SEPARATOR` the rail renders as a gap rather than a
                  tab. Measured on `modeling-edit-none.png` down x=2852: 1 CSS
                  px of hairline between cells of ONE group, 8.5 across a group
                  boundary. Sections that name no group form one trailing group
                  — a subject with no `railGroup` anywhere draws no separator
                  at all, which is every non-Blender rail. */}
              {index > 0 && tab.railGroup !== tabs[index - 1]?.railGroup ? (
                <div
                  className="vgai-inspector-properties-rail-separator"
                  data-testid="properties-tab-separator"
                  role="presentation"
                />
              ) : null}
              <IconButton
                size="compact"
                role="tab"
                aria-selected={tab.id === activeId}
                data-testid={`properties-tab-${tab.id}`}
                aria-label={tab.title}
                title={tab.title}
                onClick={() => choose(tab.id)}
              >
                {/* A tab glyph, not body text: Blender's Properties tabs are
                    14px in a 28px strip, and the default `sm` rendered these at
                    10 — a rail of specks beside the reference. */}
                <EditorIcon icon={tab.icon} size="xl" />
              </IconButton>
            </Fragment>
          ))}
        </div>
        <div className="vgai-inspector-properties-body" role="tabpanel">
          <PropertiesIdentity subject={subject} />
          <RelatedSubjects subject={subject} />
          {/* NO HEADER OVER THE ACTIVE TAB. Blender's Properties editor never
              heads a tab's content with the tab's own name — measured on three
              frames at 2x: `properties-object.png` runs header → breadcrumb →
              datablock row → the `Transform` CARD; `properties-data-edit.png`
              runs the same three rows → the `Vertex Groups` card;
              `modeling.png`'s Modifier tab → `Add Modifier`. The rail already
              says which editor you are in, and a slab repeating it was the
              full-bleed bar at the top of our column. The sections BELOW keep
              their own headers, because in the reference they are the cards. */}
          {active ? (
            <div data-testid={active.testId} data-inspector-section={active.id}>
              {sectionBody(active)}
            </div>
          ) : null}
          {/* Sections that host publishing contributions stay live behind the
              active tab (`InspectionSection.keepMounted`). */}
          {subject.sections
            .filter((section) => section.keepMounted && section.id !== activeId)
            .map((section) => (
              <div
                key={section.id}
                data-inspector-section={section.id}
                data-inspector-section-hidden="true"
                style={{ display: 'none' }}
              >
                {sectionBody(section)}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}

/** The mini card's preview, or a kind glyph for a no-preview subject. */
/** The preview's stand-in: the first section's glyph when the active set
 *  draws one for it, the cube otherwise. A section name the set does not carry
 *  draws the generic project-tool wrench (`tool-loader.ts`), which says nothing
 *  about the subject — a Blender object under any set but Blender's. */
function firstSectionGlyph(subject: InspectionSubject) {
  const first = subject.sections[0]?.icon;
  if (!first) return faCube;
  return drawnGlyph(first) === drawnGlyph(faScrewdriverWrench) ? faCube : first;
}

/**
 * The MINI card — the space-tight fallback: the subject's preview (or a kind
 * glyph) above its name and eye, the same section-icon strip, and the labeled
 * open-for-edit when the subject carries a definition. Clicking the preview or
 * a strip glyph EXPANDS the column (an in-place zoom on the same subject);
 * `minimize` (when the viewport host provides one) drops to the pill.
 *
 * `surface` is the key the expand preference is written under; a bounded host
 * that names none renders the card without the expand affordance.
 */
export function MiniInspectorCard({
  subject,
  surface,
}: {
  readonly subject: InspectionSubject;
  readonly surface?: InspectionSurfaceKind | undefined;
}) {
  const host = useCompactInspectorHost();
  const previewSection = subject.sections.find((section) => section.body.kind === 'preview');
  const previewBody = previewSection?.body.kind === 'preview' ? previewSection.body : null;
  const definition = definitionLink(subject);
  const expand = surface ? () => setInspectorPresentationOverride(surface, 'column') : null;
  const inIdentity = subject.identity !== null;
  return (
    <div
      className="vgai-mini-inspector"
      data-testid="inspector-panel"
      data-vgai-inspector-presentation="card"
      onPointerDown={() => setActiveScope('inspector')}
    >
      {host && (
        <IconButton
          size="compact"
          className="vgai-mini-inspector-minimize"
          data-testid="inspector-minimize"
          aria-label="Minimize inspector"
          title="Minimize inspector"
          onClick={host.minimize}
        >
          <EditorIcon icon={faWindowMinimize} />
        </IconButton>
      )}
      {/* The preview (or kind glyph) is the primary EXPAND gesture — clicking
          the box restores the column. */}
      <div
        className="vgai-mini-inspector-preview"
        data-testid="inspector-mini-preview"
        {...(expand
          ? {
              role: 'button',
              tabIndex: 0,
              'aria-label': `Expand inspector for ${subject.title}`,
              title: `Expand inspector for ${subject.title}`,
              onClick: expand,
              onKeyDown: (event: ReactKeyboardEvent) => {
                if (event.key === ' ' || event.key === 'Enter') {
                  event.preventDefault();
                  expand();
                }
              },
            }
          : {})}
      >
        <SubjectThumbnail
          render={previewBody ? previewBody.render : null}
          glyph={firstSectionGlyph(subject)}
          subjectKey={subject.id}
        />
      </div>
      {inIdentity ? (
        <div className="vgai-mini-inspector-identity">
          <SubjectNameField subject={subject} />
          {actionsPlacedAt(subject, 'identity').map((action) => (
            <QuickActionIconButton key={action.id} action={action} />
          ))}
        </div>
      ) : (
        <div className="vgai-mini-inspector-identity">
          <div style={{ flex: 1, minWidth: 0, fontSize: 'var(--vgai-font-md)', fontWeight: 600 }}>
            {subject.title}
          </div>
        </div>
      )}
      <SectionIconStrip subject={subject} onJump={() => expand?.()} />
      {definition && (
        <div className="vgai-mini-inspector-actions">
          <EditDefinitionButton link={definition} />
        </div>
      )}
    </div>
  );
}

/**
 * The PILL — the floor: a single line carrying the subject's thumb-glyph, its
 * name, and an expand affordance. The whole lozenge restores the column;
 * `onClear` is the minimized state's only route to deselect (there is no
 * viewport gesture reaching a minimized box).
 */
export function InspectorPill({
  subject,
  onExpand,
  onClear,
}: {
  readonly subject: InspectionSubject;
  readonly onExpand: () => void;
  readonly onClear?: (() => void) | undefined;
}) {
  const previewSection = subject.sections.find((section) => section.body.kind === 'preview');
  const previewBody = previewSection?.body.kind === 'preview' ? previewSection.body : null;
  return (
    <div className="vgai-inspector-pill" data-testid="inspector-pill">
      {/* The role-annotated div is the sanctioned clickable-card idiom — a raw
          native control here trips the design-system product-chrome scan. */}
      <div
        role="button"
        tabIndex={0}
        className="vgai-inspector-pill-open"
        aria-label={`Expand inspector for ${subject.title}`}
        title={`Expand inspector for ${subject.title}`}
        onClick={onExpand}
        onKeyDown={(event) => {
          if (event.key === ' ' || event.key === 'Enter') {
            event.preventDefault();
            onExpand();
          }
        }}
      >
        <span className="vgai-inspector-pill-thumb" aria-hidden="true">
          {previewBody ? (
            previewBody.render('thumbnail')
          ) : (
            <EditorIcon icon={firstSectionGlyph(subject)} />
          )}
        </span>
        <span className="vgai-inspector-pill-name">{subject.title}</span>
      </div>
      {onClear && (
        <IconButton
          data-testid="inspector-fab-clear-selection"
          aria-label="Clear selection"
          title="Clear selection"
          onClick={onClear}
        >
          <EditorIcon icon={faXmark} />
        </IconButton>
      )}
    </div>
  );
}

export interface InspectionProjectionProps {
  readonly subject: InspectionSubject;
  /** Which layout to render. The live shell reads this off the composed
   *  subject through `inspection/display.ts`; it is never re-derived here. */
  readonly presentation: InspectionPresentation;
  /** The surface this projection is showing, when it is the live shell's —
   *  the key the presentation-switch affordances write their override under.
   *  Omitted in bounded design-system hosts, which offer no switch. */
  readonly surface?: InspectionSurfaceKind;
}

/**
 * Column scroll memory across the RE-PROJECTION remount. A source write's HMR
 * re-projection drops the selection for ~a beat (the measured, unpinned drop
 * `react-world-authoring-adapter.ts#scheduleSelectionRepair` documents), which
 * unmounts this panel entirely; the repair restores the SAME subject and the
 * fresh mount landed at the top — measured live: the column node is REPLACED
 * and `scrollTop` resets to 0 within 600ms of any style write, which the
 * blind walker read as "every Fill edit scrolls the inspector back to top"
 * (Fill just sits below the fold). Keyed by subject id, so a genuinely new
 * selection still opens at the top while the same subject keeps its place.
 */
const columnScrollMemory = new Map<string, number>();

/** ONE subject, projected. */
export function InspectionProjectionView({
  subject,
  presentation,
  surface,
}: InspectionProjectionProps) {
  const subjectId = subject.id;
  const restoreScroll = useCallback(
    (el: HTMLDivElement | null) => {
      if (el) el.scrollTop = columnScrollMemory.get(subjectId) ?? 0;
    },
    [subjectId],
  );
  if (presentation === 'card') {
    return <MiniInspectorCard subject={subject} {...(surface ? { surface } : {})} />;
  }
  return (
    <Panel
      name="Inspector"
      hideHeader
      className="vgai-content-frost"
      data-testid="inspector-panel"
      data-vgai-inspector-presentation={presentation}
      onPointerDown={() => setActiveScope('inspector')}
      style={{ overflowY: 'auto' }}
      ref={restoreScroll}
      onScroll={(e: ReactUIEvent<HTMLDivElement>) => {
        if (columnScrollMemory.size > 200) columnScrollMemory.clear();
        columnScrollMemory.set(subjectId, e.currentTarget.scrollTop);
      }}
    >
      {presentation === 'properties' ? (
        <PropertiesColumn subject={subject} />
      ) : (
        <NarrowColumn subject={subject} />
      )}
    </Panel>
  );
}
