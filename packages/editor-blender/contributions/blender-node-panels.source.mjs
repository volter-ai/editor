/**
 * TRACING A NODE'S SOCKET PANELS FROM BLENDER'S OWN DECLARATIONS — the table
 * that closes I5's one named gap (WORK.md §Blender in the tab is Blender,
 * "Inspection parity", I5; RULED 2026-09-19: "socket panels are traced from
 * Blender's source, like the icons and the palette").
 *
 * ## Why a trace and not a read
 *
 * `Node.panel_states` is RNA's whole answer about a node's socket panels: a
 * `persistent_uid` and `is_collapsed`, and nothing else
 * (`rna_nodetree.cc:9289-9299`, `:9430-9434`). Which SOCKETS belong to a
 * panel, what a panel is CALLED, and where a panel sits among the node's
 * items all live in the node's C++ declaration — the `root_items` list that
 * `node_update_basis_from_declaration` (`node_draw.cc:1086-1218`) walks — and
 * bpy exposes no part of it. Measured on the engine: a
 * `ShaderNodeBsdfPrincipled` answers 8 panel states and not one of its
 * `NodeSocket`s carries a panel field.
 *
 * So the membership is READ FROM THE SOURCE, exactly as the icons are traced
 * out of `release/datafiles/icons_svg/*.svg` (`blender-icon-trace.mjs`) and
 * the palette out of `userdef_default_theme.c` (`blender-palette.source.mjs`).
 * The reference is Blender's SOURCE as well as its frames
 * (ARCHITECTURE-CORE §Blender north star), and a declaration is source.
 *
 * ## What is traced, and what deliberately is not
 *
 * ONLY node types that DECLARE A PANEL. A node with no panel is already laid
 * out correctly by the flat path — its flattened item list is its socket list
 * — so a table row for it would carry no information and would have to be
 * kept in step with 558 files instead of 36. Measured at Blender 5.2.0
 * (`fbe6228777e7`): 558 `node_*.cc` files, **36** of which call `add_panel`
 * in a declaration (17 composite, 11 geometry, 5 shader, 3 function).
 *
 * TWO `add_panel` CALL SITES ARE EXCLUDED AND THE REASON IS STATED.
 * `intern/node_declaration.cc:474` is the builder method itself, not a
 * declaration. `intern/node_common.cc:485` is the NODE GROUP's declare, which
 * builds its panels in a LOOP over `ntree->tree_interface` — a group's panels
 * are runtime data, not a static declaration, and RNA *can* answer them
 * (`NodeTree.interface`), so tracing them would be tracing the wrong thing.
 * A group node therefore has no row here and keeps the flat fallback.
 *
 * ## The grammar this reads
 *
 * A declaration body is a straight-line sequence of builder calls. Measured
 * across the 36 files, a panel is introduced in exactly two spellings —
 * `PanelDeclarationBuilder &<var> = <recv>.add_panel("Name")` (49 sites) and
 * `auto &<var> = <recv>.add_panel("Name")` (17 sites) — and everything else
 * is `<recv>.add_input<…>("Name"[, "Identifier"])`,
 * `<recv>.add_output<…>(…)`, `<recv>.add_layout(…)`,
 * `<recv>.add_default_layout()` and `<recv>.add_separator()`, where `<recv>`
 * is either the root builder's own parameter or a bound panel variable. That
 * is the whole grammar, and this file parses that and nothing more.
 *
 * A body with CONTROL FLOW is parsed straight through — both arms of an
 * `if`/`else` contribute items, in source order — and the entry is marked
 * `conditional`. That is deliberately a LOUD approximation rather than a
 * clever one: the consumer checks the traced item list against the engine's
 * LIVE socket list before it uses it, and a node whose real declaration took
 * the other arm simply disagrees and falls back to flat with its frame
 * warning. A static parser cannot evaluate `b.tree_or_null()`, and pretending
 * otherwise is how a drawing quietly stops being a measurement.
 *
 * ## Running it
 *
 * ```
 * node packages/blender/contributions/blender-node-panels.source.mjs \
 *   [--checkout <path>] [--check]
 * ```
 * writes (or, with `--check`, verifies) `blender.node-panels.json` beside
 * this file. The checkout defaults to `~/volter/blender-src`, the sparse
 * checkout pinned at the engine's own commit; `source/blender/nodes` is one
 * of the paths it must carry (see the checkout recipe's file map).
 *
 * ## Licence
 *
 * What lands in the JSON is a table of PANEL NAMES and SOCKET NAMES read out
 * of GPL-2.0-or-later sources. `@vgai/blender` is AGPL-3.0-only, which that
 * is compatible with (relicense to GPL-3.0, then §13), and the package
 * already carries Blender itself — the same standing this file's sibling
 * `blender-icon-trace.mjs` records for the icon paths. Nothing traced here
 * may be copied into an Apache-2.0 or MIT part of this repo.
 */

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_CHECKOUT = join(homedir(), 'volter', 'blender-src');
const NODES_ROOT = join('source', 'blender', 'nodes');
const OUT = fileURLToPath(new URL('./blender.node-panels.json', import.meta.url));

