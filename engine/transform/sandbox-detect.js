/**
 * Sandbox Detection — phát hiện môi trường bị kiểm soát.
 *
 * Kỹ thuật #18: Environment/Sandbox Detection.
 *
 * Khi attacker chạy script trong sandbox (emulator, debugger, hook
 * tool như Synapse/KRNL), môi trường có những dấu hiệu khác biệt:
 *
 *   1. Roblox globals không tồn tại (game, workspace)
 *   2. UserInputService/Players không đúng type
 *   3. Environment có thêm biến lạ (getgenv, getrenv, hookfunction)
 *   4. Metatable của string/number bị thay
 *   5. Coroutine hoạt động khác
 *   6. Debug library tồn tại (Roblox thật không cho userland)
 *   7. os.time khác biệt (thời gian emulator)
 *   8. Network access bị chặn
 *
 * Detection methods:
 *   - Check globals tồn tại
 *   - Check typeof / type
 *   - Check version signature
 *   - Check CPU time vs wall time
 *   - Check memory usage (không có trong Lua 5.1)
 *   - Check error message format
 *   - Check thread identity (không có trong Lua 5.1)
 *
 * Khi phát hiện → có thể:
 *   - Thoát ngay (return)
 *   - Chạy code giả
 *   - Gửi báo cáo
 *   - Corrupt state (nguy hiểm)
 */

import { NodeType } from '../parser/types.js';
import * as A from '../parser/ast.js';

// ============================================================
// Detection guards
// ============================================================

/**
 * Guard 1: Kiểm tra Roblox-specific globals tồn tại.
 * Trong Roblox thật, `game` và `workspace` luôn tồn tại.
 */
function detectRobloxMissing() {
  // if not game or not workspace then return end
  return A.ifStatement(
    [
      {
        condition: A.binaryExpression(
          A.binaryExpression(
            A.identifier('game'),
            '==',
            A.nilLiteral(),
          ),
          'or',
          A.binaryExpression(
            A.identifier('workspace'),
            '==',
            A.nilLiteral(),
          ),
        ),
        body: A.block([A.returnStatement([])]),
      },
    ],
    null,
  );
}

/**
 * Guard 2: Kiểm tra các biến của exploit tool.
 * Synapse, KRNL, ScriptWare đều có `getgenv`, `getrenv`, ...
 */
function detectExploitGlobals() {
  // if getgenv or getrenv or hookfunction then return end
  return A.ifStatement(
    [
      {
        condition: A.binaryExpression(
          A.binaryExpression(
            A.identifier('getgenv'),
            '~=',
            A.nilLiteral(),
          ),
          'or',
          A.binaryExpression(
            A.identifier('getrenv'),
            '~=',
            A.nilLiteral(),
          ),
        ),
        body: A.block([A.returnStatement([])]),
      },
    ],
    null,
  );
}

/**
 * Guard 3: Kiểm tra `type(game)` phải là "userdata" trong Roblox thật.
 */
function detectGameType() {
  // if type(game) ~= "userdata" and type(game) ~= "table" then return end
  // Trong Roblox game là userdata. Trong emulator có thể là table.
  return A.ifStatement(
    [
      {
        condition: A.binaryExpression(
          A.callExpression(A.identifier('type'), [A.identifier('game')]),
          '==',
          A.stringLiteral('nil'),
        ),
        body: A.block([A.returnStatement([])]),
      },
    ],
    null,
  );
}

/**
 * Guard 4: Kiểm tra `_G` không bị thay thế.
 */
function detectGReplaced() {
  // if type(_G) ~= "table" then return end
  // if type(_G.print) ~= "function" then return end
  return A.block([
    A.ifStatement(
      [
        {
          condition: A.binaryExpression(
            A.callExpression(A.identifier('type'), [A.identifier('_G')]),
            '~=',
            A.stringLiteral('table'),
          ),
          body: A.block([A.returnStatement([])]),
        },
      ],
      null,
    ),
    A.ifStatement(
      [
        {
          condition: A.binaryExpression(
            A.callExpression(A.identifier('type'), [
              A.indexExpression(A.identifier('_G'), A.stringLiteral('print'), false),
            ]),
            '~=',
            A.stringLiteral('function'),
          ),
          body: A.block([A.returnStatement([])]),
        },
      ],
      null,
    ),
  ]);
}

/**
 * Guard 5: Kiểm tra metatable của string không bị thay.
 */
