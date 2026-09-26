/**
 * Junk Code Insertion — chèn code vô nghĩa nhưng hợp lệ.
 *
 * Kỹ thuật #13: Junk Code Insertion.
 *
 * Khác với dead code (không bao giờ chạy), junk code CÓ CHẠY
 * nhưng kết quả bị bỏ. Mục đích:
 *   - Tăng kích thước file
 *   - Làm nhiễu khi đọc
 *   - Đánh lừa các heuristic của deobfuscator
 *   - Tăng cost symbolic execution
 *
 * Ví dụ junk code:
 *   local _x = math.random()   -- kết quả bỏ
 *   local _y = "abc" .. "def"   -- không dùng
 *   if math.random() > 2 then end   -- không bao giờ đúng
 *   local _z = {1, 2, 3}[1]   -- chỉ dùng làm biến tạm
 *   for _i = 1, 0 do end   -- vòng lặp rỗng
 *   local _w = _G   -- tham chiếu biến toàn cục không dùng
 *
 * Có 2 loại:
 *   1. Statement-level junk — chèn vào giữa các statement
 *   2. Expression-level junk — chèn vào biểu thức
 */

import { NodeType } from '../parser/types.js';
import * as A from '../parser/ast.js';

// ============================================================
// Junk statement generators
// ============================================================

class JunkGenerator {
  constructor(seed) {
    this.seed = seed || (Date.now() ^ (Math.random() * 0x7fffffff));
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

  nextName(prefix) {
    this.counter++;
    return (prefix || '_j') + this.counter.toString(36) + this.nextInt(1000).toString(36);
  }

  // ============================================================
  // Statement-level junk
  // ============================================================

  /**
   * local _x = math.random()
   */
  junkRandom() {
    return A.localStatement(
      [A.identifier(this.nextName('_r'))],
      [A.callExpression(
        A.indexExpression(A.identifier('math'), A.stringLiteral('random'), false),
        [],
      )],
    );
  }

  /**
   * local _x = "abc" .. "def" .. tostring(math.random())
   */
  junkConcat() {
    const parts = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    const x = parts[this.nextInt(parts.length)];
    const y = parts[this.nextInt(parts.length)];
    return A.localStatement(
      [A.identifier(this.nextName('_s'))],
      [
        A.binaryExpression(
          A.binaryExpression(A.stringLiteral(x), '..', A.stringLiteral(y)),
          '..',
          A.callExpression(A.identifier('tostring'), [
            A.callExpression(
              A.indexExpression(A.identifier('math'), A.stringLiteral('random'), false),
              [],
            ),
          ]),
        ),
      ],
    );
  }

  /**
   * local _x = {1, 2, 3, 4, 5}
   */
  junkTable() {
    const count = 3 + this.nextInt(5);
    const fields = [];
    for (let i = 0; i < count; i++) {
      fields.push({
        type: NodeType.FIELD_ARRAY,
        value: A.numberLiteral(this.nextInt(10000)),
      });
    }
    return A.localStatement(
      [A.identifier(this.nextName('_t'))],
      [A.tableConstructor(fields)],
    );
  }

  /**
   * for _i = 1, 0 do local _x = 1 end  -- vòng lặp rỗng
   */
  junkEmptyLoop() {
    return A.numericFor(
      A.identifier(this.nextName('_i')),
      A.numberLiteral(1),
      A.numberLiteral(0),
      null,
      A.block([
        A.localStatement(
          [A.identifier(this.nextName('_x'))],
          [A.numberLiteral(1)],
        ),
      ]),
    );
  }

  /**
   * if math.random() > 2 then ... end  -- không bao giờ đúng
   */
  junkImpossibleIf() {
    return A.ifStatement(
      [
        {
          condition: A.binaryExpression(
            A.callExpression(
              A.indexExpression(A.identifier('math'), A.stringLiteral('random'), false),
              [],
            ),
            '>',
            A.numberLiteral(2),
          ),
          body: A.block([
            A.callStatement(
              A.callExpression(A.identifier('print'), [
                A.stringLiteral('unreachable'),
              ]),
            ),
          ]),
        },
      ],
      null,
    );
  }

  /**
   * do local _x = 1 end
   */
  junkDoBlock() {
    return A.doStatement(A.block([
      A.localStatement(
        [A.identifier(this.nextName('_x'))],
        [A.numberLiteral(this.nextInt(100))],
      ),
    ]));
  }

  /**
   * local _f = function() return 42 end
   */
  junkFunction() {
    return A.localStatement(
      [A.identifier(this.nextName('_f'))],
      [A.functionExpression([], A.block([
        A.returnStatement([A.numberLiteral(this.nextInt(1000))]),
      ]), false)],
    );
  }

  /**
   * local _x = 1 + 2 * 3 - 4 / 5
   */
  junkArithmetic() {
    const a = this.nextInt(100);
    const b = this.nextInt(100);
    const c = this.nextInt(100);
    return A.localStatement(
      [A.identifier(this.nextName('_n'))],
      [
        A.binaryExpression(
          A.binaryExpression(A.numberLiteral(a), '+', A.numberLiteral(b)),
          '*',
          A.numberLiteral(c),
        ),
      ],
    );
  }

  /**
   * local _t = setmetatable({}, {})
   */
  junkSetmetatable() {
    return A.localStatement(
      [A.identifier(this.nextName('_m'))],
      [A.callExpression(A.identifier('setmetatable'), [
        A.tableConstructor([]),
        A.tableConstructor([]),
      ])],
    );
  }

  /**
   * Danh sách tất cả junk generators, mỗi cái có weight riêng.
   */
  getAllGenerators() {
    return [
      { weight: 4, gen: () => this.junkRandom() },
      { weight: 3, gen: () => this.junkArithmetic() },
      { weight: 3, gen: () => this.junkConcat() },
      { weight: 3, gen: () => this.junkTable() },
      { weight: 2, gen: () => this.junkDoBlock() },
      { weight: 2, gen: () => this.junkFunction() },
      { weight: 1, gen: () => this.junkEmptyLoop() },
      { weight: 1, gen: () => this.junkImpossibleIf() },
      { weight: 1, gen: () => this.junkSetmetatable() },
    ];
  }

  randomJunk() {
    const gens = this.getAllGenerators();
    const total = gens.reduce((s, g) => s + g.weight, 0);
    let pick = this.nextInt(total);
    for (const g of gens) {
      pick -= g.weight;
      if (pick < 0) return g.gen();
    }
    return this.junkRandom();
  }
}

// ============================================================
// Injector
// ============================================================

export class JunkCodeInjector {
  constructor(options) {
    options = options || {};
    this.ratio = options.ratio !== undefined ? options.ratio : 0.5;
    this.perBlock = options.perBlock || 3;
    this.generator = new JunkGenerator(options.seed);
  }

