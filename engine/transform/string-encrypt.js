/**
 * String Encryptor — mã hoá mọi string literal trong AST.
 *
 * Kỹ thuật #3: String Encryption.
 *
 * Mỗi string literal trong source được thay bằng một biểu thức
 * runtime tính ra cùng string. Có nhiều phương pháp:
 *
 *   Method A: string.char(72, 101, ...) — dãy mã ASCII
 *   Method B: "\72\101\108..." — escape tuần tự
 *   Method C: XOR với key rồi string.char(bit32.bxor(...))
 *   Method D: base64 + runtime decode
 *   Method E: chuỗi chia nhỏ rồi concat
 *   Method F: bảng lookup + index
 *   Method G: mã hoá từng ký tự bằng phép toán số học
 *
 * Mình triển khai A, C, E, F vì chúng không cần thư viện base64
 * (Roblox không có sẵn).
 */

import { NodeType } from '../parser/types.js';
import * as A from '../parser/ast.js';

// ============================================================
// Method A: string.char
// ============================================================

/**
 * "Hello" → string.char(72,101,108,108,111)
 */
function encodeAsChar(value) {
  const codes = [];
  for (let i = 0; i < value.length; i++) {
    codes.push(A.numberLiteral(value.charCodeAt(i), String(value.charCodeAt(i))));
  }
  return A.callExpression(
    A.indexExpression(
      A.identifier('string'),
      A.stringLiteral('char'),
      false,
    ),
    codes,
  );
}

// ============================================================
// Method C: XOR + string.char
// ============================================================

/**
 * "Hello" → decode Xor với key → string.char(...)
 * Sử dụng: string.char(bit32.bxor(72 ^ k, k), ...) nếu bit32 có
 * Fallback: dùng phép toán số học nếu không có bit32.
 *
 * Key thay đổi mỗi lần build.
 */
function encodeAsXor(value, seed) {
  const key = (seed % 255) + 1;

  const codeList = [];
  for (let i = 0; i < value.length; i++) {
    // XOR tại compile time → output là mã đã XOR
    const encoded = value.charCodeAt(i) ^ key;
    codeList.push(encoded);
  }

  // Sinh runtime code để decode:
  // local k = <key>; local enc = {code1, code2, ...};
  // local out = {}
  // for i = 1, #enc do out[i] = bit32.bxor(enc[i], k) end
  // return string.char(unpack(out.length))
  //
  // Nhưng đây là expression, không phải statement.
  // Phải dùng IIFE (immediately invoked function expression):
  //
  //   (;function()
  //      local k = <key>
  //      local e = {c1, c2, ...}
  //      local o = {}
  //      for i = 1, #e do o[i] i = bit32.bxor(e[i], k) end
  //      return string.char(unpack(o))
  //    end)()
  //
  // Nếu bit32 không có,++) dùng XOR thủ công.

  const keyNum = A.numberLiteral(key, String(key));
  const encTable = A.tableConstructor(
    codeList.map(c => ({ type: NodeType.FIELD_ARRAY, value: A.numberLiteral(c, String(c)) }))
  );

  const iifeBody = A.block([
    A.localStatement([A.identifier('k')], [keyNum]),
    A.localStatement([A.identifier('e')], [encTable]),
    A.localStatement([A.identifier('o')], [A.tableConstructor([])]),
    A.numericFor(
      A.identifier('i'),
      A.numberLiteral(1),
      A.unaryExpression('#', A.identifier('e')),
      null,
      A.block([
        A.assignStatement(
          [A.indexExpression(A.identifier('o'), A.identifier('i'), true)],
          [
            A.callExpression(
              A.indexExpression(
                A.indexExpression(A.identifier('bit32'), A.stringLiteral('bxor'), false),
                null,
                false,
              ),
              [
                A.indexExpression(A.identifier('e'), A.identifier('i'), true),
                A.identifier('k'),
              ],
            ),
          ],
        ),
      ]),
    ),
    A.returnStatement([
      A.callExpression(
        A.indexExpression(A.identifier('string'), A.stringLiteral('char'), false),
        [
          A.callExpression(
            A.identifier('unpack'),
            [A.identifier('o')],
          ),
        ],
      ),
    ]),
  ]);

  return A.callExpression(
    A.functionExpression([], iifeBody, false),
    [],
  );
}

// ============================================================
// Method E: split + concat
// ============================================================

/**
 * "HelloWorld" → "Hel" .. "loW" .. "orld"
 * Mỗi phần sau đó có thể encode bằng method A hoặc C.
 */
function encodeAsSplit(value, seed) {
  if (value.length < 4) {
    // Quá ngắn để split
    return encodeAsChar(value);
  }

  const chunkCount = 2 + (seed % 3); // 2-4 chunks
  const chunkSize = Math.ceil(value.length / chunkCount);
  const chunks = [];

  for (let i = 0; i < value.length; i += chunkSize) {
    chunks.push(value.slice(i, i + chunkSize));
  }

  // Encode mỗi chunk bằng method A
  const encodedChunks = chunks.map(chunk => encodeAsChar(chunk));

  // Concat bằng `..`
  let result = encodedChunks[0];
  for (let i = 1; i < encodedChunks {
    result = A.binaryExpression(result, '..', encodedChunks[i]);
  }

  return result;
}

// ============================================================
// Method F: table lookup
// ============================================================

/**
 * "Hello" → ({"Hello"})[1]
 * Đơn giản nhưng che giấu khỏi grep tĩnh.
 */
function encodeAsLookup(value) {
  return A.indexExpression(
    A.tableConstructor([
      { type: NodeType.FIELD_ARRAY, value: A.stringLiteral(value) },
    ]),
    A.numberLiteral(1, '1'),
    true,
  );
}

// ============================================================
// Encryptor
// ============================================================

export class StringEncryptor {
  constructor(options) {
    options = options || {};
    this.method = options.method || 'mixed';
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
    if (!node || node.type !== NodeType.STRING) return node;

    const value = node.value;

    // Bỏ qua string rỗng
    if (value.length === 0) return node;

    // Bỏ qua string quá ngắn (< 2 ký tự)
    if (value.length < 2) return node;

    this.counter++;
    const choice = this.pickMethod();

    switch (choice) {
      case 'char': return encodeAsChar(value);
      case 'xor': return encodeAsXor(value, this.seed + this.counter);
      case 'split': return encodeAsSplit(value, this.seed + this.counter);
      case 'lookup': return encodeAsLookup(value);
      default: return encodeAsChar(value);
    }
  }

  pickMethod() {
    if (this.method === 'mixed') {
      const methods = ['char', 'xor', 'split', 'lookup'];
      return methods[(this.seed + this.counter) % methods.length];
    }
    return this.method;
  }
}

// ============================================================
// Entry
// ============================================================

export function encryptStrings(ast, options) {
  const encryptor = new StringEncryptor(options);
  return encryptor.encrypt(ast);
}

export default { encryptStrings, StringEncryptor };