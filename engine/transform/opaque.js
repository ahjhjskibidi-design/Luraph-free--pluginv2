/**
 * Opaque Predicates — chèn điều kiện luôn đúng hoặc luôn sai.
 *
 * Kỹ thuật #6: Opaque Predicate Injection.
 *
 * Ý tưởng: một biểu thức điều kiện mà compile-time có thể xác định
 * là đúng, nhưng runtime có vẻ như phụ thuộc vào biến.
 *
 * Ví dụ:
 *   if (x * 0 + 1) == 1 then ... end          -- luôn đúng
 *   if (x - x) == 0 then ... end              -- luôn đúng
 *   if (x ^ 2) >= 0 then ... end              -- luôn đúng
 *   if (x * 0) == 1 then ... end              -- luôn sai
 *   if (x % x) == 1 then ... end              -- luôn sai (khi x != 0)
 *
 * Attacker phải chạy symbolic execution để biết condition luôn đúng
 * → nâng cost.
 *
 * Áp dụng:
 *   1. Wrap every if-statement with an opaque-true condition
 *   2. Insert fake if-statements that never run
 *   3. Hide jump targets behind opaque-false
 */

import { NodeType } from '../parser/types.js';
import * as A from '../parser/ast.js';

// ============================================================
// Opaque predicate generators
// ============================================================

/**
 * Danh sách các mẫu opaque-true.
 * Mỗi hàm nhận một tên biến (giả) và trả về một expression luôn true.
 */
const TRUE_PATTERNS = [
  (v) => A.binaryExpression(
    A.binaryExpression(
      A.binaryExpression(A.identifier(v), '*', A.numberLiteral(0)),
      '+',
      A.numberLiteral(1),
    ),
    '==',
    A.numberLiteral(1),
  ),
  (v) => A.binaryExpression(
    A.binaryExpression(A.identifier(v), '-', A.identifier(v)),
    '==',
    A.numberLiteral(0),
  ),
  (v) => A.binaryExpression(
    A.binaryExpression(A.identifier(v), '^', A.numberLiteral(2)),
    '>=',
    A.numberLiteral(0),
  ),
  (v) => A.binaryExpression(
    A.binaryExpression(A.identifier(v), 'or', A.numberLiteral(1)),
    '==',
    A.identifier(v),
  ), // chỉ đúng khi v không nil, nhưng v là số nên luôn đúng
  (v) => A.binaryExpression(
    A.binaryExpression(
      A.binaryExpression(A.identifier(v), 'or', A.numberLiteral(0)),
      '+',
      A.numberLiteral(1),
    ),
    '>',
    A.numberLiteral(0),
  ),
  (v) => A.binaryExpression(
    A.numberLiteral(1),
    '==',
    A.binaryExpression(
      A.binaryExpression(A.identifier(v), '/', A.identifier(v)),
      'or',
      A.numberLiteral(1),
    ),
  ),
  (v) => A.binaryExpression(
    A.binaryExpression(A.identifier(v), '*', A.numberLiteral(1)),
    '==',
    A.identifier(v),
  ),
  (v) => A.unaryExpression(
    'not',
    A.binaryExpression(
      A.identifier(v),
      '~=',
      A.identifier(v),
    ),
  ),
];

/**
 * Danh sách opaque-false.
 */
const FALSE_PATTERNS = [
  (v) => A.binaryExpression(
    A.binaryExpression(A.identifier(v), '*', A.numberLiteral(0)),
    '==',
    A.numberLiteral(1),
  ),
  (v) => A.binaryExpression(
    A.binaryExpression(A.identifier(v), '+', A.numberLiteral(1)),
    '<',
    A.identifier(v),
  ),
  (v) => A.binaryExpression(
    A.binaryExpression(A.identifier(v), '-', A.numberLiteral(1)),
    '>',
    A.identifier(v),
  ),
  (v) => A.binaryExpression(
    A.binaryExpression(A.identifier(v), '%', A.numberLiteral(2)),
    '>',
    A.numberLiteral(1),
  ),
];

