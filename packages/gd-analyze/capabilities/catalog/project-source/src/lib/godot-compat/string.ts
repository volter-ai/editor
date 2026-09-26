/**
 * Complete Godot 4.7 built-in String Variant surface.
 *
 * The translator lowers every method to one literal-keyed call here. Semantics stay split across
 * the copied core/path/encoding/format modules, mirroring `core/string/ustring.cpp` rather than
 * growing compiler rewrites for an engine library.
 */

import {
  codePoints,
  compareString,
  fileCompareString,
  godotStringify,
  naturalCompareString,
  removeChars,
  replaceChar,
  stringBigrams,
  stringCamel,
  stringCapitalize,
  stringCount,
  stringDedent,
  stringErase,
  stringFind,
  stringFormat,
  stringIndent,
  stringInsert,
  stringIsSubsequence,
  stringKebab,
  stringLeft,
  stringLength,
  stringMatch,
  stringPascal,
  stringReplace,
  stringRepeat,
  stringRight,
  stringRfind,
  stringRsplit,
  stringSimilarity,
  stringSlice,
  stringSliceC,
  stringSliceCount,
  stringSnake,
  stringSplit,
  stringStrip,
  stringStripEdges,
  stringStripEscapes,
  stringSubstr,
} from './string-core';
import {
  stringAsciiBuffer,
  stringBaseToInt,
  stringCEscape,
  stringCUnescape,
  stringHash,
  stringHexDecode,
  stringIsValidAsciiIdentifier,
  stringIsValidFloat,
  stringIsValidHex,
  stringIsValidHtmlColor,
  stringIsValidInt,
  stringIsValidIp,
  stringIsValidUnicodeIdentifier,
  stringJsonEscape,
  stringMd5Buffer,
  stringMd5Text,
  stringMultibyteBuffer,
  stringSha1Buffer,
  stringSha1Text,
  stringSha256Buffer,
  stringSha256Text,
  stringToFloat,
  stringToInt,
  stringUriDecode,
  stringUriEncode,
  stringUriFileDecode,
  stringUtf16Buffer,
  stringUtf32Buffer,
  stringUtf8Buffer,
  stringXmlEscape,
  stringXmlUnescape,
} from './string-encoding';
import {
  godotStringPercent,
  stringHumanizeSize,
  stringNum,
  stringNumInt,
  stringNumScientific,
  stringPad,
  stringPadDecimals,
  stringPadZeros,
  stringTrimPrefix,
  stringTrimSuffix,
} from './string-format';
import {
  stringGetBaseDir,
  stringGetBasename,
  stringGetExtension,
  stringGetFile,
  stringIsAbsolutePath,
  stringIsRelativePath,
  stringIsValidFilename,
  stringPathJoin,
  stringSimplifyPath,
  stringValidateFilename,
  stringValidateNodeName,
} from './string-path';
import { packedArrayKind, packedByteArray, packedFloat64Array, packedStringArray, type PackedStringArray } from './packed-array';

const arg = (args: readonly unknown[], index: number, fallback: unknown): unknown =>
  args[index] === undefined ? fallback : args[index];
const numberArg = (args: readonly unknown[], index: number, fallback = 0): number =>
  Number(arg(args, index, fallback));
const stringArg = (args: readonly unknown[], index: number, fallback = ''): string =>
  String(arg(args, index, fallback));
const boolArg = (args: readonly unknown[], index: number, fallback: boolean): boolean =>
  Boolean(arg(args, index, fallback));

function exactStringArg(
  args: readonly unknown[],
  index: number,
  member: string,
  fallback?: string,
): string {
  const value = args[index];
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'string') throw new TypeError(`String.${member} argument ${String(index)} requires String.`);
  return value;
}

function exactIntegerArg(
  args: readonly unknown[],
  index: number,
  member: string,
  fallback?: number,
): number {
  const value = args[index];
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new TypeError(`String.${member} argument ${String(index)} requires int.`);
  }
  return value;
}

function exactPackedStrings(value: unknown): PackedStringArray {
  if (!Array.isArray(value) || packedArrayKind(value as PackedStringArray) !== 'string') {
    throw new TypeError('String.join requires PackedStringArray.');
  }
  return value as PackedStringArray;
}

function exactIntVariant(value: unknown, member: string): number | bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
  throw new TypeError(`String.${member} requires int.`);
}

function exactArity(
  args: readonly unknown[],
  member: string,
  minimum: number,
  maximum = minimum,
): void {
  if (args.length < minimum || args.length > maximum) {
    const expected = minimum === maximum ? String(minimum) : `${String(minimum)} to ${String(maximum)}`;
    throw new TypeError(`String.${member} requires ${expected} argument(s), received ${String(args.length)}.`);
  }
}

