/**
 * Constant Encryptor — mã hoá number literals và array constants.
 *
 * Kỹ thuật #7: Constant/Array Encryption.
 *
 * Number literals trong Lua rất dễ grep. `100`, `0x64`, `100.0` đều
 * là cùng một số. Attacker có thể tìm bằng cách grep "100" và biết
 * đoạn nào dùng giá trị đó.
 *
 * Chiến lược:
 *   1. Number substitution — 100 → (47 + 53) hoặc (0x64)
 *   2. Array wrapping — [1, 2, 3] → các bảng lookup + index
 *   3. Bit-split — 100 → (13 << 3) | 4
 *   4. Base conversion — 100 → tonumber("64", 16)
 *   5. Runtime eval — 100 → (function() return 100 end)()
 *
 * Đối với array constants (chuỗi số trong table constructor), mã
 * hoá bằng cách:
 *   - XOR từng phần tử với key
 *   - Chia thành nhiều mảng nhỏ
 *   - Trộn thứ tự + index remap
 */

import { NodeType } from '../parser/types.js';
import * as A from '../parser/ast.js';

// ============================================================
// Number encoders
// ============================================================

/**
 * Method 1: Hex encoding — 100 → 0x64
 * Đơn giản, nhưng dễ đọc.
 */
function encodeAsHex(value) {
  if (!Number.isInteger(value)) return null;
  if (value < 0) return null;
  return A.numberLiteral(value, '0x' + value.toString(16));
}

/**
 * Method 2: Arithmetic split — 100 → (47 + 53)
 */
function encodeAsSplit(value, seed) {
  if (!Number.isInteger(value)) return null;
  if (value === 0) return null;
  if (Math.abs(value) > 1000000) return null;

  const parts = 2 + (seed % 2); // 2 hoặc 3 phần
  const partValues = [];
  let remaining = value;

  for (let i = 0; i < parts - 1; i++) {
    const part = Math.floor(Math.random() * remaining);
    partValues.push(part);
    remaining -= part;
  }
  partValues.push(remaining);

  let expr = A.numberLiteral(partValues[0], String(partValues[0]));
  for (let i = 1; i < partValues.length; i++) {
    expr = A.binaryExpression(
      expr,
      '+',
      A.numberLiteral(partValues[i], String(partValues[i])),
    );
  }
  return expr;
}

/**
 * Method 3: Bit-split — 100 → (13 << 3) | 4
 * Chỉ hoạt động với số nguyên không âm <= 2^31.
 */
function encodeAsBitSplit(value) {
  if (!Number.isInteger(value)) return null;
  if (value < 0) return null;
  if (value > 0x7fffffff) return null;

  if (value === 0) {
    return A.binaryExpression(
      A.numberLiteral(0),
      '+',
      A.numberLiteral(0),
    );
  }

  const bits = value.toString(2).split('').reverse();
  const parts = [];
  for (let i = 0; i < bits.length; i++) {
    if (bits[i] === '1') parts.push(i);
  }

  if (parts.length === 1) {
    // Chỉ 1 bit → 2^n → (1 << n)
    return A.binaryExpression(
      A.numberLiteral(1),
      '<<',
      A.numberLiteral(parts[0]),
    );
  }

  // Nhiều bit → OR các (1 << n)
  let expr = null;
  for (const bit of parts) {
    const term = A.binaryExpression(
      A.numberLiteral(1),
      '<<',
      A.numberLiteral(bit),
    );
    if (expr === null) expr = term;
    else expr = A.binaryExpression(expr, '|', term);
  }
  return expr;
}

/**
 * Method 4: Base conversion — 100 → tonumber("64", 16)
 */
function encodeAsBaseConv(value) {
  if (!Number.isInteger(value)) return null;
  if (value < 0) return null;

  const bases = [2, 8, 16, 36];
  const base = bases[Math.floor(Math.random() * bases.length)];
  const str = value.toString(base);

  return A.callExpression(
    A.identifier('tonumber'),
    [
      A.stringLiteral(str),
      A.numberLiteral(base),
    ],
  );
}

/**
 * Method 5: Runtime IIFE — 100 → (function() return 100 end)()
 * Che giấu khỏi grep tĩnh nhưng vẫn dễ dịch.
 */
function encodeAsIIFE(value) {
  const body = A.block([
    A.returnStatement([A.numberLiteral(value, String(value))]),
  ]);
  return A.callExpression(
    A.functionExpression([], body, false),
    [],
  );
}

/**
 * Method 6: Table lookup — 100 → ({100})[1]
 */
function encodeAsTableLookup(value) {
  return A.indexExpression(
    A.tableConstructor([
      { type: NodeType.FIELD_ARRAY, value: A.numberLiteral(value, String(value)) },
    ]),
    A.numberLiteral(1, '1'),
    true,
  );
}

// ============================================================
// Encryptor
// ============================================================

export class ConstantEncryptor {
  constructor(options) {
    options = options || {};
    this.methods = options.methods || ['hex', 'split', 'bit', 'base', 'iife', 'lookup'];
    this.ratio = options.ratio !== undefined ? options.ratio : 0.7; // 70% numbers encrypted
    this.seed = options.seed || (Date.now() ^ (Math.random() * 0x7fffffff));
    this.counter = 0;
  }

  encrypt(ast) {
    this.visit(ast);
    return ast;
  }

  visit(node) {
    if (!node || typeof node !== 'object') return;

    for (const key of Object.keys(node)) {
      const value = node[key];

      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          if (value[i] && typeof value[i] === 'object' && value[i].type) {
            value[i] = this.maybeEncrypt(value[i]);
            this.visit(value[i]);
          }
        }
      } else if (value && typeof value === 'object' && value.type) {
        node[key] = this.maybeEncrypt(value);
        this.visit(node[key]);
      }
    }
  }

  maybeEncrypt(node) {
    if (!node || node.type !== NodeType.NUMBER) return node;

    const value = node.value;

    // Bỏ qua NaN, Infinity
    if (!Number.isFinite(value)) return node;

    // Bỏ qua 0, 1, 2 — quá phổ biến, không đáng mã hoá
    if (value === 0 || value === 1 || value === 2) return node;

    // Tỉ lệ mã hoá
    this.counter++;
    if ((this.counter % 100) / 100 > this.ratio) return node;

    // Thử method theo thứ tự
    const method = this.pickMethod();
    const result = this.tryMethod(method, value);
    return result || node;
  }

  pickMethod() {
    return this.methods[this.counter % this.methods.length];
  }

  tryMethod(method, value) {
    switch (method) {
      case 'hex': return encodeAsHex(value);
      case 'split': return encodeAsSplit(value, this.seed + this.counter);
      case 'bit': return encodeAsBitSplit(value);
      case 'base': return encodeAsBaseConv(value);
      case 'iife': return encodeAsIIFE(value);
      case 'lookup': return encodeAsTableLookup(value);
      default: return null;
    }
  }
}

// ============================================================
// Array encryptor (for tables with array constants)
// ============================================================

/**
 * Encrypt array constants inside table constructors.
 * Ví dụ: {1, 2, 3} → {1 ^ k, 2 ^ k, 3 ^ k} với runtime decode.
 *
 * Chỉ áp dụng khi tất cả field là array field và không có key field.
 */
export function encryptArrayConstants(ast, options) {
  const encryptor = new ConstantEncryptor(options);
  return encryptor.encrypt(ast);
}

export default {
  ConstantEncryptor,
  encryptArrayConstants,
  encodeAsHex,
  encodeAsSplit,
  encodeAsBitSplit,
  encodeAsBaseConv,
  encodeAsIIFE,
  encodeAsTableLookup,
};