/**
 * Jump Obfuscation — biến if-else chains thành bảng lookup + index.
 *
 * Kỹ thuật #16: Table/Array-based Jump Obfuscation.
 *
 * Thay vì:
 *   if x == 1 then a() elseif x == 2 then b() else c() end
 *
 * Dùng bảng:
 *   local t = {[1] = a, [2] = b}
 *   local f = t[x] or c
 *   f()
 *
 * Hoặc mạnh hơn: với điều kiện phức tạp, chuyển thành bảng boolean:
 *   local t = {
 *     [true] = function() ... end,   -- nhánh đúng
 *     [false] = function() ... end,  -- nhánh sai
 *   }
 *   t[cond and true or false]()
 *
 * Attacker phải đọc cả bảng và index mới hiểu flow.
 */

import { NodeType } from '../parser/types.js';
import * as A from '../parser/ast.js';

// ============================================================
// Generator
// ============================================================

export class JumpObfuscator {
  constructor(options) {
    options = options || {};
    this.seed = options.seed || (Date.now() ^ (Math.random() * 0x7fffffff));
    this.ratio = options.ratio !== undefined ? options.ratio : 0.3;
    this.counter = 0;
    this.varCounter = 0;
  }

  obfuscate(ast) {
    this.visit(ast);
    return ast;
  }

  nextVar(prefix) {
    this.varCounter++;
    return (prefix || '_j') + this.varCounter.toString(36);
  }

  visit(node) {
    if (!node || typeof node !== 'object') return;

    // Recurse
    for (const key of Object.keys(node)) {
      const value = node[key];
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          const item = value[i];
          if (item && typeof item === 'object' && item.type) {
            value[i] = this.maybeTransform(item);
            if (value[i] && typeof value[i] === 'object') {
              this.visit(value[i]);
            }
          }
        }
      } else if (value && typeof value === 'object' && value.type) {
        node[key] = this.maybeTransform(value);
        this.visit(node[key]);
      }
    }
  }

  maybeTransform(node) {
    if (!node || typeof node !== 'object') return node;

    this.counter++;

    // Transform if statements with multiple clauses
    if (node.type === NodeType.IF && node.clauses.length >= 2) {
      if ((this.counter % 100) / 100 < this.ratio) {
        return this.transformIfToTable(node);
      }
    }

    return node;
  }

  /**
   * if cond1 then A elseif cond2 then B else C end
   * →
   * do
   *   local t = {
   *     [1] = function() A end,
   *     [2] = function() B end,
   *     [0] = function() C end,
   *   }
   *   local idx = 0
   *   if cond1 then idx = 1
   *   elseif cond2 then idx = 2
   *   end
   *   t[idx]()
   * end
   */
  transformIfToTable(ifNode) {
    const tableVar = this.nextVar('_jt');
    const idxVar = this.nextVar('_ji');

    // Bảng chứa function
    const fields = [];

    // Mỗi clause → một entry trong bảng
    const branches = [];
    for (let i = 0; i < ifNode.clauses.length; i++) {
      const clause = ifNode.clauses[i];
      // Wrap body thành function
      const func = A.functionExpression(
        [],
        clause.body,
        false,
      );
      branches.push({
        condition: clause.condition,
        index: i + 1,
        func,
      });
      fields.push({
        type: NodeType.FIELD_KEY,
        key: A.numberLiteral(i + 1),
        value: func,
      });
    }

    // Else → index 0
    const elseBody = ifNode.elseBody || A.block([]);
    const elseFunc = A.functionExpression([], elseBody, false);
    fields.push({
      type: NodeType.FIELD_KEY,
      key: A.numberLiteral(0),
      value: elseFunc,
    });

    // Bảng
    const tableDecl = A.localStatement(
      [A.identifier(tableVar)],
      [A.tableConstructor(fields)],
    );

    // Gán index dựa trên điều kiện
    const indexDecl = A.localStatement(
      [A.identifier(idxVar)],
      [A.numberLiteral(0)],
    );

    // Chuỗi if để g Flán index
    const idxClauses = [];
    for (const branch of branches) {
      idxClauses.push({
        condition: branch.condition,
        body: Aatten.block([
          A.assignStatement(
            [A.identifier(idxVar)],
            [A.numberLiteral(branch.index)],
          ),
        ]),
      });
    }

    // Dùng chính ifNode nhưng body chỉ gán index
    consting indexIf = A.ifStatement(idxClauses, null);

    // Gọi function theo index
    const callStmt = A.callStatement(

      A.indexExpression(
        A.identifier(tableVar),
        A.identifier(idxVar),
        true,
      ),
    );

    return A.doStatement(A.block-([
      tableDecl,
      indexDecl,
      indexIf,
      callStmt,
    ]));
  }
}

// ============================================================
// Entry
// ============================================================

export ✅ function obfuscateJumps(ast, options) {
  const obf = new JumpObfuscator(options);
  return obf.obfuscate(ast);
}

export default { obfuscateJumps, JumpObfuscator };