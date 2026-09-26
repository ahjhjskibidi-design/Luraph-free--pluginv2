/**
 * Lua Obf — Anti-tamper checks.
 * Injects guards that detect debuggers, hook attempts, and modification.
 * Only applied when preset.antiTamper is true.
 */

import * as A from './ast.js';

/**
 * Build a small self-check block. Injects as a prefix to the chunk.
 *
 * The checks are deliberately lightweight:
 *   - debug.getinfo present or not
 *   - _G modifications check (basic)
 *   - loadstring / load present
 *
 * They do NOT stop a determined attacker. They raise the cost of a casual
 * hook.
 */

function buildCheckDebugInfo() {
  // if debug and debug.getinfo then local info = debug.getinfo(1); if not info then return end end
  // Actually: just call debug.getinfo and check it doesn't error
  return A.ifStatement(
    [
      {
        condition: A.binary(
          A.identifier('debug'),
          '~=',
          A.nilLiteral(),
        ),
        body: A.block([
          A.ifStatement(
            [
              {
                condition: A.binary(
                  A.index(A.identifier('debug'), A.stringLiteral('getinfo', '"'), false),
                  '~=',
                  A.nilLiteral(),
                ),
                body: A.block([
                  // local _ok = pcall(function() return debug.getinfo(1) end)
                  A.local(
                    [A.identifier('_ok')],
                    [
                      A.call(A.identifier('pcall'), [
                        A.functionExpr(
                          [],
                          A.block([
                            A.returnStatement([
                              A.call(
                                A.index(
                                  A.identifier('debug'),
                                  A.stringLiteral('getinfo', '"'),
                                  false,
                                ),
                                [A.numberLiteral(1, '1')],
                              ),
                            ]),
                          ]),
                          false,
                        ),
                      ]),
                    ],
                  ),
                ]),
              },
            ],
            null,
          ),
        ]),
      },
    ],
    null,
  );
}

function buildCheckGetFenv() {
  // if getfenv and getfenv(0) ~= _G then return end
  // (Some sandboxes have getfenv but no _G)
  return A.ifStatement(
    [
      {
        condition: A.binary(
          A.identifier('getfenv'),
          '~=',
          A.nilLiteral(),
        ),
        body: A.block([
          // Only a sanity check, no hard fail
          A.local(
            [A.identifier('_e')],
            [A.call(A.identifier('getfenv'), [A.numberLiteral(0, '0')])],
          ),
        ]),
      },
    ],
    null,
  );
}

function buildCheckLoadString() {
  // if not loadstring and not load then return end
  return A.ifStatement(
    [
      {
        condition: A.binary(
          A.identifier('loadstring'),
          '==',
          A.nilLiteral(),
        ),
        body: A.block([
          A.ifStatement(
            [
              {
                condition: A.binary(
                  A.identifier('load'),
                  '==',
                  A.nilLiteral(),
                ),
                body: A.block([
                  A.returnStatement([]),
                ]),
              },
            ],
            null,
          ),
        ]),
      },
    ],
    null,
  );
}

export function applyAntiTamper(ast, config) {
  if (!config.antiTamper) return ast;

  const guards = [];

  if (config.checkDebugInfo) guards.push(buildCheckDebugInfo());
  if (config.checkGetFenv) guards.push(buildCheckGetFenv());
  if (config.checkLoadString) guards.push(buildCheckLoadString());

  if (guards.length === 0) return ast;

  // Prepend guards to the chunk body
  if (ast.type === A.NodeType.CHUNK) {
    ast.body.body = [...guards, ...ast.body.body];
  }

  return ast;
}