export function godotStringNew(value: unknown = ''): string {
  return value === null || value === undefined ? '' : String(value);
}

export function godotStringCall<T = unknown>(
  method: string,
  value: string,
  args: readonly unknown[],
): T;
export function godotStringCall(method: string, value: string, args: readonly unknown[]): unknown {
  switch (method) {
    case 'casecmp_to':
      return compareString(value, stringArg(args, 0));
    case 'nocasecmp_to':
      return compareString(value, stringArg(args, 0), true);
    case 'naturalcasecmp_to':
      return naturalCompareString(value, stringArg(args, 0));
    case 'naturalnocasecmp_to':
      return naturalCompareString(value, stringArg(args, 0), true);
    case 'filecasecmp_to':
      return fileCompareString(value, stringArg(args, 0));
    case 'filenocasecmp_to':
      return fileCompareString(value, stringArg(args, 0), true);
    case 'length':
      return stringLength(value);
    case 'substr':
      return stringSubstr(value, numberArg(args, 0), numberArg(args, 1, -1));
    case 'get_slice':
      return stringSlice(value, stringArg(args, 0), numberArg(args, 1));
    case 'get_slicec':
      return stringSliceC(value, numberArg(args, 0), numberArg(args, 1));
    case 'get_slice_count':
      return stringSliceCount(value, stringArg(args, 0));
    case 'find':
      return stringFind(value, stringArg(args, 0), numberArg(args, 1));
    case 'findn':
      return stringFind(value, stringArg(args, 0), numberArg(args, 1), true);
    case 'count':
      exactArity(args, 'count', 1, 3);
      return stringCount(
        value,
        exactStringArg(args, 0, 'count'),
        exactIntegerArg(args, 1, 'count', 0),
        exactIntegerArg(args, 2, 'count', 0),
      );
    case 'countn':
      exactArity(args, 'countn', 1, 3);
      return stringCount(
        value,
        exactStringArg(args, 0, 'countn'),
        exactIntegerArg(args, 1, 'countn', 0),
        exactIntegerArg(args, 2, 'countn', 0),
        true,
      );
    case 'rfind':
      return stringRfind(value, stringArg(args, 0), numberArg(args, 1, -1));
    case 'find_last':
      return stringRfind(value, stringArg(args, 0));
    case 'rfindn':
      return stringRfind(value, stringArg(args, 0), numberArg(args, 1, -1), true);
    case 'match':
      return stringMatch(value, stringArg(args, 0), false);
    case 'matchn':
      return stringMatch(value, stringArg(args, 0), true);
    case 'begins_with':
      return value.startsWith(stringArg(args, 0));
    case 'ends_with':
      return value.endsWith(stringArg(args, 0));
    case 'is_subsequence_of':
      exactArity(args, 'is_subsequence_of', 1);
      return stringIsSubsequence(value, exactStringArg(args, 0, 'is_subsequence_of'));
    case 'is_subsequence_ofi':
    case 'is_subsequence_ofn':
      exactArity(args, method, 1);
      return stringIsSubsequence(value, exactStringArg(args, 0, method), true);
    case 'bigrams':
      return packedStringArray(stringBigrams(value));
    case 'similarity':
      return stringSimilarity(value, stringArg(args, 0));
    case 'format':
      exactArity(args, 'format', 1, 2);
      return stringFormat(value, args[0], arg(args, 1, '{_}'));
    case 'replace':
      return stringReplace(value, stringArg(args, 0), stringArg(args, 1));
    case 'replacen':
      exactArity(args, 'replacen', 2);
      return stringReplace(
        value,
        exactStringArg(args, 0, 'replacen'),
        exactStringArg(args, 1, 'replacen'),
        true,
      );
    case 'replace_char':
      return replaceChar(value, String.fromCodePoint(numberArg(args, 0)), numberArg(args, 1));
    case 'replace_chars':
      return replaceChar(value, stringArg(args, 0), numberArg(args, 1));
    case 'remove_char':
      return removeChars(value, String.fromCodePoint(numberArg(args, 0)));
    case 'remove_chars':
      return removeChars(value, stringArg(args, 0));
    case 'repeat':
      exactArity(args, 'repeat', 1);
      return stringRepeat(value, exactIntegerArg(args, 0, 'repeat'));
    case 'reverse':
      return codePoints(value).reverse().join('');
    case 'insert':
      exactArity(args, 'insert', 2);
      return stringInsert(
        value,
        exactIntegerArg(args, 0, 'insert'),
        exactStringArg(args, 1, 'insert'),
      );
    case 'erase':
      return stringErase(value, numberArg(args, 0), numberArg(args, 1, 1));
    case 'capitalize':
      return stringCapitalize(value);
    case 'to_camel_case':
      return stringCamel(value);
    case 'to_pascal_case':
      return stringPascal(value);
    case 'to_snake_case':
      return stringSnake(value);
    case 'to_kebab_case':
      return stringKebab(value);
    case 'split':
      return packedStringArray(
        stringSplit(value, stringArg(args, 0), boolArg(args, 1, true), numberArg(args, 2)),
      );
    case 'rsplit':
      return packedStringArray(
        stringRsplit(value, stringArg(args, 0), boolArg(args, 1, true), numberArg(args, 2)),
      );
    case 'split_floats':
      return packedFloat64Array(
        stringSplit(value, stringArg(args, 0), boolArg(args, 1, true)).map(stringToFloat),
      );
    case 'join':
      exactArity(args, 'join', 1);
      return exactPackedStrings(args[0]).join(value);
    case 'to_upper':
      return value.toUpperCase();
    case 'to_lower':
      return value.toLowerCase();
    case 'left':
      exactArity(args, 'left', 1);
      return stringLeft(value, exactIntegerArg(args, 0, 'left'));
    case 'right':
      exactArity(args, 'right', 1);
      return stringRight(value, exactIntegerArg(args, 0, 'right'));
    case 'strip_edges':
      return stringStripEdges(value, boolArg(args, 0, true), boolArg(args, 1, true));
    case 'strip_escapes':
      exactArity(args, 'strip_escapes', 0);
      return stringStripEscapes(value);
    case 'lstrip':
      return stringStrip(value, stringArg(args, 0), true);
    case 'rstrip':
      return stringStrip(value, stringArg(args, 0), false);
    case 'get_extension':
      return stringGetExtension(value);
    case 'get_basename':
      return stringGetBasename(value);
    case 'path_join':
    case 'plus_file':
      return stringPathJoin(value, stringArg(args, 0));
    case 'unicode_at':
    case 'ord_at':
      return codePoints(value)[Math.trunc(numberArg(args, 0))]?.codePointAt(0) ?? 0;
    case 'indent':
      return stringIndent(value, stringArg(args, 0));
    case 'dedent':
      return stringDedent(value);
    case 'hash':
      exactArity(args, 'hash', 0);
      return stringHash(value);
    case 'md5_text':
      exactArity(args, 'md5_text', 0);
      return stringMd5Text(value);
    case 'sha1_text':
      exactArity(args, 'sha1_text', 0);
      return stringSha1Text(value);
    case 'sha256_text':
      return stringSha256Text(value);
    case 'md5_buffer':
      return packedByteArray(stringMd5Buffer(value));
    case 'sha1_buffer':
      return packedByteArray(stringSha1Buffer(value));
    case 'sha256_buffer':
      return packedByteArray(stringSha256Buffer(value));
    case 'empty':
    case 'is_empty':
      return value.length === 0;
    case 'contains':
      return value.includes(stringArg(args, 0));
    case 'containsn':
      return value.toUpperCase().includes(stringArg(args, 0).toUpperCase());
    case 'is_absolute_path':
    case 'is_abs_path':
      return stringIsAbsolutePath(value);
    case 'is_relative_path':
    case 'is_rel_path':
      return stringIsRelativePath(value);
    case 'simplify_path':
      exactArity(args, 'simplify_path', 0);
      return stringSimplifyPath(value);
    case 'get_base_dir':
      return stringGetBaseDir(value);
    case 'get_file':
      return stringGetFile(value);
    case 'xml_escape':
      return stringXmlEscape(value, boolArg(args, 0, false));
    case 'xml_unescape':
      return stringXmlUnescape(value);
    case 'uri_encode':
      return stringUriEncode(value);
    case 'uri_decode':
      return stringUriDecode(value);
    case 'uri_file_decode':
      return stringUriFileDecode(value);
    case 'c_escape':
      return stringCEscape(value);
    case 'c_unescape':
      exactArity(args, 'c_unescape', 0);
      return stringCUnescape(value);
    case 'json_escape':
      return stringJsonEscape(value);
    case 'validate_node_name':
      exactArity(args, 'validate_node_name', 0);
      return stringValidateNodeName(value);
    case 'validate_filename':
      return stringValidateFilename(value);
    case 'is_valid_ascii_identifier':
      exactArity(args, 'is_valid_ascii_identifier', 0);
      return stringIsValidAsciiIdentifier(value);
    case 'is_valid_unicode_identifier':
      exactArity(args, 'is_valid_unicode_identifier', 0);
      return stringIsValidUnicodeIdentifier(value);
    case 'is_valid_identifier':
      exactArity(args, 'is_valid_identifier', 0);
      return stringIsValidAsciiIdentifier(value);
    case 'is_valid_int':
    case 'is_valid_integer':
      return stringIsValidInt(value);
    case 'is_valid_float':
      return stringIsValidFloat(value);
    case 'is_valid_hex_number':
      return stringIsValidHex(value, boolArg(args, 0, false));
    case 'is_valid_html_color':
      return stringIsValidHtmlColor(value);
    case 'is_valid_ip_address':
      return stringIsValidIp(value);
    case 'is_valid_filename':
      exactArity(args, 'is_valid_filename', 0);
      return stringIsValidFilename(value);
    case 'to_int':
      exactArity(args, 'to_int', 0);
      return stringToInt(value);
    case 'to_float':
      exactArity(args, 'to_float', 0);
      return stringToFloat(value);
    case 'hex_to_int':
      exactArity(args, 'hex_to_int', 0);
      return stringBaseToInt(value, 16);
    case 'bin_to_int':
      exactArity(args, 'bin_to_int', 0);
      return stringBaseToInt(value, 2);
    case 'lpad':
      return stringPad(value, numberArg(args, 0), stringArg(args, 1, ' '), true);
    case 'rpad':
      return stringPad(value, numberArg(args, 0), stringArg(args, 1, ' '), false);
    case 'pad_decimals':
      return stringPadDecimals(value, numberArg(args, 0));
    case 'pad_zeros':
      return stringPadZeros(value, numberArg(args, 0));
    case 'trim_prefix':
      return stringTrimPrefix(value, stringArg(args, 0));
    case 'trim_suffix':
      return stringTrimSuffix(value, stringArg(args, 0));
    case 'to_ascii_buffer':
      return packedByteArray(stringAsciiBuffer(value));
    case 'to_utf8_buffer':
    case 'to_utf8':
      return packedByteArray(stringUtf8Buffer(value));
    case 'to_utf16_buffer':
      return packedByteArray(stringUtf16Buffer(value));
    case 'to_utf32_buffer':
      return packedByteArray(stringUtf32Buffer(value));
    case 'to_wchar_buffer':
      return packedByteArray(stringUtf32Buffer(value));
    case 'to_multibyte_char_buffer':
      return packedByteArray(stringMultibyteBuffer(value, stringArg(args, 0)));
    case 'hex_decode':
      return packedByteArray(stringHexDecode(value));
    default:
      throw new Error(`godot-compat: unsupported String.${method}`);
  }
}

