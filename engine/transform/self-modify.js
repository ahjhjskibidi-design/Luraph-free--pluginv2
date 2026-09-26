/**
 * Self-modifying Code — code thay đổi chính nó khi chạy.
 *
 * Kỹ thuật #14: Self-modifying Code.
 *
 * Ý tưởng: một số đoạn code được "patch" runtime, tức là nội dung
 * của hàm/table được thay đổi sau lần chạy đầu tiên. Attacker đọc
 * source tại thời điểm t sẽ thấy code khác với code đang thực thi.
 *
 * Các hình thức:
 *
 *   1. Guard-patch: lần chạy đầu tiên thực hiện check, sau đó
 *      ghi đè chính nó bằng function rỗng.
 *
 *      local _checked = false
 *      local function check()
 *        if _checked then return end
 *        _checked = true
 *        -- do integrity check
 *      end
 *
 *   2. State-mutate: một bảng config được thay đổi sau khi chạy.
 *
 *   3. Bytecode-swap: bytecode array bị zero sau khi load, khiến
 *      dump memory sau đó không có gì để đọc.
 *
 *   4. Decrypt-once: một phần code chỉ decrypt sau khi key đúng.
 *
 * Trong Lua, self-modifying code hạn chế vì closure được compile
 * sẵn. Nhưng table entries có thể thay đổi, closure có thể thay thế
 * biến toàn cục, loadstring có thể chạy code mới.
 *
 * Cách mình áp dụng:
 *   - Guard functions tự vô hiệu sau lần chạy đầu
 *   - Bytecode array bị zero (đặt các phần tử = 0) sau khi decrypt
 *   - Config table bị overwrite
 */

import { NodeType } from '../parser/types.js';
import * as A from '../parser/ast.js';

// ============================================================
// Self-patching function generator
// ============================================================

/**
 * Sinh một self-patching function.
 *
 * Pattern:
 *   local _state = { active = true }
 *   local function _check()
 *     if not _state.active then return end
 *     _state.active = false
 *     -- ... real check logic here ...
 *   end
 *
 * Sau khi gọi lần đầu, _state.active = false, các lần sau chỉ
 * return ngay.
 */
export class SelfPatcher {
  constructor(seed) {
    this.seed = seed || (Date.now() ^ (Math.random() * 0x7fffffff));
    this.counter = 0;
  }

  makeSelfPatchingGuard(checkBody) {
    this.counter++;
    const stateVar = '_sp' + this.counter.toString(36);
    const funcName = '_spf' + this.counter.toString(36);

    // local _state = { active = true }
    const stateDecl = A.localStatement(
      [A.identifier(stateVar)],
      [A.tableConstructor([
        {
          type: NodeType.FIELD_KEY,
          key: A.stringLiteral('active'),
          value: A.boolLiteral(true),
        },
      ])],
    );

    // local function _spf()
    //   if not _state.active then return end
    //   _state.active = false
    //   <checkBody>
    // end
    const checkIf = A.ifStatement(
      [
        {
          condition: A.unaryExpression(
            'not',
            A.indexExpression(
              A.identifier(stateVar),
              A.stringLiteral('active'),
              false,
            ),
          ),
          body: A.block([A.returnStatement([])]),
        },
      ],
      null,
    );

    const deactivate = A.assignStatement(
      [
        A.indexExpression(
          A.identifier(stateVar),
          A.stringLiteral('active'),
          false,
        ),
      ],
      [A.boolLiteral(false)],
    );

    const funcBody = A.block([
      checkIf,
      deactivate,
      ...(checkBody ? [checkBody] : []),
    ]);

    const funcDecl = A.functionDeclaration(
      A.identifier(funcName),
      [],
      funcBody,
      true,
    );

    return { decl: A.block([stateDecl, funcDecl]), funcName };
  }
}

// ============================================================
// Bytecode self-zeroing
// ============================================================

/**
 * Sinh code tự xóa bytecode array sau khi decrypt.
 *
 *   local _bc = {...}
 *   local _dec = decrypt(_bc)
 *   for i = 1, #_bc do _bc[i] = 0 end  -- zero original
 *   return _dec
 */
export function makeBytecodeZeroing(bytecodeVar, decryptedVar, prefix) {
  this_counter = (this_counter || 0) + 1;
  const i = '_zi' + this_counter.toString(36);

  return A.numericFor(
    A.identifier(i),
    A.numberLiteral(1),
    A.unaryExpression('#', A.identifier(bytecodeVar)),
    null,
    A.block([
      A.assignStatement(
        [
          A.indexExpression(
            A.identifier(bytecodeVar),
            A.identifier(i),
            true,
          ),
        ],
        [A.numberLiteral(0)],
      ),
    ]),
  );
}

let this_counter = 0;

// ============================================================
// One-shot decrypt wrapper
// ============================================================

/**
 * Sinh một IIFE chỉ decrypt một lần, sau đó tự xóa.
 *
 *   local _decrypt_once = (function()
 *     local _done = false
 *     return function()
 *       if _done then return nil end
 *       _done = true
 *       return realDecrypt()
 *     end
 *   end)()
 */
export function makeOneShotDecryptor(decryptBody, prefix) {
  const doneVar = prefix + '_done';

  const inner = A.block([
    A.localStatement(
      [A.identifier(doneVar)],
      [A.boolLiteral(false)],
    ),
    A.returnStatement([
      A.functionExpression(
        [],
        A.block([
          A.ifStatement(
            [
              {
                condition: A.identifier(doneVar),
                body: A.block([A.returnStatement([A.nilLiteral()])]),
              },
            ],
            null,
          ),
          A.assignStatement(
            [A.identifier(doneVar)],
            [A.boolLiteral(true)],
          ),
          A.returnStatement([decryptBody]),
        ]),
        false,
      ),
    ]),
  ]);

  return A.callExpression(
    A.functionExpression([], inner, false),
    [],
  );
}

// ============================================================
// Injector
// ============================================================

export class SelfModifyInjector {
  constructor(options) {
    options = options || {};
    this.seed = options.seed || (Date.now() ^ (Math.random() * 0x7fffffff));
    this.ratio = options.ratio !== undefined ? options.ratio : 0.4;
    this.patcher = new SelfPatcher(this.seed);
    this.counter = 0;
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

    // Chèn self-patching guard vào function bodies
    if (node.type === NodeType.FUNC_EXPR ||
        node.type === NodeType.FUNC_DECL ||
        node.type === NodeType.LOCAL_FUNC) {
      this.counter++;
      if ((this.counter % 100) / 100 > this.ratio) return;

      const checkBody = A.ifStatement(
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
      );

      const { decl, funcName } = this.patcher.makeSelfPatchingGuard(checkBody);

      // Chèn decl vào đầu function body
      node.body.body = [
        decl,
        A.callStatement(A.callExpression(A.identifier(funcName), [])),
        ...node.body.body,
      ];
    }
  }
}

// ============================================================
// Entry
// ============================================================

export function injectSelfModify(ast, options) {
  const injector = new SelfModifyInjector(options);
  return injector.inject(ast);
}

export default {
  injectSelfModify,
  SelfModifyInjector,
  SelfPatcher,
  makeBytecodeZeroing,
  makeOneShotDecryptor,
};