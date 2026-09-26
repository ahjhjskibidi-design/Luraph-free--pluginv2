/**
 * utf8 runtime — the Lua 5.3 utf8 library.
 *
 * The utf8 library provides Unicode-aware string operations. Lua
 * strings are byte arrays, so a UTF-8 encoded string is a sequence
 * of bytes that represents codepoints.
 *
 * Functions:
 *   utf8.char(...)            — build string from codepoints
 *   utf8.charpattern          — string pattern matching one UTF-8 byte sequence
 *   utf8.codepoint(s [, i [, j]]) — codepoint(s) at position(s)
 *   utf8.codes(s)             — iterator over codepoints
 *   utf8.len(s [, i [, j]])   — number of codepoints
 *   utf8.offset(s, n [, i])   — byte position of the nth codepoint
 *
 * Lua 5.4 adds:
 *   utf8.codepoint(s, i, j, lax)
 *
 * This implementation targets the 5.3 subset. All operations treat
 * strings as byte sequences and decode UTF-8 into 21-bit codepoints.
 */

import { luaToString, luaToNumber, luaTypeName } from './type.js';

// ============================================================
// Constants
// ============================================================

// Maximum Unicode codepoint (U+10FFFF)
const MAX_CODEPOINT = 0x10FFFF;

// A pattern that matches one UTF-8 encoded byte sequence of 1-4 bytes
export const utf8Charpattern = '[\\0-\\x7F\\xC2-\\xFD][\\x80-\\xBF]*';

// ============================================================
// Encoding / decoding primitives
// ============================================================

/**
 * Encode a single codepoint to UTF-8 bytes.
 * Returns an array of byte values.
 */
export function encodeCodepoint(cp) {
  if (cp < 0 || cp > MAX_CODEPOINT) {
    throw new Error('bad codepoint 0x' + cp.toString(16) + ' out of range');
  }
  if (cp < 0x80) {
    return [cp];
  }
  if (cp < 0x800) {
    return [
      0xC0 | (cp >> 6),
      0x80 | (cp & 0x3F),
    ];
  }
  if (cp < 0x10000) {
    return [
      0xE0 | (cp >> 12),
      0x80 | ((cp >> 6) & 0x3F),
      0x80 | (cp & 0x3F),
    ];
  }
  return [
    0xF0 | (cp >> 18),
    0x80 | ((cp >> 12) & 0x3F),
    0x80 | ((cp >> 6) & 0x3F),
    0x80 | (cp & 0x3F),
  ];
}

/**
 * Decode a UTF-8 sequence starting at byte index i in the byte
 * array. Returns { codepoint, length } or null if invalid.
 */
export function decodeCodepoint(bytes, i) {
  const b0 = bytes[i];
  if (b0 === undefined) return null;

  let length;
  let codepoint;

  if (b0 < 0x80) {
    return { codepoint: b0, length: 1 };
  }
  if (b0 < 0xC0) {
    // Continuation byte without a lead — invalid
    return null;
  }
  if (b0 < 0xE0) {
    length = 2;
    codepoint = b0 & 0x1F;
  } else if (b0 < 0xF0) {
    length = 3;
    codepoint = b0 & 0x0F;
  } else if (b0 < 0xF8) {
    length = 4;
    codepoint = b0 & 0x07;
  } else {
    return null;
  }

  for (let k = 1; k < length; k++) {
    const b = bytes[i + k];
    if (b === undefined || (b & 0xC0) !== 0x80) return null;
    codepoint = (codepoint << 6) | (b & 0x3F);
  }

  // Reject overlong encodings
  if (length === 2 && codepoint < 0x80) return null;
  if (length === 3 && codepoint < 0x800) return null;
  if (length === 4 && codepoint < 0x10000) return null;

  if (codepoint > MAX_CODEPOINT) return null;

  return { codepoint, length };
}

/**
 * Convert a JS string to a byte array. JS strings use UTF-16 code
 * units, so we need to handle surrogate pairs.
 */
export function stringToBytes(s) {
  const bytes = [];
  for (let i = 0; i < s.length; i++) {
    let cp = s.charCodeAt(i);
    // Handle surrogate pairs
    if (cp >= 0xD800 && cp <= 0xDBFF && i + 1 < s.length) {
      const low = s.charCodeAt(i + 1);
      if (low >= 0xDC00 && low <= 0xDFFF) {
        cp = 0x10000 + ((cp - 0xD800) << 10) + (low - 0xDC00);
        i++;
      }
    }
    const encoded = encodeCodepoint(cp);
    for (const b of encoded) bytes.push(b);
  }
  return bytes;
}

/**
 * Convert a byte array to a JS string.
 */
export function bytesToString(bytes) {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const decoded = decodeCodepoint(bytes, i);
    if (!decoded) {
      // Invalid byte — emit the byte as-is (Latin-1 fallback)
      out += String.fromCharCode(bytes[i]);
      i++;
      continue;
    }
    if (decoded.codepoint <= 0xFFFF) {
      out += String.fromCharCode(decoded.codepoint);
    } else {
      const cp = decoded.codepoint - 0x10000;
      out += String.fromCharCode(0xD800 + (cp >> 10));
      out += String.fromCharCode(0xDC00 + (cp & 0x3FF));
    }
    i += decoded.length;
  }
  return out;
}

// ============================================================
// Lua-level functions
// ============================================================