// ============================================================
// Variable chooser
// ============================================================

/**
 * Chọn một biến "vô nghĩa" để dùng trong opaque predicate.
 * Ưu tiên biến đã được declare ở scope ngoài.
 */
class OpaqueGenerator {
  constructor(seed) {
    this.seed = seed || (Date.now() ^ (Math.random() * 0x7fffffff));
    this.counter = 0;
    this.varCounter = 0;
  }

  nextVar() {
    this.varCounter++;
    return '_o' + this.varCounter.toString(36);
  }

  makeTruePredicate() {
    this.counter++;
    const v = this.nextVar();
    const pattern = TRUE_PATTERNS[this.counter % TRUE_PATTERNS.length];
    return pattern(v);
  }

  makeFalsePredicate() {
    this.counter++;
    const v = this.nextVar();
    const pattern = FALSE_PATTERNS[this.counter % FALSE_PATTERNS.length];
    return pattern(v);
  }
}

// ============================================================
// Transformer
// ============================================================

export class OpaqueInjector {
  constructor(options) {
    options = options || {};
    this.ratio = options.ratio !== undefined ? options.ratio : 0.4; // 40% ifs wrapped
    this.insertFakeIfRatio = options.insertFakeIfRatio !== undefined ? options.insertFakeIfRatio : 0.15;
    this.generator = new OpaqueGenerator(options.seed);
  }

  inject(ast) {
    this.visit(ast);
    return ast;
  }

  visit(node) {
    if (!node || typeof node !== 'object') return;

    // Post-order: visit children first
    for (const key of Object.keys(node)) {
      const value = node[key];
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          if (value[i] && typeof value[i] === 'object' && value[i].type) {
            this.visit(value[i]);
          }
        }
      } else if (value && typeof value === 'object' && value.type) {
        this.visit(value);
      }
    }

    // Then handle this node
    if (node.type === NodeType.BLOCK) {
      this.processBlock(node);
    }

    if (node.type === NodeType.IF) {
      this.wrapIfCondition(node);
    }
  }

  /**
   * Wrap mỗi if-condition với một opaque-true AND.
   * condition → condition AND (opaque_true)
   */
  wrapIfCondition(ifNode) {
    if (Math.random() > this.ratio) return;

    for (const clause of ifNode.clauses) {
      const opaqueTrue = this.generator.makeTruePredicate();
      clause.condition = A.binaryExpression(
        clause.condition,
        'and',
        opaqueTrue,
      );
    }
  }

  /**
   * Chèn fake if-statements vào block.
   * Fake if: if (opaque_false) then <dead code> end
   */
  processBlock(block) {
    const body = block.body || [];
    const newBody = [];

    for (const stmt of body) {
      newBody.push(stmt);

      // Đôi khi chèn fake if sau statement này
      if (Math.random() < this.insertFakeIfRatio) {
        const fakeIf = this.makeFakeIf();
        newBody.push(fakeIf);
      }
    }

    block.body = newBody;
  }

  /**
   * Tạo fake if-statement với điều kiện luôn sai.
   * Bên trong là code chết.
   */
  makeFakeIf() {
    const opaqueFalse = this.generator.makeFalsePredicate();
    const deadBody = A.block([
      A.localStatement(
        [A.identifier('_x')],
        [A.numberLiteral(Math.floor(Math.random() * 1000))],
      ),
      A.callStatement(
        A.callExpression(
          A.identifier('print'),
          [A.identifier('_x')],
        ),
      ),
    ]);

    return A.ifStatement(
      [{ condition: opaqueFalse, body: deadBody }],
      null,
    );
  }
}

// ============================================================
// Entry
// ============================================================

export function injectOpaquePredicates(ast, options) {
  const injector = new OpaqueInjector(options);
  return injector.inject(ast);
}

export default { injectOpaquePredicates, OpaqueInjector };