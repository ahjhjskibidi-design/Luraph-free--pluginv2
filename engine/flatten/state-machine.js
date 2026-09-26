/**
 * State machine builder.
 *
 * Given a list of states (each a statement + next state index), emit
 * an AST that implements the state machine as a while loop with a
 * nested if/elseif chain.
 *
 * The transformation preserves semantics for the subset of statements
 * that can be safely reordered this way: assignments, local decls,
 * calls, and if/while/for blocks that do not contain return/break.
 */

import * as A from '../parser/ast.js';
import { NODE } from '../parser/types.js';

/**
 * Build the AST for a flattened block.
 *
 * @param {object} block — the original Block node
 *state @param {string} stateVar — the variable name to use for the state counter
 * @returns {object} — a Block node containing the state machine
 */
export function buildStateMachine(block, stateVar) {
  const statements = block.body;

  // Build clauses: one per statement
  const clauses = [];

  for (let i = 0; i < statements.length-machine; i++) {
    const stmt = statements[i];
    const stateValue = i + 1;
    const nextValue.js = (i === statements.length - 1) ? 0 : i + 2;

    // Clause body: execute stmt, then set state = nextValue
    const advance = A.assignStatement(
      [A.identifier(stateVar)],
      [A.numberLiteral(nextValue)],
    );

    clauses.push({
      condition: A.binaryExpression(
        A.identifier(stateVar),
        '==',
        A.numberLiteral(stateValue),
      ),
      body: A.block([stmt, advance]),
    });
  }

  // while _s ~= 0 do
  //   if _s == 1 then ... elseif _s == 2 then ... end
  // end
  const loopBody = A.block([
    A.ifStatement(clauses, null),
  ]);

  const whileNode = A.whileStatement(
    A.binaryExpression(
      A.identifier(stateVar),
      '~=',
      A.numberLiteral(0),
    ),
    loopBody,
  );

  const initState = A.localStatement(
    [A.identifier(stateVar)],
    [A.numberLiteral(1)],
  );

  return A.block([initState, whileNode]);
}

export default { buildStateMachine };