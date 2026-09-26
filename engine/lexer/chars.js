/**
 * Character class helpers.
 *
 * Lua 5.1 has a very small character vocabulary for its identifiers:
 * ASCII letters, digits, and underscore. Everything else is either
 * whitespace, an operator, or a string delimiter.
 */

/**
 * True if the character is a decimal digit (0-9).
 */
export function isDigit(c) {
  return c >= '0' && c <= '9';
}

/**
 * True if the character is a hex digit (0-9, a-f, A-F).
 * Used when parsing `0x` numeric literals and \x escapes.
 */
export function isHexDigit(c) {
  return (
    (c >= '0' && c <= '9') ||
    (c >= 'a' && c <= 'f') ||
    (c >= 'A' && c <= 'F')
  );
}

/**
 * True if the character can start a Lua identifier.
 * Lua identifiers must begin with a letter or underscore.
 */
export function isNameStart(c) {
  if (!c) return false;
  const code = c.charCodeAt(0);
  return (
    (code >= 65 && code <= 90) ||   // A-Z
    (code >= 97 && code <= 122) ||  // a-z
    c === '_'
  );
}

/**
 * True if the character can continue a Lua identifier.
 * Digits are allowed after the first character.
 */
export function isNameChar(c) {
  return isNameStart(c) || isDigit(c);
}

/**
 * True if the character is horizontal whitespace.
 * Newline is handled separately because it increments the line counter.
 */
export function isHorizontalWhitespace(c) {
  return c === ' ' || c === '\t' || c === '\r';
}

export default { isDigit, isHexDigit, isNameStart, isNameChar, isHorizontalWhitespace };