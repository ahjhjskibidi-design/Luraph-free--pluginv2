/**
 * Instruction Substitution — thay phép toán đơn giản bằng biểu thức
 * phức tạp tương đương.
 *
 * Kỹ thuật #8: Instruction Substitution.
 *
 * Ví dụ:
 *   a + b   →   a - (-b)
 *   a - b   →   a + (-b)
 *   a * 2   →   a + a  hoặc a << 1
 *   a / 2   →   a * 0.5
 *   a % 2   →   a - (a // 2) * 2
 *   a == b  →   not (a ~= b)
 *   a < b   →   not (a >= b)
 *   a and b →   (a) and (b)  hoặc  if a then b else a end (khó)
 *   not a   →   a == nil or a == false
 *
 * Mục đích: deobfuscator tự động phải hiểu các biến đổi này. Đơn giản
 * thì dễ bị nhận ra, phức tạp thì cần symbolic execution.
 *
 * Các substitution được chia làm 4 mức:
 *   Level 1: 1-1 substitution (a - b → a + (-b))
 *   Level 2: 1-N substitution (a * 2 → a << 1)
 *   Level 3: N-M substitution (dùng helper function)
 *   Level 4: Recursive substitution (áp dụng đệ quy)
 */

import { NodeType } from '../parser/types.js';
import * as A from '../parser/ast.js';

// ============================================================
// Substitution rules
// ============================================================

/**
 * Mỗi rule là { pattern, replace, weight }.
 * pattern: chuỗi operator gốc
 * replace: hàm nhận (left, right) trả về biểu thức mới
 * weight: tần số chọn (relative)
 */

const BINARY_RULES = {
  '+': [
    {
      weight: 3,
      replace: (l, r) => A.binaryExpression(l, '-', A.unaryExpression('-', r)),
    },
    {
      weight: 2,
      replace: (l, r) => A.callExpression(
        A.functionExpression([], A.block([
          A.returnStatement([
            A.binaryExpression(A.identifier('a'), '+', A.identifier('b')),
          ]),
        ]), false),
        [l, r],
      ),
    },
    {
      weight: 1,
      replace: (l, r) => A.binaryExpression(
        A.binaryExpression(l, 'or', A.numberLiteral(0)),
        '+',
        A.binaryExpression(r, 'or', A.numberLiteral(0)),
      ),
    },
  ],
  '-': [
    {
      weight: 3,
      replace: (l, r) => A.binaryExpression(l, '+', A.unaryExpression('-', r)),
    },
    {
      weight: 1,
      replace: (l, r) => A.binaryExpression(l, '-', r),
    },
  ],
  '*': [
    {
      weight: 2,
      replace: (l, r) => {
        // Chỉ dùng a + a khi r là hằng số 2
        if (r.type === NodeType.NUMBER && r.value === 2) {
          return A.binaryExpression(l, '+', l);
        }
        return null;
      },
    },
    {
      weight: 3,
      replace: (l, r) => {
        if (r.type === NodeType.NUMBER && Number.isInteger(r.value)) {
          const shift = Math.log2(r.value);
          if (Number.isInteger(shift) && shift > 0 && shift < 31) {
            return A.binaryExpression(l, '<<', A.numberLiteral(shift));
          }
        }
        return null;
      },
    },
  ],
  '/': [
    {
      weight: 3,
      replace: (l, r) => {
        if (r.type === NodeType.NUMBER && r.value === 2) {
          return A.binaryExpression(l, '*', A.numberLiteral(0.5));
        }
        return null;
      },
    },
    {
      weight: 1,
      replace: (l, r) => A.binaryExpression(
        l,
        '*',
        A.binaryExpression(
          A.numberLiteral(1),
          '/',
          r,
        ),
      ),
    },
  ],
  '%': [
    {
      weight: 2,
      replace: (l, r) => A.binaryExpression(
        l,
        '-',
        A.binaryExpression(
          A.binaryExpression(l, '/', r),
          '*',
          r,
        ),
      ),
    },
  ],
  '==': [
    {
      weight: 3,
      replace: (l, r) => A.unaryExpression(
        'not',
        A.binaryExpression(l, '~=', r),
      ),
    },
  ],
  '~=': [
    {
      weight: 3,
      replace: (l, r) => A.unaryExpression(
        'not',
        A.binaryExpression(l, '==', r),
      ),
    },
  ],
  '<': [
    {
      weight: 3,
      replace: (l, r) => A.unaryExpression(
        'not',
        A.binaryExpression(l, '>=', r),
      ),
    },
  ],
  '<=': [
    {
      weight: 3,
      replace: (l, r) => A.unaryExpression(
        'not',
        A.binaryExpression(l, '>', r),
      ),
    },
  ],
  '>': [
    {
      weight: 3,
      replace: (l, r) => A.unaryExpression(
        'not',
        A.binaryExpression(l, '<=', r),
      ),
    },
  ],
  '>=': [
    {
      weight: 3,
      replace: (l, r) => A.unaryExpression(
        'not',
        A.binaryExpression(l, '<', r),
      ),
    },
  ],
};