/** The two `add_panel` call sites that are not a node's declaration — see the
 *  header. Both are named rather than filtered by a shape rule, so a third one
 *  appearing upstream shows up as a new row instead of vanishing. */
const NOT_A_DECLARATION = new Set([
  join(NODES_ROOT, 'intern', 'node_common.cc'),
  join(NODES_ROOT, 'intern', 'node_declaration.cc'),
]);

/* ----------------------------------------------------------------- scanning */

/**
 * Comments out, strings kept. A C++ scanner rather than a regex because a
 * `//` inside a string literal (`"http://…"`) and a `"` inside a comment both
 * occur in this tree, and either one defeats the regex form.
 */
function stripComments(source) {
  let out = '';
  for (let index = 0; index < source.length; index++) {
    const two = source.slice(index, index + 2);
    if (two === '//') {
      while (index < source.length && source[index] !== '\n') index++;
      out += '\n';
      continue;
    }
    if (two === '/*') {
      index += 2;
      while (index < source.length && source.slice(index, index + 2) !== '*/') {
        if (source[index] === '\n') out += '\n';
        index++;
      }
      index += 1;
      continue;
    }
    if (source[index] === '"') {
      out += '"';
      index++;
      while (index < source.length && source[index] !== '"') {
        if (source[index] === '\\') {
          out += source[index] + (source[index + 1] ?? '');
          index += 2;
          continue;
        }
        out += source[index];
        index++;
      }
      out += '"';
      continue;
    }
    out += source[index];
  }
  return out;
}

