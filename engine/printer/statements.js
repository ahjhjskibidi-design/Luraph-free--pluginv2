/**
 * Print statement nodes to Lua source.
 *
 * Statements can be multiline (if, while, for, function). The writer
 * handles indentation as we descend into blocks.
 */

import { NODE } from '../parser/types.js';
import { printExpr } from './expressions.js';

export function printStmt(W, node) {
  if (!node) return;

  switch (node.type) {
    case NODE.LOCAL:          return printLocal(W, node);
    case NODE.ASSIGN:         return printAssign(W, node);
    case NODE.CALL_STMT:      return printCallStmt(W, node);
    case NODE.IF:             return printIf(W, node);
    case NODE.WHILE:          return printWhile(W, node);
    case NODE.REPEAT:         return printRepeat(W, node);
    case NODE.FOR_NUM:        return printNumericFor(W, node);
    case NODE.FOR_GEN:        return printGenericFor(W, node);
    case NODE.DO:             return printDo(W, node);
    case NODE.RETURN:         return printReturn(W, node);
    case NODE.BREAK:          W.line('break'); return;
    case NODE.FUNC_DECL:      return printFunctionDecl(W, node, false);
    case NODE.LOCAL_FUNC:     return printFunctionDecl(W, node, true);
    default:
      W.line('--[[unknown stmt:' + node.type + ']]');
  }
}

function printLocal(W, node) {
  W.write('local ');
  for (let i = 0; i < node.names.length; i++) {
    if (i > 0) W.write(', ');
    W.write(node.names[i].name);
  }
  if (node.values.length > 0) {
    W.write(' = ');
    for (let i = 0; i < node.values.length; i++) {
      if (i > 0) W.write(', ');
      printExpr(W, node.values[i]);
    }
  }
  W.newline();
}

function printAssign(W, node) {
  for (let i = 0; i < node.targets.length; i++) {
    if (i > 0) W.write(', ');
    printExpr(W, node.targets[i]);
  }
  W.write(' = ');
  for (let i = 0; i < node.values.length; i++) {
    if (i > 0) W.write(', ');
    printExpr(W, node.values[i]);
  }
  W.newline();
}

function printCallStmt(W, node) {
  printExpr(W, node.expression);
  W.newline();
}

function printIf(W, node) {
  for (let i = 0; i < node.clauses.length; i++) {
    const clause = node.clauses[i];
    const kw = i === 0 ? 'if ' : 'elseif ';
    W.write(kw);
    printExpr(W, clause.condition);
    W.write(' then');
    W.newline();
    W.indent();
    printBlockBody(W, clause.body);
    W.dedent();
  }
  if (node.elseBody) {
    W.line('else');
    W.indent();
    printBlockBody(W, node.elseBody);
    W.dedent();
  }
  W.line('end');
}

function printWhile(W, node) {
  W.write('while ');
  printExpr(W, node.condition);
  W.write(' do');
  W.newline();
  W.indent();
  printBlockBody(W, node.body);
  W.dedent();
  W.line('end');
}

function printRepeat(W, node) {
  W.line('repeat');
  W.indent();
  printBlockBody(W, node.body);
  W.dedent();
  W.write('until ');
  printExpr(W, node.condition);
  W.newline();
}

function printNumericFor(W, node) {
  W.write('for ' + node.variable.name + ' = ');
  printExpr(W, node.start);
  W.write(', ');
  printExpr(W, node.end);
  if (node.step) {
    W.write(', ');
    printExpr(W, node.step);
  }
  W.write(' do');
  W.newline();
  W.indent();
  printBlockBody(W, node.body);
  W.dedent();
  W.line('end');
}

function printGenericFor(W, node) {
  W.write('for ');
  for (let i = 0; i < node.variables.length; i++) {
    if (i > 0) W.write(', ');
    W.write(node.variables[i].name);
  }
  W.write(' in ');
  for (let i = 0; i < node.iterators.length; i++) {
    if (i > 0) W.write(', ');
    printExpr(W, node.iterators[i]);
  }
  W.write(' do');
  W.newline();
  W.indent();
  printBlockBody(W, node.body);
  W.dedent();
  W.line('end');
}

function printDo(W, node) {
  W.line('do');
  W.indent();
  printBlockBody(W, node.body);
  W.dedent();
  W.line('end');
}

function printReturn(W, node) {
  W.write('return');
  if (node.values.length > 0) {
    W.write(' ');
    for (let i = 0; i < node.values.length; i++) {
      if (i > 0) W.write(', ');
      printExpr(W, node.values[i]);
    }
  }
  W.newline();
}

function printFunctionDecl(W, node, isLocal) {
  W.write(isLocal ? 'local function ' : 'function ');
  W.write(node.name.name);
  W.write('(');
  for (let i = 0; i < node.params.length; i++) {
    if (i > 0) W.write(', ');
    W.write(node.params[i].name);
  }
  W.write(')');
  W.newline();
  W.indent();
  printBlockBody(W, node.body);
  W.dedent();
  W.line('end');
}

/**
 * Print the body of a block (list of statements), one per line.
 */
export function printBlockBody(W, block) {
  if (!block || !block.body) return;
  for (const stmt of block.body) {
    printStmt(W, stmt);
  }
}

export default { printStmt, printBlockBody };