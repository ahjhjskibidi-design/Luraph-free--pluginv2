/**
 * Escape a JavaScript string into a Lua string literal.
 *
 * Chosen style: double-quoted, escapes only what is necessary.
 * Non-printable ASCII and control characters use decimal escapes
 * (\10, \13) because Lua 5.1 supports them.
 */

const PRINTABLE = /^[\x20-\x7e]*$/;

export function escapeLuaString(value) {
  let out = '"';
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    const code = value.charCodeAt(i);

    if (c === '"') { out += '\\"'; continue; }
    if (c === '\\') { out += '\\\\'; continue; }
    if (c === '\n') { out += '\\n'; continue; }
    if (c === '\r') { out += '\\r'; continue; }
    if (c === '\t') { out += '\\t'; continue; }

    // Control characters or non-ASCII
    if (code < 32 || code > 126) {
      out += '\\' + code;
      continue;
    }

    out += c;
  }
  out += '"';
  return out;
}

/**
 * Decide whether a string can be emitted as a plain literal or whether
 * it needs the long-bracket form to avoid excessive escaping.
 * Currently unused but reserved for future optimization.
 */
export function needsLongString(value) {
  return !PRINTABLE.test(value);
}

export default { escapeLuaString, needsLongString };