/** The body of the block whose `{` is at `open`, without the braces. */
function blockAt(source, open) {
  let depth = 0;
  for (let index = open; index < source.length; index++) {
    if (source[index] === '{') depth++;
    else if (source[index] === '}') {
      depth--;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  throw new Error('unbalanced block');
}

/**
 * A block split into STATEMENTS, with control-flow blocks flattened in place.
 *
 * `;` at nesting depth 0 ends a statement; a `{ … }` that closes back to
 * depth 0 is spliced in as its own statements, which is what makes an
 * `if`/`else` body contribute its items in source order (and what makes the
 * entry `conditional` — see the header).
 */
function statementsOf(block) {
  const out = [];
  let current = '';
  let depth = 0;
  let sawControl = false;
  for (let index = 0; index < block.length; index++) {
    const char = block[index];
    if (char === '"') {
      const end = block.indexOf('"', index + 1);
      current += block.slice(index, end + 1);
      index = end;
      continue;
    }
    if (char === '(' || char === '[') depth++;
    else if (char === ')' || char === ']') depth--;
    else if (char === '{') {
      if (depth === 0) {
        // A control-flow or scope block at statement level. Its HEAD (the
        // `if (…)`, the `for (…)`) is discarded and its body is flattened in.
        const inner = blockAt(block, index);
        if (/\b(if|else|for|while|switch|do)\b/.test(current)) sawControl = true;
        const nested = statementsOf(inner);
        out.push(...nested.statements);
        sawControl ||= nested.sawControl;
        index += inner.length + 1;
        current = '';
        continue;
      }
      depth++;
    } else if (char === '}') depth--;
    else if (char === ';' && depth === 0) {
      out.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim() !== '') out.push(current);
  return { statements: out, sawControl };
}

/* ----------------------------------------------------------------- the walk */

/**
 * The string literals in the FIRST call of a chain, and only that call.
 *
 * `open` is the index of its `(`. Taking the balanced argument list rather
 * than "every quoted run in the statement" is not a nicety: the very first
 * node measured, `Base Color`, chains
 * `.description("Color of the material used for …")`, and a whole-statement
 * scan reads that sentence as the socket's identifier.
 */
function firstStrings(call, open) {
  let depth = 0;
  let end = call.length;
  for (let index = open; index < call.length; index++) {
    const char = call[index];
    if (char === '"') {
      index = call.indexOf('"', index + 1);
      if (index < 0) break;
      continue;
    }
    if (char === '(') depth++;
    else if (char === ')') {
      depth--;
      if (depth === 0) {
        end = index;
        break;
      }
    }
  }
  const args = call.slice(open + 1, end);
  const found = [];
  const each = /"((?:[^"\\]|\\.)*)"/g;
  for (let hit = each.exec(args); hit !== null; hit = each.exec(args)) found.push(hit[1]);
  return found;
}

/**
 * ONE DECLARATION BODY → the `root_items` tree Blender's own
 * `NodeDeclaration` holds, in declaration order.
 *
 * Each item is `{kind}` where kind is `input` | `output` | `panel` |
 * `layout` | `separator`, matching the five `flat_item::Type`s
 * `make_flat_node_items` produces (`node_draw.cc:798-831`). A panel carries
 * its `name`, its `defaultClosed` and its own `items`.
 */