function detectStringMetatable() {
  // if getmetatable("") and getmetatable("").__index ~= string then return end
  return A.ifStatement(
    [
      {
        condition: A.binaryExpression(
          A.callExpression(
            A.identifier('getmetatable'),
            [A.stringLiteral('')],
          ),
          '~=',
          A.nilLiteral(),
        ),
        body: A.block([
          A.ifStatement(
            [
              {
                condition: A.binaryExpression(
                  A.indexExpression(
                    A.callExpression(
                      A.identifier('getmetatable'),
                      [A.stringLiteral('')],
                    ),
                    A.stringLiteral('__index'),
                    false,
                  ),
                  '~=',
                  A.identifier('string'),
                ),
                body: A.block([A.returnStatement([])]),
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

/**
 * Guard 6: Kiểm tra có `debug` library (Roblox thật chặn).
 * Nếu có → đang chạy trong Studio hoặc emulator.
 */
function detectDebugAccess() {
  // if debug and debug.getinfo and debug.getinfo(1) then return end
  return A.ifStatement(
    [
      {
        condition: A.binaryExpression(
          A.identifier('debug'),
          '~=',
          A.nilLiteral(),
        ),
        body: A.block([
          A.ifStatement(
            [
              {
                condition: A.binaryExpression(
                  A.indexExpression(
                    A.identifier('debug'),
                    A.stringLiteral('getinfo'),
                    false,
                  ),
                  '~=',
                  A.nilLiteral(),
                ),
                body: A.block([
                  A.ifStatement(
                    [
                      {
                        condition: A.callExpression(
                          A.indexExpression(
                            A.identifier('debug'),
                            A.stringLiteral('getinfo'),
                            false,
                          ),
                          [A.numberLiteral(1)],
                        ),
                        body: A.block([A.returnStatement([])]),
                      },
                    ],
                    null,
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

/**
 * Guard 7: Kiểm tra os.time difference.
 * Nếu os.time() chênh lệch quá nhiều so với expected → emulator.
 */
function detectTimeAnomaly(varPrefix) {
  const v1 = varPrefix + '_t';

  return A.block([
    A.localStatement(
      [A.identifier(v1)],
      [A.callExpression(
        A.indexExpression(A.identifier('os'), A.stringLiteral('time'), false),
        [],
      )],
    ),
    // Kiểm tra giá trị hợp lệ (2020-2030 epoch seconds)
    A.ifStatement(
      [
        {
          condition: A.binaryExpression(
            A.identifier(v1),
            '<',
            A.numberLiteral(1577836800), // 2020-01-01
          ),
          body: A.block([A.returnStatement([])]),
        },
      ],
      null,
    ),
    A.ifStatement(
      [
        {
          condition: A.binaryExpression(
            A.identifier(v1),
            '>',
            A.numberLiteral(1893456000), // 2030-01-01
          ),
          body: A.block([A.returnStatement([])]),
        },
      ],
      null,
    ),
  ]);
}

/**
 * Guard 8: Kiểm tra `require` không bị hook.
 */
function detectRequireHook() {
  // if require ~= nil and type(require) ~= "function" then return end
  return A.ifStatement(
    [
      {
        condition: A.binaryExpression(
          A.identifier('require'),
          '~=',
          A.nilLiteral(),
        ),
        body: A.block([
          A.ifStatement(
            [
              {
                condition: A.binaryExpression(
                  A.callExpression(A.identifier('type'), [A.identifier('require')]),
                  '~=',
                  A.stringLiteral('function'),
                ),
                body: A.block([A.returnStatement([])]),
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

// ============================================================
// Guard pool
// ============================================================

const DETECTORS = [
  { fn: detectRobloxMissing, weight: 4 },
  { fn: detectExploitGlobals, weight: 5 },
  { fn: detectGameType, weight: 3 },
  { fn: detectGReplaced, weight: 4 },
  { fn: detectStringMetatable, weight: 3 },
  { fn: detectDebugAccess, weight: 5 },
  { fn: detectTimeAnomaly, weight: 2 },
  { fn: detectRequireHook, weight: 3 },
];

// ============================================================
// Injector
// ============================================================

export class SandboxDetector {
  constructor(options) {
    options = options || {};
    this.seed = options.seed || (Date.now() ^ (Math.random() * 0x7fffffff));
    this.ratio = options.ratio !== undefined ? options.ratio : 0.6;
    this.state = (this.seed >>> 0) || 1;
    this.counter = 0;
  }

  nextInt(max) {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state % max;
  }

  randomDetector(prefix) {
    const total = DETECTORS.reduce((s, d) => s + d.weight, 0);
    let pick = this.nextInt(total);
    for (const d of DETECTORS) {
      pick -= d.weight;
      if (pick < 0) return d.fn(prefix);
    }
    return DETECTORS[0].fn(prefix);
  }

  inject(ast) {
    this.visit(ast);
    return ast;
  }

  visit(node) {
    if (!node || typeof node !== 'object') return;

    for (const key of Object.keys(node)) {
      const value = node[key];
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === 'object' && item.type) {
            this.visit(item);
          }
        }
      } else if (value && typeof value === 'object' && value.type) {
        this.visit(value);
      }
    }

    // Chèn detector vào function bodies
    if (node.type === NodeType.FUNC_EXPR ||
        node.type === NodeType.FUNC_DECL ||
        node.type === NodeType.LOCAL_FUNC) {
      this.counter++;
      if ((this.counter % 100) / 100 > this.ratio) return;

      const prefix = '_sd' + this.counter.toString(36);
      const detector = this.randomDetector(prefix);

      node.body.body = [detector, ...node.body.body];
    }
  }
}

// ============================================================
// Entry
// ============================================================

export function injectSandboxDetection(ast, options) {
  const detector = new SandboxDetector(options);
  return detector.inject(ast);
}

export default {
  injectSandboxDetection,
  SandboxDetector,
};