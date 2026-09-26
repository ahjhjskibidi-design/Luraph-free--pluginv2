/**
 * Flatten — main entry point.
 *
 * Usage:
 *   import { flatten } from './engine/flatten/index.js';
 *   const newAst = flatten(ast, { stateVarPrefix: '_sm' });
 *
 * Walks the AST and replaces every block that is safe to flatten
 * with a state machine.
 */

import { NODE } from '../parser/types.js';
import { isSafeToFlatten } from './safe.js';
import { buildStateMachine } from './state-machine.js';

let counter = 0;

function makeStateVar(prefix) {
  counter++;
  return prefix + counter.toString(36);
}

/**
 * Recursively walk the AST and flatten every safe block.
 */
export function flatten(node, options) {
  if (!node || typeof node !== 'object') return node;

  options = options || {};
  const prefix = options.stateVarPrefix || '_sm';

  // Recurse into children first (bottom-up)
  for (const key of Object.keys(node)) {
    if (key === 'type') continue;
    const value = node[key];
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        value[i] = flatten(value[i], options);
      }
    } else if (value && typeof value === 'object' && value.type) {
      node[key] = flatten(value, options);
    }
  }

  // Now handle this node
  if (node.type === NODE.BLOCK) {
    return maybeFlattenBlock(node, prefix);
  }

  return node;
}

/**
 * Decide whether to flatten a block, and do it if safe.
 * Also handles nested blocks inside control structures.
 */
function maybeFlattenBlock(block, prefix) {
  // Do not flatten the top-level chunk of a function body if it has
  // only a couple of statements — small blocks don't gain much.
  if (!isSafeToFlatten(block)) return block;

  const stateVar = makeStateVar(prefix);
  return buildStateMachine(block, stateVar);
}

export default { flatten };