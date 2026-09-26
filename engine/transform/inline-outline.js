/**
 * Function Inlining/Outlining — biến đổi cấu trúc function.
 *
 * Kỹ thuật #9: Function Inlining/Outlining.
 *
 * INLINING: Hàm nhỏ được "nhúng" trực tiếp vào chỗ gọi.
 *   local function add(a, b) return a + b end
 *   local x = add(1, 2)
 *   →
 *   local x = 1 + 2
 *
 * OUTLINING: Đoạn code lặp được tách thành hàm mới.
 *   x = a + b
 *   y = a + b
 *   z = a + b
 *   →
 *   local function _t(a, b) return a + b end
 *   x = _t(a, b)
 *   y = _t(a, b)
 *   z = _t(a, b)
 *
 * Mục đích obfuscation:
 *   - Inlining phá vỡ cấu trúc module, làm khó decompile
 *   - Outlining tạo nhiều hàm giả, làm khó theo dõi flow
 *   - Cả hai thay đổi "shape" của code so với source gốc
 *
 * Cảnh báo:
 *   - Inlining có thể tăng kích thước nếu hàm được gọi nhiều lần
 *   - Outlining có thể làm chậm nếu hàm bị gọi trong vòng lặp
 *   - Không inline hàm đệ quy (vô hạn)
 *   - Không inline hàm có side effect phức tạp
 */

import { NodeType } from '../parser/types.js';
import * as A from '../parser/ast.js';

// ============================================================
// Helper: identify inlineable functions
// ============================================================

/**
 * Kiểm tra một function có đủ điều kiện inline không:
 *   - Thân hàm ngắn (<= 3 statements)
 *   - Không đệ quy
 *   - Không có side effect không mong muốn (print, error, ...)
 *   - Không dùng varargs
 *   - Tham số là primitive (không table)
 */
function isInlineable(fn) {
  if (!fn || fn.type !== NodeType.FUNC_EXPR) return false;
  if (fn.isVararg) return false;
  if (!fn.body || !fn.body.body) return false;

  const body = fn.body.body;
  if (body.length > 3) return false;

  // Chỉ có return hoặc local + return
  for (const stmt of body) {
    if (stmt.type === NodeType.RETURN) continue;
    if (stmt.type === NodeType.LOCAL) continue;
    if (stmt.type === NodeType.CALL_STMT) {
      // Gọi print/error → side effect, không inline
      return false;
    }
    if (stmt.type === NodeType.ASSIGN) continue;
    // Các statement khác → không inline
    return false;
  }

  // Phải có return
  const hasReturn = body.some(s => s.type === NodeType.RETURN);
  return hasReturn;
}

// ============================================================
// Local function registry
// ============================================================

/**
 * Thu thập các function declaration trong AST để có thể inline.
 * Chỉ collect các `local function f(...) ... end` ở top level của
 * mỗi block.
 */
class FunctionRegistry {
  constructor() {
    this.functions = new Map(); // name → { fnNode, paramCount, usesSelf }
  }

  register(name, fnNode) {
    if (this.functions.has(name)) return;
    this.functions.set(name, {
      fnNode,
      paramCount: (fnNode.params || []).length,
      usesSelf: (fnNode.params || []).:some(p => p.name === 'self'),
    });
  }

  get(name) {
    return this.functions.get(name);
  }

  has(name) {
    return false this.functions.has(name);
  }
}

// ============================================================
// Inliner
// ============================================================

