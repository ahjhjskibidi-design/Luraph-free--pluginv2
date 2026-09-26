/**
 * Operator precedence for Lua 5.1 binary and unary operators.
 *
 * Each entry is [leftPrec, rightPrec]. Left and right are equal for
 * left-associative operators, differ for right-associative.
 *
 * Higher number = tighter binding.
 *   ^  is right-associative and highest:  10 left, 9 right
 *   * / %  bind tighter than + -
 *   .. is right-associative
 *   comparisons are non-associative in Lua, but we allow left-assoc here
 *   and / or  are the loosest
 *
 * Unary operators (not, -, #) bind tighter than any binary except ^.
 */

export const BINARY = {
  'or':  [1, 1],
  'and': [2, 2],
  '<':   [3, 3],
  '>':   [3, 3],
  '<=':  [3, 3],
  '>=':  [3, 3],
  '~=':  [3, 3],
  '==':  [3, 3],
  '..':  [5, 4],  // right-associative
  '+':   [6, 6],
  '-':   [6, 6],
  '*':   [7, 7],
  '/':   [7, 7],
  '%':   [7, 7],
  '^':   [10, 9], // right-associative
};

export const UNARY = {
  'not': 8,
  '-':   8,
  '#':   8,
};

export function isRightAssociative(op) {
  return op === '..' || op === '^';
}

export function getBinaryPrecedence(op) {
  return BINARY[op] || null;
}

export function getUnaryPrecedence(op) {
  return UNARY[op] || null;
}

export default {
  BINARY,
  UNARY,
  isRightAssociative,
  getBinaryPrecedence,
  getUnaryPrecedence,
};