function parseDeclaration(body, rootParam) {
  const root = { items: [] };
  /** Builder variable → the item list it appends to. The root builder's own
   *  parameter is bound first, which is how `b.add_input(…)` lands at root. */
  const lists = new Map([[rootParam, root]]);
  const { statements, sawControl } = statementsOf(body);
  let customSocketOrder = false;
  const unknown = [];

  for (const statement of statements) {
    // PREPROCESSOR LINES ARE NOT STATEMENTS and they carry no `;`, so a
    // `#define SOCK_BASE_COLOR_ID 0` between two `add_input` calls otherwise
    // glues itself to the front of the next one and defeats the anchored
    // match below. Principled has one after every socket.
    const text = statement
      .split('\n')
      .filter((line) => !/^\s*#/.test(line))
      .join('\n')
      .replace(/\s+/g, ' ')
      .trim();
    if (text === '') continue;
    if (new RegExp(`\\b${rootParam}\\.use_custom_socket_order\\s*\\(`).test(text)) {
      customSocketOrder = true;
      continue;
    }
    // `PanelDeclarationBuilder &name = recv.add_panel(…)` / `auto &name = …`.
    const bind = /^(?:const\s+)?(?:PanelDeclarationBuilder|auto)\s*&\s*(\w+)\s*=\s*([\s\S]*)$/.exec(
      text,
    );
    const binding = bind ? bind[1] : null;
    const call = bind ? bind[2] : text;
    const head = /^(\w+)\s*\.\s*(\w+)\s*(?:<[^(]*>)?\s*\(/.exec(call);
    if (!head) continue;
    const [, receiver, method] = head;
    const open = call.indexOf('(', head[0].length - 1);
    const owner = lists.get(receiver);
    if (!owner) continue;

    if (method === 'add_panel') {
      const names = firstStrings(call, open);
      const panel = { kind: 'panel', name: names[0] ?? '', items: [] };
      // `PanelDeclaration::default_collapsed` (`NOD_node_declaration.hh:505`),
      // set by `.default_closed(bool)`. Absent means false.
      if (/\.default_closed\s*\(\s*true\s*\)/.test(call)) panel.defaultClosed = true;
      owner.items.push(panel);
      if (binding) lists.set(binding, panel);
      continue;
    }
    if (method === 'add_input' || method === 'add_output') {
      const names = firstStrings(call, open);
      if (names.length === 0) continue;
      // EVERY OPTIONAL FLAG IS OMITTED WHEN IT IS FALSE, and `identifier` when
      // it equals the name. The table is 36 node types and is meant to be
      // READ in review; spelling four `false`s per socket triples it for no
      // information (105 KB against 47 KB, measured).
      const socket = {
        kind: method === 'add_input' ? 'input' : 'output',
        name: names[0],
      };
      // `add_input(name, identifier)` — the identifier defaults to the name
      // (`DeclarationListBuilder::add_socket`), and the identifier is what a
      // live `NodeSocket` is matched on.
      if (names[1] && names[1] !== names[0]) socket.identifier = names[1];
      // `.panel_toggle()` makes this the panel's HEADER checkbox rather than a
      // row of its own — `PanelDeclaration::panel_input_decl()`
      // (`node_declaration.cc:528-542`) takes the panel's FIRST item when it
      // is a panel-toggle boolean input.
      if (/\.panel_toggle\s*\(/.test(call)) socket.panelToggle = true;
      // `.available(<expr>)` — a socket whose availability is COMPUTED. It is
      // recorded rather than resolved: the consumer matches against the LIVE
      // socket list, where the expression has already been evaluated.
      if (/\.available\s*\(/.test(call)) socket.conditional = true;
      // `SocketDeclaration::align_with_previous_socket` (`:196`): this socket
      // shares the previous socket's ROW instead of taking one
      // (`add_flat_items_for_socket`, `node_draw.cc:704-717`).
      if (/\.align_with_previous\s*\(\s*(?:true\s*)?\)/.test(call)) {
        socket.alignWithPrevious = true;
      }
      owner.items.push(socket);
      continue;
    }
    if (method === 'add_layout' || method === 'add_default_layout') {
      owner.items.push({ kind: 'layout' });
      continue;
    }
    if (method === 'add_separator') {
      owner.items.push({ kind: 'separator' });
      continue;
    }
    if (method.startsWith('add_')) unknown.push(`${receiver}.${method}`);
  }
  return { items: root.items, customSocketOrder, conditional: sawControl, unknown };
}

/* ------------------------------------------------------------ the registry */

/**
 * The node types a file registers, each with the declaration function it
 * points `ntype.declare` at.
 *
 * `<x>_node_type_base(&ntype, "IDNAME"_ustr, …)` names the type and
 * `ntype.declare = <ns>::<fn>` names the body. Where one file registers two
 * types from two nested namespaces with the SAME function name
 * (`node_geo_foreach_geometry_element.cc` is the measured case), the body is
 * the definition of that name nearest ABOVE the register function — which is
 * what C++ name lookup resolves to from inside the namespace.
 */
function registrationsOf(source) {
  const declares = [];
  const declareEach =
    /(?:static\s+)?void\s+(\w+)\s*\(\s*(?:const\s+)?NodeDeclarationBuilder\s*&\s*(\w+)\s*\)\s*\{/g;
  for (let hit = declareEach.exec(source); hit !== null; hit = declareEach.exec(source)) {
    declares.push({
      name: hit[1],
      param: hit[2],
      at: hit.index,
      body: blockAt(source, hit.index + hit[0].length - 1),
    });
  }
  const out = [];
  // THREE SPELLINGS, measured across the tree: `static void node_register()`
  // with `NOD_REGISTER_NODE(node_register)` (411 sites, the modern one),
  // `static void register_node()` (5) and the legacy
  // `void register_node_type_sh_*()` (the shader tree's). A function is a
  // registration when its body calls `<x>_node_type_base(&ntype, "IDNAME")`,
  // which is the test below; these names are only how the body is FOUND.
  const registerEach =
    /(?:static\s+)?void\s+(register_node_type_\w+|node_register|register_node)\s*\(\s*\)\s*\{/g;
  for (let hit = registerEach.exec(source); hit !== null; hit = registerEach.exec(source)) {
    const body = blockAt(source, hit.index + hit[0].length - 1);
    const idname = /_node_type_base\s*\(\s*&\s*ntype\s*,\s*"([^"]+)"/.exec(body);
    const declare = /ntype\.declare\s*=\s*(?:[\w:]+::)?(\w+)\s*;/.exec(body);
    if (!idname || !declare) continue;
    const candidates = declares.filter(
      (entry) => entry.name === declare[1] && entry.at < hit.index,
    );
    const chosen = candidates[candidates.length - 1];
    if (!chosen) continue;
    out.push({ idname: idname[1], declare: chosen });
  }
  return out;
}

/* -------------------------------------------------------------------- main */

function* walk(directory) {
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) yield* walk(path);
    else if (/^node_.*\.cc$/.test(entry)) yield path;
  }
}

function build(checkout) {
  const root = join(checkout, NODES_ROOT);
  const table = {};
  const report = { files: 0, withPanels: 0, types: 0, conditional: [], unknown: new Set() };
  for (const path of [...walk(root)].sort()) {
    report.files++;
    const key = relative(checkout, path);
    if (NOT_A_DECLARATION.has(key)) continue;
    const raw = readFileSync(path, 'utf8');
    if (!raw.includes('add_panel')) continue;
    const source = stripComments(raw);
    let traced = 0;
    for (const { idname, declare } of registrationsOf(source)) {
      const parsed = parseDeclaration(declare.body, declare.param);
      if (!parsed.items.some((item) => item.kind === 'panel')) continue;
      traced++;
      report.types++;
      if (parsed.conditional) report.conditional.push(idname);
      for (const name of parsed.unknown) report.unknown.add(name);
      table[idname] = {
        // `is_node_panels_supported` is `decl->use_custom_socket_order`
        // (`node_draw.cc:343-346`), which is what puts the node on the
        // DECLARATION layout path at all. A panel-declaring node that does not
        // set it is a contradiction worth carrying rather than hiding.
        customSocketOrder: parsed.customSocketOrder,
        ...(parsed.conditional ? { conditional: true } : {}),
        items: parsed.items,
      };
    }
    if (traced > 0) report.withPanels++;
  }
  return { table, report };
}

function main() {
  const argv = process.argv.slice(2);
  const checkoutFlag = argv.indexOf('--checkout');
  const checkout = checkoutFlag >= 0 ? argv[checkoutFlag + 1] : DEFAULT_CHECKOUT;
  const { table, report } = build(checkout);
  const ordered = Object.fromEntries(Object.entries(table).sort(([a], [b]) => (a < b ? -1 : 1)));
  const text = `${JSON.stringify(ordered, null, 2)}\n`;
  if (argv.includes('--check')) {
    const have = readFileSync(OUT, 'utf8');
    if (have !== text) {
      console.error('blender.node-panels.json is STALE — re-run this script without --check.');
      process.exit(1);
    }
    console.log(
      `blender.node-panels.json — up to date (${Object.keys(ordered).length} node types)`,
    );
    return;
  }
  writeFileSync(OUT, text);
  const panels = Object.values(ordered).reduce((sum, entry) => sum + countPanels(entry.items), 0);
  console.log(
    `blender.node-panels.json — ${Object.keys(ordered).length} node types, ${panels} panels, ` +
      `from ${report.withPanels} of ${report.files} node_*.cc files`,
  );
  if (report.conditional.length > 0) {
    console.log(
      `  conditional declarations (parsed straight through): ${report.conditional.join(', ')}`,
    );
  }
  if (report.unknown.size > 0) {
    console.log(`  builder calls this grammar does not know: ${[...report.unknown].join(', ')}`);
  }
}

function countPanels(items) {
  let count = 0;
  for (const item of items) {
    if (item.kind === 'panel') count += 1 + countPanels(item.items);
  }
  return count;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();

export { build, parseDeclaration, registrationsOf, statementsOf, stripComments };