  inject(ast) {
    this.visit(ast);
    return ast;
  }

  visit(node) {
    if (!node || typeof node !== 'object') return;

    // Recurse first
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

    // Then inject into blocks
    if (node.type === NodeType.BLOCK) {
      this.injectIntoBlock(node);
    }
  }

  injectIntoBlock(block) {
    const body = block.body || [];
    if (body.length === 0) return;

    if (this.generator.nextInt(100) / 100 > this.ratio) return;

    const count = 1 + this.generator.nextInt(this.perBlock);
    const newBody = [];

    for (let i = 0; i < body.length; i++) {
      newBody.push(body[i]);

      // Đôi khi chèn junk giữa các statement
      if (this.generator.nextInt(100) / 100 < 0.3) {
        newBody.push(this.generator.randomJunk());
      }
    }

    // Chèn junk vào đầu và cuối block
    const headJunk = [];
    const tailJunk = [];

    const headCount = this.generator.nextInt(2);
    const tailCount = this.generator.nextInt(2);

    for (let i = 0; i < headCount; i++) {
      headJunk.push(this.generator.randomJunk());
    }
    for (let i = 0; i < tailCount; i++) {
      tailJunk.push(this.generator.randomJunk());
    }

    block.body = [...headJunk, ...newBody, ...tailJunk];
  }
}

// ============================================================
// Expression-level junk (advanced)
// ============================================================

/**
 * Chèn junk vào trong biểu thức.
 * Ví dụ: `a + b` → `(a + b) + (math.random() * 0)`
 */
export function injectExpressionJunk(ast, options) {
  options = options || {};
  const ratio = options.ratio !== undefined ? options.ratio : 0.3;
  const seed = options.seed || Date.now();
  let state = seed;

  function nextInt(max) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state = state >>> 0;
    return state % max;
  }

  function visit(node) {
    if (!node || typeof node !== 'object') return;

    for (const key of Object.keys(node)) {
      const value = node[key];
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          if (value[i] && typeof value[i] === 'object' && value[i].type) {
            value[i] = maybeJunk(value[i]);
            visit(value[i]);
          }
        }
      } else if (value && typeof value === 'object' && value.type) {
        node[key] = maybeJunk(value);
        visit(node[key]);
      }
    }
  }

  function maybeJunk(node) {
    if (!node || typeof node !== 'object') return node;
    if (nextInt(100) / 100 > ratio) return node;

    if (node.type === NodeType.BINARY) {
      // (a + b) + (random() * 0)
      const junk = A.binaryExpression(
        A.callExpression(
          A.indexExpression(A.identifier('math'), A.stringLiteral('random'), false),
          [],
        ),
        '*',
        A.numberLiteral(0),
      );
      return A.binaryExpression(node, '+', junk);
    }

    return node;
  }

  visit(ast);
  return ast;
}

// ============================================================
// Entry
// ============================================================

export function injectJunkCode(ast, options) {
  const injector = new JunkCodeInjector(options);
  return injector.inject(ast);
}

export default {
  injectJunkCode,
  injectExpressionJunk,
  JunkCodeInjector,
  JunkGenerator,
};