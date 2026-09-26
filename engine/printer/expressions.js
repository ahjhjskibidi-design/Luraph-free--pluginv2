/**
 * Print expression nodes to Lua source.
 *
 * Every expression printer writes into a Writer. Composite nodes call
 * back into printExpr for their children, wrapping in parens when the
 * precedence rules demand it.
 */

import { NODE } from '../parser/types.js';
import { escapeLuaString } from './strings.js';
import { needsParens } from './operators.js';

export function printExpr(W, node, parent, side) {
  if (!node) return;

  switch (node.type) {
    case NODE.IDENT:
      W.write(node.name);
      return;

    case NODE.STRING:
      W.write(escapeLuaString(node.value));
      return;

    case NODE.NUMBER:
      W.write(formatNumber(node.value));
      return;

    case NODE.BOOL:
      W.write(node.value ? 'true' : 'false');
      return;

    case NODE.NIL:
      W.write('nil');
      return;

    case NODE.VARARG:
      W.write('...');
      return;

    case NODE.BINARY:
      printBinary(W, node, parent, side);
      return;

    case NODE.UNARY:
      printUnary(W, node, parent, side);
      return;

    case NODE.CALL:
      printCall(W, node);
      return;

    case NODE.METHOD_CALL:
      printMethodCall(W, node);
      return;

    case NODE.INDEX:
      printIndex(W, node, parent);
      return;

    case NODE.TABLE:
      printTable(W, node);
      return;

    case NODE.FUNC_EXPR:
      printFunctionExpr(W, node);
      return;

    case NODE.PAREN:
      W.write('(');
      printExpr(W, node.expression);
      W.write(')');
      return;

    default:
      W.write('--[[unknown:' + node.type + ']]');
  }
}

function printBinary(W, node, parent, side) {
  const wrap = needsParens(node, parent, side);
  if (wrap) W.write('(');
  printExpr(W, node.left, node, 'left');
  W.write(' ' + node.operator + ' ');
  printExpr(W, node.right, node, 'right');
  if (wrap) W.write(')');
}

function printUnary(W, node, parent, side) {
  const wrap = needsParens(node, parent, side);
  if (wrap) W.write('(');
  if (node.operator === 'not') {
    W.write('not ');
  } else {
    W.write(node.operator);
  }
  printExpr(W, node.argument, node, 'operand');
  if (wrap) W.write(')');
}

function printCall(W, node) {
  printExpr(W, node.callee, node, 'callee');
  W.write('(');
  for (let i = 0; i < node.args.length; i++) {
    if (i > 0) W.write(', ');
    printExpr(W, node.args[i]);
  }
  W.write(')');
}

function printMethodCall(W, node) {
  printExpr(W, node.object, node, 'object');
  W.write(':' + node.method + '(');
  for (let i = 0; i < node.args.length; i++) {
    if (i > 0) W.write(', ');
    printExpr(W, node.args[i]);
  }
  W.write(')');
}

function printIndex(W, node, parent) {
  const wrap = needsParens(node, parent, 'object');
  if (wrap) W.write('(');
  printExpr(W, node.object, node, 'object');
  if (wrap) W.write(')');

  if (node.computed) {
    W.write('[');
    printExpr(W, node.key);
    W.write(']');
  } else {
    W.write('.' + node.key.value);
  }
}

function printTable(W, node) {
  if (node.fields.length === 0) {
    W.write('{}');
    return;
  }
  W.write('{');
  for (let i = 0; i < node.fields.length; i++) {
    if (i > 0) W.write(', ');
    const f = node.fields[i];
    if (f.type === NODE.FIELD_KEY) {
      W.write('[');
      printExpr(W, f.key);
      W.write('] = ');
      printExpr(W, f.value);
    } else {
      printExpr(W, f.value);
    }
  }
  W.write('}');
}

function printFunctionExpr(W, node) {
  W.write('function(');
  for (let i = 0; i < node.params.length; i++) {
    if (i > 0) W.write(', ');
    W.write(node.params[i].name);
  }
  if (node.isVararg) {
    if (node.params.length > 0) W.write(', ');
    W.write('...');
  }
  W.write(')');
  W.newline();
  W.indent();
  printBlockBody(W, node.body);
  W.dedent();
  W.write('end');
}

/**
 * Format a number without losing precision.
 * Integers stay integers, floats use toString with a safe rounding.
 */
function formatNumber(n) {
  if (Number.isInteger(n)) return String(n);
  return String(n);
}

export default { printExpr };