export function godotStringStatic<T = unknown>(method: string, args: readonly unknown[]): T;
export function godotStringStatic(method: string, args: readonly unknown[]): unknown {
  switch (method) {
    case 'num_scientific':
      return stringNumScientific(numberArg(args, 0));
    case 'num':
      return stringNum(numberArg(args, 0), numberArg(args, 1, -1));
    case 'num_int64':
      return stringNumInt(
        args[0] as number | bigint,
        numberArg(args, 1, 10),
        boolArg(args, 2, false),
      );
    case 'num_uint64':
      return stringNumInt(
        args[0] as number | bigint,
        numberArg(args, 1, 10),
        boolArg(args, 2, false),
        true,
      );
    case 'chr': {
      const point = numberArg(args, 0);
      return point === 0 || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)
        ? '\ufffd'
        : String.fromCodePoint(point);
    }
    case 'humanize_size':
      exactArity(args, 'humanize_size', 1);
      return stringHumanizeSize(exactIntVariant(args[0], 'humanize_size'));
    default:
      throw new Error(`godot-compat: unsupported static String.${method}`);
  }
}

export function godotStringOperator(
  operator: '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in',
  left: string,
  right: unknown,
): boolean;
export function godotStringOperator(
  operator: '+' | '%',
  left: string,
  right: unknown,
): string;
export function godotStringOperator(operator: string, left: string, right: unknown): unknown;
export function godotStringOperator(operator: string, left: string, right: unknown): unknown {
  switch (operator) {
    case '==':
      return left === String(right);
    case '!=':
      return left !== String(right);
    case '<':
      return compareString(left, String(right)) < 0;
    case '<=':
      return compareString(left, String(right)) <= 0;
    case '>':
      return compareString(left, String(right)) > 0;
    case '>=':
      return compareString(left, String(right)) >= 0;
    case '+':
      return left + String(right);
    case '%':
      return godotStringPercent(left, right);
    case 'in': {
      if (typeof right === 'string') return right.includes(left);
      if (Array.isArray(right)) return right.some((entry) => entry === left);
      if (right instanceof Map) return right.has(left);
      return typeof right === 'object' && right !== null && left in right;
    }
    default:
      throw new Error(`godot-compat: unsupported String operator ${operator}`);
  }
}

export const godotStringNot = (value: string): boolean => value.length === 0;
export { godotStringPercent, godotStringify };
