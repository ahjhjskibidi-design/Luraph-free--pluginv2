/**
 * Parenthesization rules for printing expressions.
 *
 * When printing a binary or unary expression, we need to know whether
 * a child expression must be wrapped in parentheses to preserve the
 * original tree structure.
 *
 * The rule: a child needs parens if the parent's precedence is higher
 * than the child's, or equal on the wrong side for associativity.
 */

import { NODE } from '../parser/types.js';
import { BINARY as BIN_PREC } from '../parser/precedence.js';

/**
 * Should the child be parenthesized when it appears under `parent`?
 * `side` is 'left' or 'right' for binary, 'operand' for unary.
 */
export function needsParens(child, parent, side) {
  if (!child || !parent) return false;

  // Unary child under binary: needs parens if the unary is `-` or `not`
  // and the parent is a tighter binary operator.
  if (child.type === NODE.UNARY && parent.type === NODE.BINARY) {
    return true;
  }

  // Binary child under binary
  if (child.type === NODE.BINARY && parent.type === NODE.BINARY) {
    const childPrec = BIN_PREC[child.operator];
    const parentPrec = BIN_PREC[parent.operator];
    if (!childPrec || !parentPrec) return false;

    const [cLeft, cRight] = childPrec;
    const [pLeft] = parentPrec;

    if (side === 'left') {
      // Right-assoc parent: child on left needs parens if equal precedence.
      // Left-assoc parent: child needs parens only if lower precedence.
      return cLeft < pLeft || (cLeft === pLeft && parent.operator === '..' || parent.operator === '^');
    }
    if (side === 'right') {
      return cRight <= pLeft;
    }
  }

  // Binary under unary
  if (child.type === NODE.BINARY && parent.type === NODE.UNARY) {
    return true;
  }

  // Under index / call / method: binary children need parens
  if (
    child.type === NODE.BINARY &&
    (parent.type === NODE.INDEX || parent.type === NODE.CALL || parent.type === NODE.METHOD_CALL)
  ) {
    return true;
  }

  return false;
}

/**
 * Is the operator right-associative?
 */
export function isRightAssoc(op) {
  return op === '..' || op === '^';
}

export default { needsParens, isRightAssoc };