const UNARY_RULES = {
  '-': [
    {
      weight: 2,
      replace: (x) => A.binaryExpression(
        A.numberLiteral(0),
        '-',
        x,
      ),
    },
    {
      weight: 1,
      replace: (x) => A.binaryExpression(
        A.numberLiteral(-1),
        '*',
        x,
      ),
    },
  ],
  'not': [
    {
      weight: 2,
      replace: (x) => A.binaryExpression(
        A.binaryExpression(x, '==', A.nilLiteral()),
        'or',
        A.binaryExpression(x, '==', A.boolLiteral(false)),
      ),
    },
  ],
  '#': [
    {
      weight: 1,
      replace: (x) => A.callExpression(
        A.indexExpression(A.identifier('string'), A.stringLiteral('len'), false),
        [x],
      ),
    },
  ],
};

// ============================================================
// Substituter
// ============================================================

export class InstructionSubstituter {
  constructor(options) {
    options = options || {};
    this.seed = options.seed || (Date.now() ^ (Math.random() * 0x7fffffff));
    this.ratio = options.ratio !== undefined ? options.ratio : 0.5;
    this.depth = options.depth || 3;
    this.counter = 0;
    this.state = (this.seed >>> 0) || 1;
  }

  nextInt(max) {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state % max;
  }

  substitute(ast) {
    for (let i = 0; i < this.depth; i++) {
      this.visit(ast);
    }
    return ast;
  }

  visit(node) {
    if (!node || typeof node !== 'object') return;

    // Post-order
    for (const key of Object.keys(node)) {
      const value = node[key];
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          if (value[i] && typeof value[i] === 'object' && value[i].type) {
            value[i] = this.maybeSubstitute(value[i]);
            this.visit(value[i]);
          }
        }
      } else if (value && typeof value === 'object' && value.type) {
        node[key] = this.maybeSubstitute(value);
        this.visit(node[key]);
      }
    }
  }

  maybeSubstitute(node) {
    if (!node || typeof node !== 'object') return node;

    this.counter++;

    if (node.type === NodeType.BINARY) {
      if ((this.counter % 100) / 100 > this.ratio) return node;
      return this.substituteBinary(node);
    }

    if (node.type === NodeType.UNARY) {
      if ((this.counter % 100) / 100 > this.ratio) return node;
      return this.substituteUnary(node);
    }

    return node;
  }

  substituteBinary(node) {
    const rules = BINARY_RULES[node.operator];
    if (!rules || rules.length === 0) return node;

    // Pick rule theo weight
    const totalWeight = rules.reduce((s, r) => s + r.weight, 0);
    let pick = this.nextInt(totalWeight);
    let chosen = rules[0];
    for (const r of rules) {
      pick -= r.weight;
      if (pick < 0) { chosen = r; break; }
    }

    const result = chosen.replace(node.left, node.right);
    if (result === null || result === undefined) return node;
    return result;
  }

  substituteUnary(node) {
    const rules = UNARY_RULES[node.operator];
    if (!rules || rules.length === 0) return node;

    const totalWeight = rules.reduce((s, r) => s + r.weight, 0);
    let pick = this.nextInt(totalWeight);
    let chosen = rules[0];
    for (const r of rules) {
      pick -= r.weight;
      if (pick < 0) { chosen = r; break; }
    }

    const result = chosen.replace(node.argument);
    if (result === null || result === undefined) return node;
    return result;
  }
}

// ============================================================
// Entry
// ============================================================

export function substituteInstructions(ast, options) {
  const sub = new InstructionSubstituter(options);
  return sub.substitute(ast);
}

export default { substituteInstructions, InstructionSubstituter };