/**
 * NAMED STYLES — the planner behind "create a style from this selection"
 * (the design ledger's named-styles order; Webflow is the prior art). A
 * named style IS a CSS class in the project's own stylesheet — the web's
 * answer to a Figma style, and strictly stronger: it carries any property,
 * cascades, and responds to media/state. Until this, the editor could only
 * write inline styles and detected utility classes; nothing could mint a
 * reusable, project-owned class.
 *
 * Pure text surgery over the CSS source, in the writer idiom
 * (`plan-csf-story.ts` is the shape precedent): every refusal is a named
 * sentence, and the only grammar this file needs is "a class rule is
 * `.name { declarations }` appended at top level" — the dev server's
 * `@scope` wrapping happens at SERVE time, so source rules stay unwrapped.
 */

/** One planned edit: the whole next CSS source, or the refusal. */
export type NamedStylePlan =
  | { ok: true; nextSource: string; summary: string }
  | { ok: false; reason: string };

/** A CSS class name this planner will mint: an ordinary identifier with
 *  hyphens — the deliberate subset of CSS ident syntax that never needs
 *  escaping in a selector, a `className` attribute, or a querySelector. */
const CLASS_NAME = /^[A-Za-z_][A-Za-z0-9_-]*$/;

export function isValidClassName(name: string): boolean {
  return CLASS_NAME.test(name);
}

/**
 * Does the CSS source already declare a rule for `.name`? A plain-text scan:
 * `.name` followed by a non-ident character, not preceded by an ident
 * character. Deliberately over-matches (a `.name` inside a comment or url()
 * counts) — this gates CREATION, so the safe error direction is refusing a
 * class that does not truly exist, never silently doubling one that does.
 */
export function classRuleExists(cssSource: string, className: string): boolean {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\w-])\\.${escaped}(?![\\w-])`).test(cssSource);
}

/** One declaration of the new rule, already in CSS vocabulary. */
export interface PlannedDeclaration {
  /** kebab-case CSS property name. */
  prop: string;
  /** CSS value text, unit spelled (`8px`, not `8`). */
  value: string;
}

/**
 * Append a new class rule `.className { … }` to the stylesheet. An EMPTY
 * declarations list is legitimate — Webflow's flow is exactly "name the
 * class first, style it after", and once the element wears the class the
 * style routing (`namedStyleRuleFor`) makes the rule the landing place for
 * subsequent property edits.
 */
export function planCreateClassRule(
  cssSource: string,
  className: string,
  decls: readonly PlannedDeclaration[],
): NamedStylePlan {
  if (!isValidClassName(className)) {
    return {
      ok: false,
      reason:
        `"${className}" is not a usable class name — use letters, digits, hyphens and ` +
        'underscores, starting with a letter.',
    };
  }
  if (classRuleExists(cssSource, className)) {
    return {
      ok: false,
      reason:
        `a rule mentioning ".${className}" already exists in this stylesheet — apply the ` +
        'existing class, or pick another name.',
    };
  }
  const body = decls.map((d) => `  ${d.prop}: ${d.value};\n`).join('');
  const lead =
    cssSource.length === 0 || cssSource.endsWith('\n\n')
      ? ''
      : cssSource.endsWith('\n')
        ? '\n'
        : '\n\n';
  const nextSource = `${cssSource}${lead}.${className} {\n${body}}\n`;
  return {
    ok: true,
    nextSource,
    summary:
      decls.length === 0
        ? `created empty style .${className}`
        : `created .${className} with ${decls.length} declaration${decls.length === 1 ? '' : 's'}`,
  };
}
