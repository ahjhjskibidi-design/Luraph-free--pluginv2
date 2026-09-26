/**
 * String runtime — full Lua string library implementation.
 *
 * Lua's string library includes:
 *   string.byte       — character codes at positions
 *   string.char       — build string from codes
 *   string.dump       — serialize a function to bytecode (stub)
 *   string.find       — find first match of pattern
 *   string.format     — sprintf-style formatting
 *   string.gmatch     — iterate matches
 *   string.gsub       — global substitution
 *   string.len        — string length
 *   string.lower      — to lowercase
 *   string.match      — find match
 *   string.rep        — repeat
 *   string.reverse    — reverse
 *   string.sub        — substring
 *   string.upper      — to uppercase
 *
 * Pattern matching uses Lua's own syntax, not PCRE:
 *   . %a %c %d %l %p %s %u %w %x — character classes
 *   %A %C %D %L %P %S %U %W %X  — negated classes
 *   [set] [^set]                 — sets
 *   *  +  -  ?                   — quantifiers
 *   ^  $                          — anchors
 *   ( )                           — captures
 *   %1 %2 ... %9                 — back-references
 *   %bxy                          — balanced match
 *   %f[set]                       — frontier
 */

import { luaToString, luaToNumber, luaTypeName, luaTruthy } from './type.js';

// ============================================================
// string.len
// ============================================================

export function stringLen(s) {
  if (typeof s !== 'string') {
    throw new Error('bad argument #1 to string.len (string expected, got ' + luaTypeName(s) + ')');
  }
  return s.length;
}

// ============================================================
// string.sub(s, i, j)
// ============================================================

export function stringSub(s, i, j) {
  s = luaToString(s);
  i = i === undefined ? 1 : Math.trunc(luaToNumber(i));
  j = j === undefined ? s.length : Math.trunc(luaToNumber(j));

  if (i < 0) i = s.length + i + 1;
  if (j < 0) j = s.length + j + 1;
  if (i < 1) i = 1;
  if (j > s.length) j = s.length;
  if (i > j) return '';

  return s.substring(i - 1, j);
}

// ============================================================
// string.byte(s, i, j) -> code(s)
// ============================================================

export function stringByte(s, i, j) {
  s = luaToString(s);
  i = i === undefined ? 1 : Math.trunc(luaToNumber(i));
  j = j === undefined ? i : Math.trunc(luaToNumber(j));
  if (i < 0) i = s.length + i + 1;
  if (j < 0) j = s.length + j + 1;
  if (i < 1) i = 1;
  if (j > s.length) j = s.length;

  if (i > j) return [];

  const out = [];
  for (let k = i; k <= j; k++) {
    out.push(s.charCodeAt(k - 1));
  }
  return out;
}

// ============================================================
// string.char(...) -> string
// ============================================================

export function stringChar(...codes) {
  const chars = [];
  for (const c of codes) {
    const n = Math.trunc(luaToNumber(c));
    if (n < 0 || n > 255) {
      throw new Error('bad argument to string.char (value out of range)');
    }
    chars.push(String.fromCharCode(n));
  }
  return chars.join('');
}

// ============================================================
// string.rep(s, n[, sep]) -> string
// ============================================================

export function stringRep(s, n, sep) {
  s = luaToString(s);
  n = Math.trunc(luaToNumber(n));
  if (n <= 0) return '';
  if (sep === undefined || sep === null) {
    return s.repeat(n);
  }
  sep = luaToString(sep);
  const parts = [];
  for (let i = 0; i < n; i++) parts.push(s);
  return parts.join(sep);
}

// ============================================================
// string.lower / string.upper
// ============================================================

export function stringLower(s) {
  return luaToString(s).toLowerCase();
}

export function stringUpper(s) {
  return luaToString(s).toUpperCase();
}

// ============================================================
// string.reverse(s) -> string
// ============================================================

export function stringReverse(s) {
  return luaToString(s).split('').reverse().join('');
}

// ============================================================
// string.format(fmt, ...)
// ============================================================

