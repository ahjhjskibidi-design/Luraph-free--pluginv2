/**
 * Timing-based anti-trace.
 *
 * Debuggers slow code down. If a small computation takes far longer
 * than it should, someone is likely tracing.
 *
 * This is not reliable. On slow Roblox servers, legitimate scripts
 * may exceed the threshold. The threshold must be generous.
 *
 * Because Roblox does not expose a high-resolution wall clock in
 * all contexts, we use `tick()` (seconds since some epoch) which has
 * enough resolution for a 100ms threshold.
 */

import * as A from '../parser/ast.js';

/**
 * Guard: measure the time of a trivial loop. If it exceeds a bound,
 * assume tracing.
 *
 *   local _t0 = tick()
 *   local _n = 0
 *   for _i = 1, 1000 do _n = _n + 1 end
 *   local _dt = tick() - _t0
 *   if _dt > 0.5 then return end
 */
export function timingGuard() {
  return A.block([
    A.localStatement(
      [A.identifier('_t0')],
      [A.callExpression(A.identifier('tick'), [])],
    ),
    A.localStatement(
      [A.identifier('_n')],
      [A.numberLiteral(0)],
    ),
    A.numericFor(
      A.identifier('_i'),
      A.numberLiteral(1),
      A.numberLiteral(1000),
      null,
      A.block([
        A.assignStatement(
          [A.identifier('_n')],
          [A.binaryExpression(A.identifier('_n'), '+', A.numberLiteral(1))],
        ),
      ]),
    ),
    A.localStatement(
      [A.identifier('_dt')],
      [
        A.binaryExpression(
          A.callExpression(A.identifier('tick'), []),
          '-',
          A.identifier('_t0'),
        ),
      ],
    ),
    A.ifStatement(
      [{
        condition: A.binaryExpression(
          A.identifier('_dt'),
          '>',
          A.numberLiteral(0.5),
        ),
        body: A.block([A.returnStatement([])]),
      }],
      null,
    ),
  ]);
}

export default { timingGuard };