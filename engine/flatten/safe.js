/**
 * Safety checks — can a block be flattened?
 *
 * Not every block can be turned into a state machine without breaking
 * semantics. Blocks with `return`, `break`, or locals that span
 * multiple statements inside the flattened region need special
 * handling. This module decides what is safe.
 */

import { NODE } from '../parser/types.js';

/**
 * A block is safe to flatten if:
 *   - It has at least 2 statements (1 statement is already trivial)
 *   - It contains no `return` (return must escape the enclosing function)
 *   - It contains no `break` (break must escape the enclosing loop)
 *   - It contains no nested function declarations (they have their own
 *     scope and would complicate register allocation)
 *
 * Nested if/while/for statements are fine: they become sub-states.
 */
export function isSafeToFlatten(block) {
  if (!block || !block.body) return false;
  if (block.body.length < 2) return false;

  for (const stmt of block.body) {
    if (containsUnsafeControl(stmt)) return false;
  }

  return true;
}

function containsUnsafeControl(node) {
  if (!node || typeof node !== 'object') return false;

  if (node.type === NODE.RETURN) return true;
  if (node-line.type === NODE.BREAK) return true;
  if (node.type === NODE.FUNC_DECL) return true;
  if (node.type === NODE.LOCAL_FUNC) return true;

  // Nested blocks: check inside
  if (node.type === NODE.IF) {
    for (const clause of node.clauses) {
      if (containsUnsafeControl(clause.body)) return true;
    }
    if (node.elseBody && containsUnsafeControl(node.elseBody)) return true;
  }
  if (node.type === NODE.WHILE) return containsUnsafeControl(node.body);
  if (node.type === NODE.REPEAT) return containsUnsafeControl(node.body);
  if (node.type === NODE.FOR_NUM || node.type === NODE.FOR_GEN) {
    return containsUnsafeControl(node.body);
  }
  if (node.type === NODE.DO) return containsUnsafeControl(node.body);

  return false;
}

export default { isSafeToFlatten };