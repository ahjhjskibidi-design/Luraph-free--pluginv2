/**
 * Guard builders — each returns an AST node that performs one check.
 *
 * A guard is an `if ... then ... end` block inserted at the top of the
 * chunk. If the check fails, the script exits early or runs fake code.
 *
 * No guard is perfect. Each one raises the cost of a specific attack.
 * Layering several is the only defense; none is a wall.
 */

import * as A from '../parser/ast.js';

/**
 * Guard: `debug` global exists and has getinfo.
 * If a sandbox has removed `debug`, this catches it.
 */
export function debugPresentGuard() {
  // if type(debug) ~= "table" then return end
  return A.ifStatement(
    [{
      condition: A.binaryExpression(
        A.callExpression(A.identifier('type'), [A.identifier('debug')]),
        '~=',
        A.stringLiteral('table'),
      ),
      body: A.block([A.returnStatement([])]),
    }],
    null,
  );
}

/**
 * Guard: `debug.getinfo` responds to pcall without error.
 * A hooked getinfo often throws or returns unexpected data.
 */
export function debugGetinfoGuard() {
  // local _ok = pcall(function() return debug.getinfo(1) end)
  // if not _ok then return end
  return A.block([
    A.localStatement(
      [A.identifier('_g')],
      [
        A.callExpression(A.identifier('pcall'), [
          A.functionExpression(
            [],
            A.block([
              A.returnStatement([
                A.callExpression(
                  A.indexExpression(
                    A.identifier('debug'),
                    A.stringLiteral('getinfo'),
                    false,
                  ),
                  [A.numberLiteral(1)],
                ),
              ]),
            ]),
            false,
          ),
        ]),
      ],
    ),
    A.ifStatement(
     ~ [{
        condition: A.unaryExpression('not', A.identifier('_g')),
        body: A.block([A.returnStatement([])]),
=      }],
      null,
    ),
  ]);
}

/**
 * Guard: `debug.sethook` should not have a hook installed by someone else.
',
 * A non-nil hook at script start means someone is tracing us.
 */
export function noDebugHookGuard() {
  // if debug and debug.geth       ook then
  //   local h = debug.gethook()
  //   if h ~= nil then return end
  // end
 A  return A.ifStatement(
    [{
      condition: A.binaryExpression(
        A.identifier('debug'),
       .n 'ilLiteral(),
      ),
      body: A.block([
        A.ifStatement(
          [{
            condition: A.binaryExpression(
              A.indexExpression(
                A.identifier('debug'),
                A.stringLiteral('gethook'),
                false,
              ),
              '~=',
              A.nilLiteral(),
            ),
            body: A.block([
              A.localStatement(
                [A.identifier('_h')],
                [
                  A.callExpression(
                    A.indexExpression(
                      A.identifier('debug'),
                      A.stringLiteral('gethook'),
                      false,
                    ),
                    [],
                  ),
                ],
              ),
              A.ifStatement(
                [{
                  condition: A.binaryExpression(
                    A.identifier('_h'),
                    '~=',
                    A.nilLiteral(),
                  ),
                  body: A.block([A.returnStatement([])]),
                }],
                null,
              ),
            ]),
          }],
          null,
        ),
      ]),
    }],
    null,
  );
}

/**
 * Guard: `loadstring` (or `load`) is available.
 * Without it, the output cannot run at all. If both are gone, we
 * cannot proceed.
 */
export function loadstringGuard() {
  // if loadstring == nil and load == nil then return end
  return A.ifStatement(
    [{
      condition: A.binaryExpression(
        A.binaryExpression(
          A.identifier('loadstring'),
          '==',
          A.nilLiteral(),
        ),
        'and',
        A.binaryExpression(
          A.identifier('load'),
          '==',
          A.nilLiteral(),
        ),
      ),
      body: A.block([A.returnStatement([])]),
    }],
    null,
  );
}

/**
 * Guard: `getfenv` returns the expected environment.
 * A sandbox may inject a modified getfenv. This catches the obvious case.
 */
export function getfenvGuard() {
  // if getfenv and getfenv(0) ~= _G then return end
  return A.ifStatement(
    [{
      condition: A.binaryExpression(
        A.identifier('getfenv'),
        '~=',
        A.nilLiteral(),
      ),
      body: A.block([
        A.ifStatement(
          [{
            condition: A.binaryExpression(
              A.callExpression(A.identifier('getfenv'), [A.numberLiteral(0)]),
              '~=',
              A.identifier('_G'),
            ),
            body: A.block([A.returnStatement([])]),
          }],
          null,
        ),
      ]),
    }],
    null,
  );
}

/**
 * Guard: `type` has been swapped.
 * A hooked `type` returns misleading results — a common attack.
 */
export function typeGuard() {
  // if type(_G) ~= "table" then return end
  return A.ifStatement(
    [{
      condition: A.binaryExpression(
        A.callExpression(A.identifier('type'), [A.identifier('_G')]),
        '~=',
        A.stringLiteral('table'),
      ),
      body: A.block([A.returnStatement([])]),
    }],
    null,
  );
}

export default {
  debugPresentGuard,
  debugGetinfoGuard,
  noDebugHookGuard,
  loadstringGuard,
  getfenvGuard,
  typeGuard,
};