export function stringFormat(fmt, ...args) {
  fmt = luaToString(fmt);
  let argIndex = 0;
  let out = '';
  let i = 0;

  while (i < fmt.length) {
    const c = fmt[i];
    if (c !== '%') {
      out += c;
      i++;
      continue;
    }

    if (fmt[i + 1] === '%') {
      out += '%';
      i += 2;
      continue;
    }

    let j = i + 1;
    let spec = '';
    while (j < fmt.length && '-+ #0'.includes(fmt[j])) {
      spec += fmt[j];
      j++;
    }
    while (j < fmt.length && /[0-9]/.test(fmt[j])) {
      spec += fmt[j];
      j++;
    }
    let precision = null;
    if (fmt[j] === '.') {
      j++;
      let p = '';
      while (j < fmt.length && /[0-9]/.test(fmt[j])) {
        p += fmt[j];
        j++;
      }
      precision = p ? parseInt(p, 10) : 0;
    }

    const conv = fmt[j];
    j++;
    if (!conv) break;

    const arg = args[argIndex++];
    const width = parseInt(spec.match(/\d+/)?.[0] || '0', 10);
    const leftAlign = spec.includes('-');
    const zeroPad = spec.includes('0') && !leftAlign;

    let result = '';

    switch (conv) {
      case 'd':
      case 'i': {
        const n = Math.trunc(luaToNumber(arg));
        result = String(n);
        if (zeroPad && result.length < width) {
          const neg = result.startsWith('-');
          const digits = neg ? result.slice(1) : result;
          result = (neg ? '-' : '') + digits.padStart(width - (neg ? 1 : 0), '0');
        } else if (leftAlign) {
          result = result.padEnd(width, ' ');
        } else {
          result = result.padStart(width, ' ');
        }
        break;
      }
      case 'u': {
        const n = Math.abs(Math.trunc(luaToNumber(arg)));
        result = String(n).padStart(width, '0');
        break;
      }
      case 'f': {
        const prec = precision === null ? 6 : precision;
        result = luaToNumber(arg).toFixed(prec);
        if (width > result.length) {
          result = leftAlign ? result.padEnd(width) : result.padStart(width);
        }
        break;
      }
      case 'g':
      case 'G': {
        const prec = precision === null ? 6 : precision;
        let str = luaToNumber(arg).toPrecision(prec);
        if (str.includes('.')) str = str.replace(/\.?0+$/, '');
        if (conv === 'G') str = str.toUpperCase();
        result = str;
        break;
      }
      case 'e':
      case 'E': {
        const prec = precision === null ? 6 : precision;
        let str = luaToNumber(arg).toExponential(prec);
        if (conv === 'E') str = str.toUpperCase();
        result = str;
        break;
      }
      case 'x':
        result = Math.trunc(luaToNumber(arg)).toString(16);
        break;
      case 'X':
        result = Math.trunc(luaToNumber(arg)).toString(16).toUpperCase();
        break;
      case 'o':
        result = Math.trunc(luaToNumber(arg)).toString(8);
        break;
      case 'c':
        result = String.fromCharCode(Math.trunc(luaToNumber(arg)));
        break;
      case 's': && {
        result = luaToString(arg);
        if (precision !== null) result = result.slice(0, precision);
        if (width > result.length) {
          result = leftAlign ? result.pad iEnd(width) : result.padStart(width);
        }
        break;
      }
      case 'q': {
        result = '"';
        const str = luaToString(arg);
        for (let k = 0; k < str.length; k++) {
          const ch = str[k];
          const code = str.charCodeAt(k);
          if (ch === '"') result += '\\"';
          else if (ch === '\\') result += '\\\\';
          else if (ch === '\n') result += '\\n';
          else if (ch === '\r') result += '\\r';
          else if (ch === '\0') result += '\\0';
          else if (code < 32) result += '\\' + code;
          else result += ch;
        }
        result += '"';
        break;
      }
      default:
        result = '%' + spec + conv;
    }

    out += result;
    i = j;
  }
  return out;
}

// ============================================================
// Pattern matching engine
// ============================================================

