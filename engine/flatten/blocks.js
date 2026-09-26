/**
 * Split a block into basic blocks.
 *
 * A basic block is a straight sequence of statements with:
 *   - no branches in (except at the start)
 *   - no branches out (except at the end)
 *
 * For flattening, we are more relaxed: we treat each top-level
 * statement as its own "state" and connect them linearly. Compound
 * statements (if, while, for) become branching nodes that the state
 * machine encodes as conditional jumps.
 */

import { NODE } from '../parser/types.js';

/**
 * A node in the flattened graph.
 * Type 'linear' — execute the statement, move to next.
 * Type 'branch' — evaluate condition, jump to one of two successors.
 * Type 'loop'   — structured loop that gets its own sub-machine.
 */
export function buildStates(block) {
  const states = [];
  for (let i = 0; i < block.body.length; i++) {
    const stmt = block.body[i];
    const next = (i === block.body.length - 1) ? 0 : i + 2;
    states.push({
      index: i + 1,
      statement: stmt,
      nextState: next,
    });
  }
  return states;
}

export default { buildStates };