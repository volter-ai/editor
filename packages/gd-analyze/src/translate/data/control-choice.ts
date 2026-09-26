/** Structural extraction of authored OptionButton/ItemList payloads. */

import type { GodotValue } from '../../read/godot-value';
import { num, quote, TranslateError } from './model';

export interface AuthoredChoiceData {
  readonly items: readonly string[];
  readonly selected: readonly number[];
  readonly multiple: boolean;
  readonly allowReselect: boolean;
}

export interface AuthoredPopupData {
  readonly items: readonly string[];
  readonly hideOnItemSelection: boolean;
  readonly hideOnCheckableItemSelection: boolean;
  readonly hideOnMultistateItemSelection: boolean;
}

function integer(value: GodotValue | undefined, at: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (value.kind !== 'number' || !Number.isSafeInteger(value.value)) {
    throw new TranslateError(at, 'choice integer property must be a safe integer');
  }
  return value.value;
}

function boolean(value: GodotValue | undefined, at: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value.kind !== 'bool') throw new TranslateError(at, 'choice bool property must be bool');
  return value.value;
}

function string(value: GodotValue | undefined, at: string, fallback = ''): string {
  if (value === undefined) return fallback;
  if (value.kind !== 'string') throw new TranslateError(at, 'choice text property must be String');
  return value.value;
}

function variant(value: GodotValue | undefined, at: string): string {
  if (value === undefined || value.kind === 'null') return 'null';
  if (value.kind === 'string') return quote(value.value);
  if (value.kind === 'number') return num(value.value);
  if (value.kind === 'bool') return String(value.value);
  if (value.kind === 'array') {
    return `[${value.items.map((item, index) => variant(item, `${at}[${index}]`)).join(', ')}]`;
  }
  if (value.kind === 'dict') {
    return `new Map([${value.entries.map((entry) => `[${quote(entry.key)}, ${variant(entry.value, `${at}.${entry.key}`)}]`).join(', ')}])`;
  }
  if (value.kind === 'ctor' && (value.name === 'StringName' || value.name === 'NodePath') && value.args.length === 1) {
    return variant(value.args[0], at);
  }
  throw new TranslateError(at, 'choice metadata uses an unsupported Variant shape');
}

function refuseIcon(value: GodotValue | undefined, at: string): void {
  if (value !== undefined && value.kind !== 'null') {
    throw new TranslateError(at, 'authored choice item icons are not carried by the retained text choice presentation');
  }
}

function itemLiteral(
  text: string,
  id: number,
  disabled: boolean,
  selectable: boolean,
  separator: boolean,
  metadata: string,
): string {
  return `{ text: ${quote(text)}, id: ${num(id)}, disabled: ${String(disabled)}, selectable: ${String(selectable)}, separator: ${String(separator)}, metadata: ${metadata} }`;
}

function popupCheckable(value: GodotValue | undefined, at: string): 'none' | 'check' | 'radio' {
  if (value === undefined) return 'none';
  if (value.kind === 'bool') return value.value ? 'check' : 'none';
  if (value.kind !== 'number' || !Number.isSafeInteger(value.value) || value.value < 0 || value.value > 2) {
    throw new TranslateError(at, 'PopupMenu checkable type must be NONE (0), CHECK_BOX (1), or RADIO_BUTTON (2)');
  }
  return value.value === 0 ? 'none' : value.value === 1 ? 'check' : 'radio';
}

function popupItemLiteral(
  text: string,
  id: number,
  checked: boolean,
  disabled: boolean,
  separator: boolean,
  checkable: 'none' | 'check' | 'radio',
  metadata: string,
  maxStates = 0,
): string {
  return `{ text: ${quote(text)}, id: ${num(id)}, checked: ${String(checked)}, disabled: ${String(disabled)}, separator: ${String(separator)}, checkable: ${quote(checkable)}, maxStates: ${num(maxStates)}, metadata: ${metadata}, submenu: '' }`;
}