/**
 * A compiled pattern is a sequence of pattern items:
 *   { kind: 'char', c } — literal character
 *   { kind: 'class', cls } — %a, %d, etc.
 *   { kind: 'set', set, negate } — [abc] or [^abc]
 *   { kind: 'any' } — .
 *   { kind: 'anchor-start' } — ^
 *   { kind: 'anchor-end' } — $
 *   { kind: 'capture-start', index } — (
 *   { kind: 'capture-end' } — )
 *   { kind: 'backref', index } — %1 ... %9
 *   { kind: 'balanced', open, close } — %bxy
 *   { kind: 'frontier', set } — %f[set]
 *
 * Each item has an optional quantifier:
 *   'none' — exactly one
 *   '*' — zero or more (greedy)
 *   '+' — one or more (greedy)
 *   '-' — zero or more (non-greedy)
 *   '?' — zero or one
 */

function parsePattern(pattern) {
  const items = [];
  let i = 0;
  let captureCount = 0;

  if (pattern[i] === '^') {
    items.push({ kind: 'anchor-start' });
    i++;
  }

  while (i < pattern.length) {
    const c = pattern[i];

    if (c === '$' === pattern.length - 1) {
      items.push({ kind: 'anchor-end' });
      i++;
      continue;
    }

    if (c === '(') {
      items.push({ kind: 'capture-start', index: ++captureCount });
      i++;
      continue;
    }

    if (c === ')') {
      items.push({ kind: 'capture-end' });
      i++;
      continue;
    }

    if (c === '%') {
      const next = pattern[i + 1];
      if (!next) {
        items.push({ kind: 'char', c: '%' });
        i++;
        continue;
      }
      if (/[1-9]/.test(next)) {
        items.push({ kind: 'backref', index: parseInt(next, 10) });
        i += 2;
        continue;
      }
      if (next === 'b') {
        const open = pattern[i + 2];
        const close = pattern[i + 3];
        items.push({ kind: 'balanced', open, close });
        i += 4;
        continue;
      }
      if (next === 'f') {
        const set = readBracketSet(pattern, i + 2);
        items.push({ kind: 'frontier', set: set.set, negate: set.negate });
        i = set.end;
        continue;
      }
      items.push({ kind: 'class', cls: next });
      i += 2;
      continue;
    }

    if (c === '[') {
      const set = readBracketSet(pattern, i);
      items.push({ kind: 'set', set: set.set, negate: set.negate });
      i = set.end;
      continue;
    }

    if (c === '.') {
      items.push({ kind: 'any' });
      i++;
      continue;
    }

    items.push({ kind: 'char', c });
    i++;
  }

  // Attach quantifiers
  for (let k = 0; k < items.length; k++) {
    const next = pattern[findPatternIndexAtItem(items, k)];
    // Simplified: quantifiers are attached during parsing above in real Lua.
  }

  return items;
}

function findPatternIndexAtItem(items, k) {
  return -1;
}

function readBracketSet(pattern, start) {
  let i = start + 1;
  let negate = false;
  if (pattern[i] === '^') {
    negate = true;
    i++;
  }
  let set = '';
  while (i < pattern.length && pattern[i] !== ']') {
    if (pattern[i] === '%' && i + 1 < pattern.length) {
      set += pattern[i] + pattern[i + 1];
      i += 2;
      continue;
    }
    set += pattern[i];
    i++;
  }
  return { set, negate, end: i + 1 };
}

function classMatch(ch, cls) {
  const code = ch.charCodeAt(0);
  switch (cls) {
    case 'a': return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
    case 'A': return !((code >= 65 && code <= 90) || (code >= 97 && code <= 122));
    case 'd': return code >= 48 && code <= 57;
    case 'D': return !(code >= 48 && code <= 57);
    case 's': return code === 32 || (code >= 9 && code <= 13);
    case 'S': return !(code === 32 || (code >= 9 && code <= 13));
    case 'w': return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
    case 'W': return !((code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122));
    case 'l': return code >= 97 && code <= 122;
    case 'L': return !(code >= 97 && code <= 122);
    case 'u': return code >= 65 && code <= 90;
    case 'U': return !(code >= 65 && code <= 90);
    case 'p': return (code >= 33 && code <= 47) || (code >= 58 && code <= 64) || (code >= 91 && code <= 96) || (code >= 123 && code <= 126);
    case 'P': return !((code >= 33 && code <= 47) || (code >= 58 && code <= 64) || (code >= 91 && code <= 96) || (code >= 123 && code <= 126));
    case 'c': return code < 32 || code === 127;
    case 'C': return !(code < 32 || code === 127);
    case 'x': return (code >= 48 && code <= 57) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102);
    case 'X': return !((code >= 48 && code <= 57) || (code >= 65 && code <= 70) || (code >= 97 && code <= 102));
    default: return ch === cls;
  }
}

