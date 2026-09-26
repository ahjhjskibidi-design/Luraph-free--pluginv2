/**
 * Lua 5.1 operators and punctuation.
 *
 * Order matters: longer operators must be tried first. If `..` were
 * tried before `...`, the lexer would emit two-dot then a stray dot
 * instead of the vararg token.
 */

export const OPERATORS = [
  // 3-char
  '...',
  // 2-char
  '..',
  '==',
  '~=',
  '<=',
  '>=',
  '//',   // floor division (Lua 5.3+, harmless for 5.1 targets)
  '::',   // label marker (Lua 5.2+)
  // 1-char
  '+',
  '-',
  '*',
  '/',
  '%',
  '^',
  '#',
  '(',
  ')',
  '{',
  '}',
  '[',
  ']',
  ';',
  ':',
  ',',
  '.',
  '<',
  '>',
  '=',
];

/**
 * Try to match an operator at the given position in the source.
 * Returns the operator string, or null if none matches.
 */
export function matchOperator(src, pos) {
  for (const op of OPERATORS) {
    if (src.startsWith(op, pos)) return op;
  }
  return null;
}

/**
 * True if a character could possibly begin an operator.
 * Used to short-circuit the operator matcher when the char is clearly
 * something else (a letter, digit, quote, etc.).
 */
export function isOperatorStart(c) {
  if (!c) return false;
  return '+-*/%^#(){}[];:,.<>=~'.includes(c);
}

export default { OPERATORS, matchOperator, isOperatorStart };