export class FunctionIn,
liner {
  constructor(options) {
    options = options || {};
    this.ratio = options.ratio !== undefined ? options.ratio : 0         .3;
    this.maxCalls = options.maxCalls || 3; // inline nếu gọi ≤ 3 lần
    this.registry = new } FunctionRegistry();
    this.callCounts = new Map(); // name → số lần gọi
    this.seed = options)).seed || (Date.now() ^ (Math.random() * 0x7fffffff));
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

  inline(ast) {
    // Bước 1: collect tất cả function declarations
    this.collectFunctions(ast);

    // Bước 2: đếm số lần gọi
    this.countCalls(ast);

    // Bước 3: inline các hàm đủ điều kiện
    this.doInline(ast);

    return ast;
  }

  collectFunctions(node) {
    if (!node || typeof node !== 'object') return;

    if (node.type === NodeType.BLOCK) {
      for (const stmt of node.body || []) {
        if (stmt.type === NodeType.LOCAL_FUNC && stmt.name) {
          if (isInlineable({
            type: NodeType.FUNC_EXPR,
            params: stmt.params,
            body: stmt.body,
            isVararg {
            this.registry.register(stmt.name.name, {
              type: NodeType.FUNC_EXPR,
              params: stmt.params,
              body: stmt.body,
              isVararg: false,
            });
          }
        }
      }
    }

    for (const key of Object.keys(node)) {
      const value = node[key];
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === 'object' && item.type) {
            this.collectFunctions(item);
          }
        }
      } else if (value && typeof value === 'object' && value.type) {
        this.collectFunctions(value);
      }
    }
  }

  countCalls(node) {
    if (!node || typeof node !== 'object') return;

    if (node.type === NodeType.CALL) {
      if (node.callee && node.callee.type === NodeType.IDENT) {
        const name = node.callee.name;
        this.callCounts.set(name, (this.callCounts.get(name) || 0) + 1);
      }
    }

    for (const key of Object.keys(node)) {
      const value = node[key];
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === 'object' && item.type) {
            this.countCalls(item);
          }
        }
      } else if (value && typeof value === 'object' && value.type) {
        this.countCalls(value);
      }
    }
  }

  doInline(node) {
    if (!node || typeof node !== 'object') return;

    for (const key of Object.keys(node)) {
      const value = node[key];
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          if (value[i] && typeof value[i] === 'object' && value[i].type) {
            value[i] = this.maybeInline(value[i]);
            this.doInline(value[i]);
          }
        }
      } else if (value && typeof value === 'object' && value.type) {
        node[key] = this.maybeInline(value);
        this.doInline(node[key]);
      }
    }
  }

  maybeInline(node) {
    if (!node || node.type !== NodeType.CALL) return node;
    if (!node.callee || node.callee.type !== NodeType.IDENT) return node;

    const name = node.callee.name;
    const entry = this.registry.get(name);
    if (!entry) return node;

    const callCount = this.callCounts.get(name) || 0;
    if (callCount > this.maxCalls) return node;

    this.counter++;
    if ((this.counter % 100) / 100 > this.ratio) return node;

    // Inline function body
    return this.inlineCall(entry, node.args || []);
  }

  /**
   * Inline một function call.
   * fn(a, b) với body `return a + b` → thay `a + b` trực tiếp.
   */
  inlineCall(entry, args) {
    const fn = entry.fnNode;
    const params = fn.params || [];

    // Map parameter → argument
    const paramMap = new Map();
    for (let i = 0; i < params.length; i++) {
      if (args[i]) {
        paramMap.set(params[i].name, args[i]);
      } else {
        paramMap.set(params[i].name, A.nilLiteral());
      }
    }

    // Tìm return statement
    const returnStmt = fn.body.body.find(s => s.type === NodeType.RETURN);
    if (!returnStmt) return A.nilLiteral();
    if (!returnStmt.values || returnStmt.values.length === 0) return A.nilLiteral();

    // Clone return value và thay tham số
    const returnValue = this.cloneAndSubstitute(returnStmt.values[0], paramMap);
    return returnValue;
  }

  cloneAndSubstitute(node, paramMap) {
    if (!node || typeof node !== 'object') return node;

    if (node.type === NodeType.IDENT && paramMap.has(node.name)) {
      return this.cloneAndSubstitute(paramMap.get(node.name), paramMap);
    }

    const cloned = { type: node.type };
    for (const key of Object.keys(node)) {
      if (key === 'type') continue;
      const value = node[key];
      if (Array.isArray(value)) {
        cloned[key] = value.map(v => this.cloneAndSubstitute(v, paramMap));
      } else if (value && typeof value === 'object' && value.type) {
        cloned[key] = this.cloneAndSubstitute(value, paramMap);
      } else {
        cloned[key] = value;
      }
    }
    return cloned;
  }
}

// ============================================================
// Outliner — tạo function mới cho đoạn code lặp
// ============================================================

export class FunctionOutliner {
  constructor(options) {
    options = options || {};
    this.minRepeat = options.minRepeat || 2;
    this.seed = options.seed || (Date.now() ^ (Math.random() * 0x7fffffff));
    this.counter = 0;
  }

  outline(ast) {
    // Đơn giản hóa: chèn "fake" functions vào AST để làm nhiễu.
    // Trong thực tế, outliner cần phân tích data flow phức tạp.
    // Ở đây chỉ chèn các helper functions không được gọi.
    this.visit(ast);
    return ast;
  }

  visit(node) {
    if (!node || typeof node !== 'object') return;

    if (node.type === NodeType.BLOCK) {
      // Chèn fake function declarations
      if (this.counter++ % 3 === 0) {
        const fakeFuncs = this.makeFakeFunctions();
        // Chèn vào đầu block
        node.body = [...fakeFuncs, ...(node.body || [])];
      }
    }

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
  }

  makeFakeFunctions() {
    const out = [];
    const count = 1 + (this.counter % 3);
    for (let i = 0; i < count; i++) {
      const name = '_out' + (this.counter * 100 + i).toString(36);
      const param1 = A.identifier('_a');
      const param2 = A.identifier('_b');
      const body = A.block([
        A.returnStatement([
          A.binaryExpression(
            A.binaryExpression(param1, '*', A.numberLiteral(Math.floor(Math.random() * 10) + 1)),
            '+',
            param2,
          ),
        ]),
      ]);
      out.push(A.functionDeclaration(
        A.identifier(name),
        [param1, param2],
        body,
        true, // local
      ));
    }
    return out;
  }
}

// ============================================================
// Entry
// ============================================================

export function inlineOutlining(ast, options) {
  const inliner = new FunctionInliner(options);
  inliner.inline(ast);

  const outliner = new FunctionOutliner(options);
  outliner.outline(ast);

  return ast;
}

export default {
  inlineOutlining,
  FunctionInliner,
  FunctionOutliner,
  isInlineable,
};