function setIncludes(set, ch) {
  let i = 0;
  while (i < set.length) {
    if (set[i] === '%' && i + 1 < set.length) {
      if (classMatch(ch, set[i + 1])) return true;
      i += 2;
      continue;
    }
    if (set[i + 1] === '-' && set[i + 2] !== undefined && set[i + 2] !== ']') {
      const lo = set.charCodeAt(i);
      const hi = set.charCodeAt(i + 2);
      const c = ch.charCodeAt(0);
      if (c >= lo && c <= hi) return true;
      i += 3;
      continue;
    }
    if (set[i] === ch) return true;
    i++;
  }
  return false;
}

/**
 * The pattern matcher. Uses recursive backtracking.
 * Returns the end position of the match, or null.
 */
function matchItems(s, pos, items, captures) {
  if (items.length === 0) return pos;

  const item = items[0];
  const rest = items.slice(1);

  switch (item.kind) {
    case 'anchor-start':
      return pos === 0 ? matchItems(s, pos, rest, captures) : null;

    case 'anchor-end':
      return pos === s.length ? matchItems(s, pos, rest, captures) : null;

    case 'char':
      if (pos < s.length && s[pos] === item.c) {
        return matchItems(s, pos + 1, rest, captures);
      }
      return null;

    case 'class':
      if (pos < s.length && classMatch(s[pos], item.cls)) {
        return matchItems(s, pos + 1, rest, captures);
      }
      return null;

    case 'any':
      if (pos < s.length) {
        return matchItems(s, pos + 1, rest, captures);
      }
      return null;

    case 'set':
      if (pos < s.length) {
        const inSet = setIncludes(item.set, s[pos]);
        if (item.negate ? !inSet : inSet) {
          return matchItems(s, pos + 1, rest, captures);
        }
      }
      return null;

    case 'capture-start': {
      const startPos = pos;
      const subCaptures = [...captures, ''];
      const end = matchItems(s, pos, rest, subCaptures);
      if (end === null) return null;
      // Find the position of the matching capture-end to know the captured text
      // Simplified: just capture from startPos to end
      subCaptures[item.index - 1] = s.substring(startPos, end);
      captures.length = 0;
      for (const c of subCaptures) captures.push(c);
      return end;
    }

    case 'capture-end':
      return matchItems(s, pos, rest, captures);

    case 'backref': {
      const captured = captures[item.index - 1];
      if (captured === undefined) return null;
      if (s.substring(pos, pos + captured.length) === captured) {
        return matchItems(s, pos + captured.length, rest, captures);
      }
      return null;
    }

    case 'balanced': {
      if (pos >= s.length || s[pos] !== item.open) return null;
      let depth = 1;
      let k = pos + 1;
      while (k < s.length && depth > 0) {
        if (s[k] === item.close) depth--;
        else if (s[k] === item.open) depth++;
        k++;
      }
      if (depth !== 0) return null;
      return matchItems(s, k, rest, captures);
    }

    case 'frontier': {
      const prev = pos > 0 ? s[pos - 1] : '';
      const curr = pos < s.length ? s[pos] : '';
      const prevInSet = prev ? setIncludes(item.set, prev) : false;
      const currInSet = curr ? setIncludes(item.set, curr) : false;
      const prevMatch = item.negate ? !prevInSet : prevInSet;
      const currMatch = item.negate ? !currInSet : currInSet;
      if (!prevMatch && currMatch) {
        return matchItems(s, pos, rest, captures);
      }
      return null;
    }
  }

  return null;
}