/**
 * utf8.char(...)
 *
 * Takes a sequence of codepoints and returns a UTF-8 encoded string.
 */
export function utf8Char(...codepoints) {
  const bytes = [];
  for (const cp of codepoints) {
    const n = Math.trunc(luaToNumber(cp));
    const encoded = encodeCodepoint(n);
    for (const b of encoded) bytes.push(b);
  }
  return bytesToString(bytes);
}

/**
 * utf8.codepoint(s [, i [, j [, lax]])
 *
 * Returns the codepoints of the characters starting at byte i and
 * ending at byte j. If j is absent, returns just one codepoint.
 * If lax is true, invalid sequences are treated as single bytes.
 */
export function utf8Codepoint(s, i, j, lax) {
  s = luaToString(s);
  const bytes = stringToBytes(s);
  i = i === undefined ? 1 : Math.trunc(luaToNumber(i));
  if (i < 0) i = bytes.length + i + 1;
  if (i < 1) i = 1;

  if (j === undefined) {
    const decoded = decodeCodepoint(bytes, i - 1);
    if (!decoded) {
      if (lax) return [bytes[i - 1]];
      throw new Error('invalid UTF-8 code');
    }
    return [decoded.codepoint];
  }

  j = Math.trunc(luaToNumber(j));
  if (j < 0) j = bytes.length + j + 1;
  if (j > bytes.length) j = bytes.length;

  const out = [];
  let k = i - 1;
  while (k < j) {
    const decoded = decodeCodepoint(bytes, k);
    if (!decoded) {
      if (lax) {
        out.push(bytes[k]);
        k++;
        continue;
      }
      throw new Error('invalid UTF-8 code');
    }
    out.push(decoded.codepoint);
    k += decoded.length;
  }
  return out;
}

/**
 * utf8.len(s [, i [, j [, lax]])
 *
 * Returns the number of codepoints in the range, or (nil, pos) if an
 * invalid sequence is found at pos.
 */
export function utf8Len(s, i, j, lax) {
  s = luaToString(s);
  const bytes = stringToBytes(s);
  i = i === undefined ? 1 : Math.trunc(luaToNumber(i));
  if (i < 0) i = bytes.length + i + 1;
  if (i < 1) i = 1;
  j = j === undefined ? bytes.length : Math.trunc(luaToNumber(j));
  if (j < 0) j = bytes.length + j + 1;
  if (j > bytes.length) j = bytes.length;

  let count = 0;
  let k = i - 1;
  while (k < j) {
    const decoded = decodeCodepoint(bytes, k);
    if (!decoded) {
      if (lax) {
        count++;
        k++;
        continue;
      }
      return [null, k + 1];
    }
    count++;
    k += decoded.length;
  }
  return [count];
}

/**
 * utf8.offset(s, n [, i])
 *
 * Returns the byte position of the nth character relative to byte
 * position i (default 1). n can be negative to count from the end.
 *
 * Special cases:
 *   n = 0 — position of the start of the character containing byte i
 *   n > 0 — position of the nth character starting at or after i
 *   n < 0 — position of the nth character ending at or before i
 */
export function utf8Offset(s, n, i) {
  s = luaToString(s);
  const bytes = stringToBytes(s);
  n = Math.trunc(luaToNumber(n));

  if (i === undefined) {
    i = n >= 0 ? 1 : bytes.length + 1;
  } else {
    i = Math.trunc(luaToNumber(i));
    if (i < 0) i = bytes.length + i + 1;
  }

  if (n === 0) {
    // Walk backwards to find the start of the character containing i
    let k = i - 1;
    while (k > 0 && (bytes[k] & 0xC0) === 0x80) k--;
    return k + 1;
  }

  if (n > 0) {
    let k = i - 1;
    let count = 1;
    while (k < bytes.length) {
      if (count === n) return k + 1;
      const decoded = decodeCodepoint(bytes, k);
      if (!decoded) return null;
      k += decoded.length;
      count++;
    }
    return null;
  }

  // n < 0
  let k = i - 1;
  let count = -1;
  while (k > 0) {
    if (count === n) return k + 1;
    k--;
    while (k > 0 && (bytes[k] & 0xC0) === 0x80) k--;
    count--;
  }
  if (count === n) return 1;
  return null;
}

/**
 * utf8.codes(s)
 *
 * Returns an iterator that yields (pos, codepoint) pairs.
 * Only usable from a generic for. Since we can't return closures that
 * capture the VM, we return a state table that the VM understands.
 */
export function utf8Codes(s) {
  s = luaToString(s);
  const bytes = stringToBytes(s);
  return function* () {
    let i = 0;
    while (i < bytes.length) {
      const decoded = decodeCodepoint(bytes, i);
      if (!decoded) {
        throw new Error('invalid UTF-8 code');
      }
      yield [i + 1, decoded.codepoint];
      i += decoded.length;
    }
  };
}

// ============================================================
// Library object
// ============================================================

export function makeUtf8Library() {
  return {
    char: utf8Char,
    charpattern: utf8Charpattern,
    codepoint: utf8Codepoint,
    codes: utf8Codes,
    len: utf8Len,
    offset: utf8Offset,
  };
}

export default {
  utf8Charpattern,
  encodeCodepoint,
  decodeCodepoint,
  stringToBytes,
  bytesToString,
  utf8Char,
  utf8Codepoint,
  utf8Len,
  utf8Offset,
  utf8Codes,
  makeUtf8Library,
};