/** Decode PopupMenu's dialect-owned serialized item payload into retained compat data. */
export function authoredPopupData(
  properties: Readonly<Record<string, GodotValue>>,
  major: 3 | 4,
  at: string,
): AuthoredPopupData {
  const items: string[] = [];
  const hideOnItemSelection = boolean(properties['hide_on_item_selection'], `${at}.hide_on_item_selection`, true);
  const hideOnCheckableItemSelection = boolean(
    properties['hide_on_checkable_item_selection'],
    `${at}.hide_on_checkable_item_selection`,
    true,
  );
  const hideOnMultistateItemSelection = boolean(
    properties['hide_on_multistate_item_selection'] ?? properties['hide_on_state_item_selection'],
    `${at}.hide_on_multistate_item_selection`,
    false,
  );
  const allowSearch = boolean(properties['allow_search'], `${at}.allow_search`, false);
  if (allowSearch) {
    throw new TranslateError(`${at}.allow_search`, 'PopupMenu incremental keyboard search is not carried by the retained browser/Pixi menu');
  }
  if (major === 3) {
    const packed = properties['items'];
    if (packed === undefined) return { items, hideOnItemSelection, hideOnCheckableItemSelection, hideOnMultistateItemSelection };
    if (packed.kind !== 'array' || packed.items.length % 10 !== 0) {
      throw new TranslateError(`${at}.items`, 'PopupMenu items payload must be an Array whose length is divisible by 10');
    }
    for (let offset = 0; offset < packed.items.length; offset += 10) {
      refuseIcon(packed.items[offset + 1], `${at}.items[${offset + 1}]`);
      const accelerator = integer(packed.items[offset + 6], `${at}.items[${offset + 6}]`, 0);
      if (accelerator !== 0) {
        throw new TranslateError(`${at}.items[${offset + 6}]`, 'PopupMenu authored accelerators require the native shortcut dispatcher');
      }
      const submenu = string(packed.items[offset + 8], `${at}.items[${offset + 8}]`);
      if (submenu !== '') {
        throw new TranslateError(`${at}.items[${offset + 8}]`, 'PopupMenu authored submenus require a retained PopupMenu child hierarchy');
      }
      items.push(popupItemLiteral(
        string(packed.items[offset], `${at}.items[${offset}]`),
        integer(packed.items[offset + 5], `${at}.items[${offset + 5}]`, offset / 10),
        boolean(packed.items[offset + 3], `${at}.items[${offset + 3}]`, false),
        boolean(packed.items[offset + 4], `${at}.items[${offset + 4}]`, false),
        boolean(packed.items[offset + 9], `${at}.items[${offset + 9}]`, false),
        popupCheckable(packed.items[offset + 2], `${at}.items[${offset + 2}]`),
        variant(packed.items[offset + 7], `${at}.items[${offset + 7}]`),
      ));
    }
    return { items, hideOnItemSelection, hideOnCheckableItemSelection, hideOnMultistateItemSelection };
  }

  const count = integer(properties['item_count'], `${at}.item_count`, 0);
  if (count < 0) throw new TranslateError(`${at}.item_count`, 'PopupMenu item_count must be non-negative');
  for (let index = 0; index < count; index += 1) {
    const prefix = `item_${index}/`;
    refuseIcon(properties[`${prefix}icon`], `${at}.${prefix}icon`);
    const accelerator = integer(properties[`${prefix}accelerator`], `${at}.${prefix}accelerator`, 0);
    if (accelerator !== 0) {
      throw new TranslateError(`${at}.${prefix}accelerator`, 'PopupMenu authored accelerators require the native shortcut dispatcher');
    }
    const submenu = properties[`${prefix}submenu`];
    if (submenu !== undefined && submenu.kind !== 'null') {
      throw new TranslateError(`${at}.${prefix}submenu`, 'PopupMenu authored submenus require a retained PopupMenu child hierarchy');
    }
    items.push(popupItemLiteral(
      string(properties[`${prefix}text`], `${at}.${prefix}text`),
      integer(properties[`${prefix}id`], `${at}.${prefix}id`, index),
      boolean(properties[`${prefix}checked`], `${at}.${prefix}checked`, false),
      boolean(properties[`${prefix}disabled`], `${at}.${prefix}disabled`, false),
      boolean(properties[`${prefix}separator`], `${at}.${prefix}separator`, false),
      popupCheckable(properties[`${prefix}checkable`], `${at}.${prefix}checkable`),
      variant(properties[`${prefix}metadata`], `${at}.${prefix}metadata`),
      integer(properties[`${prefix}max_states`], `${at}.${prefix}max_states`, 0),
    ));
  }
  return { items, hideOnItemSelection, hideOnCheckableItemSelection, hideOnMultistateItemSelection };
}

