/**
 * Dead Code Injector — chèn code không bao giờ chạy.
 *
 * Kỹ thuật #5: Dead Code Injection.
 *
 * Khác với opaque predicates (điều kiện luôn đúng/sai), dead code
 * là các statement không bao giờ được reach:
 *
 *   1. Code sau `return` không bao giờ chạy
 *   2. Code trong `if false then ... end`
 *   3. Code trong `while false do ... end`
 *   4. Code trong `for i = 1, 0 do ... end` (loop rỗng)
 *   5. Code sau `error()` hoặc `os.exit()`
 *   6. Code trong nhánh của opaque-false
 *
 * Dead code làm tăng kích thước, gây nhiễu khi đọc, và làm
 * deobfuscator tự động không thể phân tích tĩnh.
 *
 * Chiến lược:
 *   - Chèn đoạn code phức tạp vào vị trí khó nhận biết
 *   - Mỗi đoạn dead code chứa arithmetic, gọi hàm, table ops
 *   - Đảm bảo dead code không gây side effect
 *   - Trông giống code thật
 */

import { NodeType } from '../parser/types.js';
import * as A from '../parser/ast.js';

// ============================================================
// Dead code templates
// ============================================================

/**
 * Các mẫu code chết. Mỗi mẫu là một hàm nhận seed và trả về statement.
 */

function deadArithmetic(seed) {
  const a = Math.floor(Math.random() * 10000);
  const b = Math.floor(Math.random() * 10000);
  const c = Math.floor(Math.random() * 10000);
  return A.localStatement(
    [A.identifier('_a' + (seed % 1000))],
    [
      A.binaryExpression(
        A.binaryExpression(A.numberLiteral(a), '+', A.numberLiteral(b)),
        '*',
        A.numberLiteral(c),
      ),
    ],
  );
}

function deadTableOp(seed) {
  return A.localStatement(
    [A.identifier('_t' + (seed % 1000))],
    [
      A.tableConstructor([
        { type: NodeType.FIELD_ARRAY, value: A.numberLiteral(Math.floor(Math.random() * 100)) },
        { type: NodeType.FIELD_ARRAY, value: A.numberLiteral(Math.floor(Math.random() * 100)) },
        { type: NodeType.FIELD_ARRAY, value: A.numberLiteral(Math.floor(Math.random() * 100)) },
      ]),
    ],
  );
}

function deadStringConcat(seed) {
  const words = ['foo', 'bar', 'baz', 'qux', 'lorem', 'ipsum'];
  const w1 = words[Math.floor(Math.random() * words.length)];
  const w2 = words[Math.floor(Math.random() * words.length)];
  return A.localStatement(
    [A.identifier('_s' + (seed % 1000))],
    [
      A.binaryExpression(
        A.binaryExpression(A.stringLiteral(w1), '..', A.stringLiteral('_')),
        '..',
        A.stringLiteral(w2),
      ),
    ],
  );
}

function deadFunction(seed) {
  const name = '_f' + (seed % 1000);
  const body = A.block([
    A.returnStatement([
      A.binaryExpression(
        A.numberLiteral(Math.floor(Math.random() * 100)),
        '+',
        A.numberLiteral(Math.floor(Math.random() * 100)),
      ),
    ]),
  ]);
  return A.localStatement(
    [A.identifier(name)],
    [A.functionExpression([], body, false)],
  );
}

function deadLoop(seed) {
  // for i = 1, 0 do ... end — không chạy
  const body = A.block([
    A.localStatement(
      [A.identifier('_x')],
      [A.numberLiteral(Math.floor(Math.random() * 100))],
    ),
  ]);
  return A.numericFor(
    A.identifier('_i' + (seed % 1000)),
    A.numberLiteral(1),
    A.numberLiteral(0),
    null,
    body,
  );
}

function deadIfFalse(seed) {
  const body = A.block([
    A.callStatement(
      A.callExpression(
        A.identifier('print'),
        [A.stringLiteral('dead')],
      ),
    ),
  ]);
  return A.ifStatement(
    [{ condition: A.boolLiteral(false), body }],
    null,
  );
}

// ============================================================
// Template pool
// ============================================================

const TEMPLATES = [
  { fn: deadArithmetic, weight: 4 },
  { fn: deadTableOp, weight: 3 },
  { fn: deadStringConcat, weight: 3 },
  { fn: deadFunction, weight: 2 },
  { fn: deadLoop, weight: 1 },
  { fn: deadIfFalse, weight: 1 },
];

function pickTemplate(seed) {
  const total = TEMPLATES.reduce((s, t) => s + t.weight, 0);
  let r = seed % total;
  for (const t of TEMPLATES) {
    r -= t.weight;
    if (r < 0) return t.fn;
  }
  return TEMPLATES[0].fn;
}

// ============================================================
// Injector
// ============================================================

export class DeadCodeInjector {
  constructor(options) {
    options = options || {};
    this.ratio = options.ratio !== undefined ? options.ratio : 0.3; // 30% block thêm dead code
    this.perBlock = options.perBlock || 2; // thêm 1-3 statement mỗi block
    this.seed = options.seed || (Date.now() ^ (Math.random() * 0x7fffffff));
    this.counter = 0;
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

    if (node.type === NodeType.BLOCK) {
      this.injectIntoBlock(node);
    }
  }

  injectIntoBlock(block) {
    const body = block.body || [];
    if (body.length === 0) return;

    // Đôi khi không inject
    this.counter++;
    if ((this.counter % 100) / 100 > this.ratio) return;

    const count = 1 + Math.floor(Math.random() * this.perBlock);
    const newBody = [];

    for (let i = 0; i < body.length; i++) {
      newBody.push(body[i]);

      // Đôi khi chèn dead code sau statement này
      if (Math.random() < 0.5 && newBody.filter(s => s.dead).length < count) {
        const template = pickTemplate(this.seed + this.counter + i);
        const dead = template(this.seed + this.counter + i);
        dead.dead = true;
        newBody.push(dead);
      }
    }

    // Nếu chưa đủ số lượng, chèn thêm ở cuối
    const deadCount = newBody.filter(s => s.dead).length;
    for (let i = deadCount; i < count; i++) {
      const template = pickTemplate(this.seed + this.counter + i);
      const dead = template(this.seed + this.counter + i + 1000);
      dead.dead = true;
      newBody.push(dead);
    }

    block.body = newBody;
  }
}

// ============================================================
// Entry
// ============================================================

export function injectDeadCode(ast, options) {
  const injector = new DeadCodeInjector(options);
  return injector.inject(ast);
}

export default { injectDeadCode, DeadCodeInjector };