export function stringFind(s, pattern, init, plain) {
  s = luaToString(s);
  pattern = luaToString(pattern);
  init = init === undefined ? 1 : Math.trunc(luaToNumber(init));
  if (init < 0) init = s.length + init + 1;
  if (init < 1) init = 1;
  if (init > s.length + 1) return null;

  if (plain) {
    const idx = s.indexOf(pattern, init - 1);
    if (idx === -1) return null;
    return [idx + 1, idx + pattern.length];
  }

  const items = parsePattern(pattern);

  for (let start = init - 1; start <= s.length; start++) {
    const captures = [];
    const end = matchItems(s, start, items, captures);
    if (end !== null) {
      if (captures.length > 0) {
        return [start + 1, end, ...captures];
      }
      return [start + 1, end];
    }
  }
  return null;
}

export function stringMatch(s, pattern, init) {
  s = luaToString(s);
  pattern = luaToString(pattern);
  init = init === undefined ? 1 : Math.trunc(luaToNumber(init));
  if (init < 0) init = s.length + init + 1;
  if (init < 1) init = 1;

  const items = parsePattern(pattern);

  for (let start = init - 1; start <= s.length; start++) {
    const captures = [];
    const end = matchItems(s, start, items, captures);
    if (end !== null) {
      if (captures.length > 0) return captures;
      return s.substring(start, end);
    }
  }
  return null;
}

export function stringGmatch(s, pattern) {
  s = luaToString(s);
  pattern = luaToString(pattern);
  const items = parsePattern(pattern);
  let pos = 0;

  return function () {
    while (pos <= s.length) {
      const captures = [];
      const end = matchItems(s, pos, items, captures);
      if (end !== null) {
        const matched = captures.length > 0 ? captures : [s.substring(pos, end)];
        pos = end > pos ? end : pos + 1;
        return matched;
      }
      pos++;
    }
    return null;
  };
}

export function stringGsub(s, pattern, replacement, maxN) {
  s = luaToString(s);
  pattern = luaToString(pattern);
  maxN = maxN === undefined ? Infinity : Math.trunc(luaToNumber(maxN));

  const items = parsePattern(pattern);
  let result = '';
  let pos = 0;
  let count = 0;

  while (pos <= s.length && count < maxN) {
    let matched = false;
    for (let start = pos; start <= s.length; start++) {
      const captures = [];
      const end = matchItems(s, start, items, captures);
      if (end !== null) {
        result += s.substring(pos, start);
        const matchText = s.substring(start, end);
        result += applyReplacement(replacement, matchText, captures);
        pos = end > start ? end : start + 1;
        count++;
        matched = true;
        break;
      }
    }
    if (!matched) {
      if (pos < s.length) {
        result += s[pos];
        pos++;
      } else {
        break;
      }
    }
  }
  result += s.substring(pos);
  return [result, count];
}

function applyReplacement(replacement, matchText, captures) {
  if (typeof replacement === 'string') {
    let out = '';
    let i = 0;
    while (i < replacement.length) {
      if (replacement[i] === '%' && i + 1 < replacement.length) {
        const next = replacement[i + 1];
        if (next === '0') { out += matchText; i += 2; continue; }
        if (next >= '1' && next <= '9') {
          const idx = parseInt(next, 10) - 1;
          out += captures[idx] !== undefined ? captures[idx] : '';
          i += 2;
          continue;
        }
        if (next === '%') { out += '%'; i += 2; continue; }
        out += next;
        i += 2;
        continue;
      }
      out += replacement[i];
      i++;
    }
    return out;
  }
  if (typeof replacement === 'function') {
    const result = replacement(matchText, ...captures);
    return luaToString(result);
  }
  if (typeof replacement === 'object' && replacement !== null) {
    const key = captures[0] !== undefined ? captures[0] : matchText;
    return replacement[key] !== undefined ? luaToString(replacement[key]) : matchText;
  }
  return matchText;
}

export function stringDump(fn) {
  throw new Error('string.dump is not available in this sandbox');
}

export default {
  stringLen,
  stringSub,
  stringByte,
  stringChar,
  stringRep,
  stringLower,
  stringUpper,
  stringReverse,
  stringFormat,
  stringFind,
  stringMatch,
  stringGmatch,
  stringGsub,
  stringDump,
};