export function authoredChoiceData(
  properties: Readonly<Record<string, GodotValue>>,
  kind: 'OptionButton' | 'ItemList',
  major: 3 | 4,
  at: string,
): AuthoredChoiceData {
  const items: string[] = [];
  const selected: number[] = [];
  if (major === 3) {
    const packed = properties['items'];
    if (packed !== undefined) {
      if (packed.kind !== 'array') throw new TranslateError(`${at}.items`, 'choice items must be Array');
      const stride = kind === 'OptionButton' ? 5 : 3;
      if (packed.items.length % stride !== 0) {
        throw new TranslateError(`${at}.items`, `${kind} items payload length must be divisible by ${stride}`);
      }
      for (let offset = 0; offset < packed.items.length; offset += stride) {
        const index = offset / stride;
        const text = string(packed.items[offset], `${at}.items[${offset}]`);
        refuseIcon(packed.items[offset + 1], `${at}.items[${offset + 1}]`);
        const disabled = boolean(packed.items[offset + 2], `${at}.items[${offset + 2}]`, false);
        const id = kind === 'OptionButton'
          ? integer(packed.items[offset + 3], `${at}.items[${offset + 3}]`, index)
          : index;
        const metadata = kind === 'OptionButton'
          ? variant(packed.items[offset + 4], `${at}.items[${offset + 4}]`)
          : 'null';
        items.push(itemLiteral(text, id, disabled, !disabled, false, metadata));
      }
    }
  } else {
    const count = integer(properties['item_count'], `${at}.item_count`, 0);
    if (count < 0) throw new TranslateError(`${at}.item_count`, 'choice item_count must be non-negative');
    for (let index = 0; index < count; index += 1) {
      const prefix = kind === 'OptionButton' ? `popup/item_${index}/` : `item_${index}/`;
      refuseIcon(properties[`${prefix}icon`], `${at}.${prefix}icon`);
      const text = string(properties[`${prefix}text`], `${at}.${prefix}text`);
      const disabled = boolean(properties[`${prefix}disabled`], `${at}.${prefix}disabled`, false);
      const separator = kind === 'OptionButton'
        ? boolean(properties[`${prefix}separator`], `${at}.${prefix}separator`, false)
        : false;
      const selectable = kind === 'ItemList'
        ? boolean(properties[`${prefix}selectable`], `${at}.${prefix}selectable`, !disabled)
        : !disabled && !separator;
      const id = integer(properties[`${prefix}id`], `${at}.${prefix}id`, index);
      const metadata = variant(properties[`${prefix}metadata`], `${at}.${prefix}metadata`);
      items.push(itemLiteral(text, id, disabled, selectable, separator, metadata));
      if (boolean(properties[`${prefix}selected`], `${at}.${prefix}selected`, false)) selected.push(index);
    }
  }
  const authoredSelected = integer(properties['selected'], `${at}.selected`, -1);
  if (kind === 'OptionButton' && authoredSelected >= 0) selected.splice(0, selected.length, authoredSelected);
  const selectMode = integer(properties['select_mode'], `${at}.select_mode`, 0);
  if (kind === 'ItemList' && selectMode !== 0 && selectMode !== 1) {
    throw new TranslateError(`${at}.select_mode`, 'ItemList select_mode must be SELECT_SINGLE (0) or SELECT_MULTI (1)');
  }
  return {
    items,
    selected,
    multiple: kind === 'ItemList' && selectMode === 1,
    allowReselect: boolean(properties['allow_reselect'], `${at}.allow_reselect`, false),
  };
}
