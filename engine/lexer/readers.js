/**
 * Readers — functions that consume a specific kind of literal from the
 * source. Each reader assumes the cursor is at the first character of
 * the literal, and advances the lexer past the entire literal.
 *
 * The lexer passes itself as `L` so the readers can call L.advance(),
 * L.peek(), and L.error() without importing the Lexer class.
 */

import { isDigit, isHexDigit } from './chars.js';

/**
 * Read a short string delimited by `quote` (either ' or ").
 * Assumes the opening quote is the current character.
 * Returns the decoded string content (escapes resolved).
 */
export function readShortString(L, quote) {
  L.advance(); // opening quote
  let value = '';
  while (!L.eof()) {
    const c = L.advance();
    if (c === quote) return value;
    if (c === '\n') L.error('unterminated string (newline inside)');
    if (c === '\\') {
      value += readEscape(L);
      continue;
    }
    value += c;
  }
  L.error('unterminated string');
}

/**
 * Read one escape sequence. Assumes the backslash has already been
 * consumed by the caller.
 */
export function readEscape(L) {
  const c = L.advance();
  switch (c) {
    case 'n': return '\n';
    case 't': return '\t';
    case 'r': return '\r';
    case 'a': return '\x07';
    case 'b': return '\b';
    case 'f': return '\f';
    case 'v': return '\v';
    case '\\': return '\\';
    case '"': return '"';
    case "'": return "'";
    case '\n': return '\n';
    case 'x': return readHexEscape(L);
    case 'z': return readWhitespaceSkip(L);
    default:
      if (isDigit(c)) return readDecimalEscape(L, c);
      return c;
  }
}

function readHexEscape(L) {
  let hex = '';
  while (!L.eof() && isHexDigit(L.peek()) && hex.length < 2) {
    hex += L.advance();
  }
  if (hex.length === 0) L.error('\\x needs at least one hex digit');
  return String.fromCharCode(parseInt(hex, 16));
}

function readWhitespaceSkip(L) {
  while (!L.eof() && /\s/.test(L.peek())) L.advance();
  return '';
}

function readDecimalEscape(L, first) {
  let num = first;
  while (!L.eof() && isDigit(L.peek()) && num.length < 3) {
    num += L.advance();
  }
  const code = parseInt(num, 10);
  if (code > 255) L.error('decimal escape out of range (max 255)');
  return String.fromCharCode(code);
}

/**
 * Read a long string delimited by [[ ]], [=[ ]=], [==[ ]==], and so on.
 * The opening bracket and level markers have already been consumed by
 * tryLongBracketLevel; this reads to the matching close.
 */
export function readLongString(L, level) {
  const close = ']' + '='.repeat(level) + ']';
  const end = L.src.indexOf(close, L.pos);
  if (end === -1) L.error('unterminated long string');
  let value = L.src.slice(L.pos, end);
  // Lua skips a single leading newline in long strings
  if (value[0] === '\n') value = value.slice(1);
  advancePosition(L, value);
  L.pos = end + close.length;
  L.col += close.length;
  return value;
}

/**
 * Try to recognize a long-bracket opener at the current position.
 * On success, consumes `[`, the `=`s, and the second `[`, and returns
 * the level. On failure, leaves the lexer untouched and returns -1.
 */
export function tryLongBracketLevel(L) {
  if (L.peek() !== '[') return -1;
  let i = L.pos + 1;
  let level = 0;
  while (L.src[i] === '=') { level++; i++; }
  if (L.src[i] !== '[') return -1;
  L.pos = i + 1;
  return level;
}

/**
 * Read a numeric literal — decimal, hex, or with exponent.
 * Assumes the first character is a digit or a dot followed by a digit.
 */
export function readNumber(L) {
  const start = L.pos;
  // Hex
  if (L.peek() === '0' && (L.peek(1) === 'x' || L.peek(1) === 'X')) {
    L.advance();
    L.advance();
    if (!isHexDigit(L.peek())) L.error('0x needs hex digits');
    while (!L.eof() && isHexDigit(L.peek())) L.advance();
    return parseInt(L.src.slice(start, L.pos), 16);
  }
  // Decimal integer part
  while (!L.eof() && isDigit(L.peek())) L.advance();
  // Fractional part
  if (L.peek() === '.') {
    L.advance();
    while (!L.eof() && isDigit(L.peek())) L.advance();
  }
  // Exponent
  if (L.peek() === 'e' || L.peek() === 'E') {
    L.advance();
    if (L.peek() === '+' || L.peek() === '-') L.advance();
    if (!isDigit(L.peek())) L.error('exponent needs digits');
    while (!L.eof() && isDigit(L.peek())) L.advance();
  }
  return parseFloat(L.src.slice(start, L.pos));
}

/**
 * Update line and column counters as if `text` had just been read.
 * Used after bulk-consuming a chunk of source (long strings).
 */
function advancePosition(L, text) {
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\n') {
      L.line++;
      L.col = 1;
    } else {
      L.col++;
    }
  }
}

export default {
  readShortString,
  readEscape,
  readLongString,
  tryLongBracketLevel,
  readNumber,
};