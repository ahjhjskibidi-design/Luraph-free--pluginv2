/**
 * Environment integrity checks.
 *
 * Compares key values against expected baselines. If anything has been
 * swapped (a common attack), we detect the mismatch.
 *
 * The baselines are computed at obfuscation time on the machine that
 * built the script — but they must match what Roblox provides. Since
 * the obfuscator runs on the developer's machine, we cannot know
 * Roblox's exact values. So the baselines are structural: we check
 * for property presence, not exact values.
 */

import * as A from '../parser/ast.js';

/**
 * Guard: verify the shape of the environment.
 * Asserts a list of names are present and are the expected type.
 */
export function environmentShapeGuard() {
  // if type(print) ~= "function" then return end
  // if type(string) ~= "table" then return end
  // if type(string.char) ~= "function" then return end
  // if type(table.concat) ~= "function" then return end

  const checks = [
    ['print', 'function'],
    ['string', 'table'],
    ['table', 'table'],
    ['math', 'table'],
    ['pairs', 'function'],
    ['ipairs', 'function'],
    ['type', 'function'],
    ['pcall', 'function'],
  ];

  const guardStatements = checks.map(([name, expected]) => {
    return A.ifStatement(
      [{
        condition: A.binaryExpression(
          A.callExpression(A.identifier('type'), [A.identifier(name)]),
          '~=',
          A.stringLiteral(expected),
        ),
        body: A.block([A.returnStatement([])]),
      }],
      null,
    );
  });

  return A.block(guardStatements);
}

/**
 * Guard: `string.char` and `string.sub` behave as expected.
 * A hooked string library can silently corrupt our decoded strings.
 */
export function stringLibraryGuard() {
  // if string.char(72, 105) ~= "Hi" then return end
  // if string.sub("Hello", 2, 3) ~= "el" then return end
  return A.block([
    A.ifStatement(
      [{
        condition: A.binaryExpression(
          A.callExpression(
            A.indexExpression(A.identifier('string'), A.stringLiteral('char'), false),
            [A.numberLiteral(72), A.numberLiteral(105)],
          ),
          '~=',
          A.stringLiteral('Hi'),
        ),
        body: A.block([A.returnStatement([])]),
      }],
      null,
    ),
    A.ifStatement(
      [{
        condition: A.binaryExpression(
          A.callExpression(
            A.indexExpression(A.identifier('string'), A.stringLiteral('sub'), false),
            [A.stringLiteral('Hello'), A.numberLiteral(2), A.numberLiteral(3)],
          ),
          '~=',
          A.stringLiteral('el'),
        ),
        body: A.block([A.returnStatement([])]),
      }],
      null,
    ),
  ]);
}

export default {
  environmentShapeGuard,
  stringLibraryGuard,
};